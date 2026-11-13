import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, readEvents, startFakeProvider, type FakeProvider, type TestApp } from './helpers.ts';
import { rectangleMovingPoint } from '../shared/scene/examples.ts';
import { extractJson } from '../server/scenePrompt.ts';
import type { ConversationDetail } from '../shared/types.ts';

let provider: FakeProvider;
let t: TestApp;

beforeAll(async () => {
  provider = await startFakeProvider();
});
afterAll(async () => {
  await provider.close();
});
beforeEach(async () => {
  provider.requests = [];
  provider.failWith = null;
  t = createTestApp({ baseUrl: provider.baseUrl });
  await t.request('/api/auth/setup', { method: 'POST', json: { password: 'secret123' } });
});
afterEach(() => t.cleanup());

/** 先问一道题，返回回答的消息 id。 */
async function ask(): Promise<{ conversationId: string; messageId: string }> {
  provider.reply = '**答案：** $t=1$';
  const events = await readEvents(await t.request('/api/chat', { method: 'POST', json: { text: '矩形动点题' } }));
  return { conversationId: events[0]!.conversationId as string, messageId: events[0]!.assistantMessageId as string };
}

const wrongScene = () => {
  const s = structuredClone(rectangleMovingPoint);
  s.checks = [{ expr: 'dist(P,B) == dist(B,C)', at: { t: 2 }, note: 't=2 时 PB=BC' }];
  return s;
};

describe('生成动画讲解', () => {
  it('一次成功：保存剧本，会话详情里带上剧本', async () => {
    const { conversationId, messageId } = await ask();
    provider.reply = (body) => (body.stream ? 'x' : JSON.stringify(rectangleMovingPoint));
    const events = await readEvents(await t.request(`/api/messages/${messageId}/scene`, { method: 'POST' }));
    expect(events[0]).toEqual({ type: 'progress', message: '正在设计动画讲解…' });
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    expect((done.record as { verified: boolean }).verified).toBe(true);

    // 请求里带了题目和解答，要求 JSON 输出
    const sent = provider.requests.at(-1)!;
    expect(sent.response_format).toEqual({ type: 'json_object' });
    const userText = (sent.messages as { content: string }[])[1]!.content;
    expect(userText).toContain('矩形动点题');
    expect(userText).toContain('**答案：** $t=1$');

    const detail = (await (await t.request(`/api/conversations/${conversationId}`)).json()) as ConversationDetail;
    expect(detail.messages[1]!.scene?.scene.title).toBe(rectangleMovingPoint.title);
  });

  it('验算失败时把错误发回模型修正', async () => {
    const { messageId } = await ask();
    let calls = 0;
    provider.reply = () => {
      calls += 1;
      return JSON.stringify(calls === 1 ? wrongScene() : rectangleMovingPoint);
    };
    const events = await readEvents(await t.request(`/api/messages/${messageId}/scene`, { method: 'POST' }));
    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'done']);
    expect(events[1]!.message).toContain('修正');
    const fixRequest = provider.requests.at(-1)!.messages as { role: string; content: string }[];
    expect(fixRequest.at(-1)!.content).toContain('t=2 时 PB=BC');
    expect(fixRequest.at(-2)!.role).toBe('assistant');
  });

  it('多次修正仍验算失败：保留剧本但标记未通过', async () => {
    const { messageId } = await ask();
    provider.reply = () => JSON.stringify(wrongScene());
    const events = await readEvents(await t.request(`/api/messages/${messageId}/scene`, { method: 'POST' }));
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    const record = done.record as { verified: boolean; problems: string[] };
    expect(record.verified).toBe(false);
    expect(record.problems[0]).toContain('验算失败');
  });

  it('模型一直输出无法使用的内容：返回错误', async () => {
    const { messageId } = await ask();
    provider.reply = () => '我不会';
    const events = await readEvents(await t.request(`/api/messages/${messageId}/scene`, { method: 'POST' }));
    const error = events.at(-1)!;
    expect(error.type).toBe('error');
    expect(error.message).toContain('暂时做不出动画讲解');
  });

  it('供应商出错时返回中文原因', async () => {
    const { messageId } = await ask();
    provider.failWith = 429;
    const events = await readEvents(await t.request(`/api/messages/${messageId}/scene`, { method: 'POST' }));
    expect(events.at(-1)!.message).toContain('请求太频繁或额度不足');
  });

  it('只能为成功的回答生成；不存在的消息返回 404', async () => {
    expect((await t.request('/api/messages/nope/scene', { method: 'POST' })).status).toBe(404);
    const { conversationId } = await ask();
    const detail = (await (await t.request(`/api/conversations/${conversationId}`)).json()) as ConversationDetail;
    const userMessageId = detail.messages[0]!.id;
    expect((await t.request(`/api/messages/${userMessageId}/scene`, { method: 'POST' })).status).toBe(404);
  });
});

describe('提取 JSON', () => {
  it('容忍代码块包裹和前后文字', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('好的，剧本如下：{"a":2} 希望有帮助')).toEqual({ a: 2 });
    expect(() => extractJson('没有 JSON')).toThrow('不是合法的 JSON');
  });
});
