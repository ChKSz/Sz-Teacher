// 端到端测试用：启动假供应商 + 真实服务器（临时数据目录），打印地址后保持运行。
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startFakeProvider } from '../tests/helpers.ts';
import { openDb } from '../server/db.ts';
import { UploadStore } from '../server/uploads.ts';
import { createApp } from '../server/app.ts';
import { rectangleMovingPoint } from '../shared/scene/examples.ts';

export async function startE2EServer() {
  const provider = await startFakeProvider();
  provider.reply = (body) => {
    if (!body.stream && body.response_format) return JSON.stringify(rectangleMovingPoint);
    const messages = body.messages as { content: unknown }[];
    const last = JSON.stringify(messages.at(-1)?.content ?? '');
    if (last.includes('image_url')) return '我看到了图片里的题目。\n\n**答案：** $x=3$';
    if (last.includes('为什么')) return '因为 $AP=2t$，所以 $PB=8-2t$。';
    return '### 思路\n设时间为 $t$ 秒，则 $AP=2t$。\n\n$$PB=8-2t$$\n\n**答案：** $t=1$';
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-teacher-e2e-'));
  const db = openDb(path.join(dataDir, 'test.db'));
  const app = createApp({
    config: {
      port: 0,
      host: '127.0.0.1',
      dataDir,
      webDir: path.resolve('dist'),
      secureCookies: false,
      trustProxy: false,
      initialProvider: { baseUrl: provider.baseUrl, apiKey: 'sk-test-key-123456', model: 'gpt-6.1-sol' },
    },
    db,
    uploads: new UploadStore(dataDir),
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    provider,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await provider.close();
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
