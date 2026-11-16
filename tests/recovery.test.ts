import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { UploadStore } from '../server/uploads.ts';
import * as store from '../server/store.ts';
import { rectangleMovingPoint } from '../shared/scene/examples.ts';

it('重启后中断任务可重试，已有动画和错题资料保留', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-teacher-recovery-'));
  const file = path.join(directory, 'test.db');
  let db = openDb(file);
  try {
    const conversation = store.createConversation(db, '需要复习的动点题');
    store.updateConversation(db, conversation.id, { starred: true, knowledgePoint: '等腰三角形', note: '注意重合', reviewStatus: 'mastered' });
    const message = store.addMessage(db, conversation.id, { role: 'assistant', content: '解答', images: [], status: 'done' });
    const record = store.saveScene(db, message.id, rectangleMovingPoint, true, []);
    store.setSceneJob(db, message.id, 'working', '正在重新生成');
    db.close();
    db = openDb(file);
    createApp({
      db,
      uploads: new UploadStore(directory),
      config: { port: 0, host: '127.0.0.1', dataDir: directory, webDir: path.join(directory, '无前端'), secureCookies: false, trustProxy: false,
        initialProvider: { baseUrl: '', apiKey: '', model: '' } },
    });
    expect(store.getSceneJob(db, message.id)).toMatchObject({ status: 'error', message: '服务器重启，生成已中断，请重试' });
    const restored = store.getConversation(db, conversation.id)!;
    expect(restored).toMatchObject({ note: '注意重合', knowledgePoint: '等腰三角形', reviewStatus: 'mastered', starred: true });
    expect(restored.messages[0]!.scene?.id).toBe(record.id);
  } finally {
    db.close();
    // 只清理本测试刚刚创建的临时目录。
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('sz-teacher-recovery-')) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
