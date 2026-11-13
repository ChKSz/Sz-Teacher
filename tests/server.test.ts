import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, readEvents, startFakeProvider, TINY_PNG, type FakeProvider, type TestApp } from './helpers.ts';
import { LoginLimiter, hashPassword, verifyPassword } from '../server/auth.ts';
import { parseSseLine } from '../server/llm.ts';
import { applyUpdate, maskKey } from '../server/settings.ts';
import type { ConversationDetail, ConversationSummary, PublicSettings } from '../shared/types.ts';

let provider: FakeProvider;
let t: TestApp;

beforeAll(async () => {
  provider = await startFakeProvider();
});
afterAll(async () => {
  await provider.close();
});
beforeEach(() => {
  provider.requests = [];
  provider.reply = '你好';
  provider.failWith = null;
  t = createTestApp({ baseUrl: provider.baseUrl });
});
afterEach(() => t.cleanup());

async function setup(password = 'secret123') {
  const res = await t.request('/api/auth/setup', { method: 'POST', json: { password } });
  expect(res.status).toBe(200);
}

describe('密码与登录', () => {
  it('首次使用时要求设置密码，设置后自动登录', async () => {
    expect(await (await t.request('/api/auth/status')).json()).toEqual({ initialized: false, authenticated: false });
    await setup();
    expect(await (await t.request('/api/auth/status')).json()).toEqual({ initialized: true, authenticated: true });
  });

  it('密码太短会被拒绝', async () => {
    const res = await t.request('/api/auth/setup', { method: 'POST', json: { password: '123' } });
    expect(res.status).toBe(400);
  });

  it('密码只能设置一次', async () => {
    await setup();
    const res = await t.request('/api/auth/setup', { method: 'POST', json: { password: 'another123' } });
    expect(res.status).toBe(409);
  });

  it('未登录时访问受保护接口返回 401', async () => {
    await setup();
    await t.request('/api/auth/logout', { method: 'POST' });
    expect((await t.request('/api/conversations')).status).toBe(401);
    expect((await t.request('/api/settings')).status).toBe(401);
  });

  it('密码错误拒绝登录，正确则登录成功', async () => {
    await setup();
    await t.request('/api/auth/logout', { method: 'POST' });
    expect((await t.request('/api/auth/login', { method: 'POST', json: { password: 'wrong-pass' } })).status).toBe(401);
    expect((await t.request('/api/auth/login', { method: 'POST', json: { password: 'secret123' } })).status).toBe(200);
    expect((await t.request('/api/conversations')).status).toBe(200);
  });

  it('连续输错达到上限后锁定，正确密码也不行', async () => {
    t.cleanup();
    t = createTestApp({ baseUrl: provider.baseUrl }, new LoginLimiter(3, 60_000, 60_000));
    await setup();
    await t.request('/api/auth/logout', { method: 'POST' });
    const headers = { 'x-forwarded-for': '1.2.3.4' };
    for (let i = 0; i < 3; i += 1) {
      await t.request('/api/auth/login', { method: 'POST', headers, json: { password: 'bad-pass' } });
    }
    const locked = await t.request('/api/auth/login', { method: 'POST', headers, json: { password: 'secret123' } });
    expect(locked.status).toBe(429);
    // 其他 IP 不受影响
    const other = await t.request('/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '5.6.7.8' },
      json: { password: 'secret123' },
    });
    expect(other.status).toBe(200);
  });

  it('修改密码后旧密码失效', async () => {
    await setup();
    const bad = await t.request('/api/auth/password', { method: 'POST', json: { current: 'nope-nope', next: 'newpass123' } });
    expect(bad.status).toBe(400);
    const ok = await t.request('/api/auth/password', { method: 'POST', json: { current: 'secret123', next: 'newpass123' } });
    expect(ok.status).toBe(200);
    expect((await t.request('/api/conversations')).status).toBe(200);
    await t.request('/api/auth/logout', { method: 'POST' });
    expect((await t.request('/api/auth/login', { method: 'POST', json: { password: 'secret123' } })).status).toBe(401);
    expect((await t.request('/api/auth/login', { method: 'POST', json: { password: 'newpass123' } })).status).toBe(200);
  });

  it('拒绝跨站的写请求', async () => {
    const res = await t.request('/api/auth/setup', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'localhost' },
      json: { password: 'secret123' },
    });
    expect(res.status).toBe(403);
  });

  it('密码哈希可验证且每次加盐不同', async () => {
    const a = await hashPassword('abc12345');
    const b = await hashPassword('abc12345');
    expect(a).not.toBe(b);
    expect(await verifyPassword('abc12345', a)).toBe(true);
    expect(await verifyPassword('abc12346', a)).toBe(false);
  });
});

describe('设置', () => {
  it('API Key 只以打码形式返回', async () => {
    await setup();
    const settings = (await (await t.request('/api/settings')).json()) as PublicSettings;
    expect(settings.provider.hasApiKey).toBe(true);
    expect(settings.provider.apiKeyMasked).toBe('sk-…3456');
    expect(JSON.stringify(settings)).not.toContain('sk-test-key-123456');
    expect(settings.solveModel).toBe('gpt-6.1-sol');
  });

  it('可以修改设置，空着的 API Key 不会被覆盖', async () => {
    await setup();
    const res = await t.request('/api/settings', {
      method: 'PUT',
      json: { provider: { baseUrl: 'https://example.com/v1/' }, solveModel: 'm2', tts: { rate: 1.3 } },
    });
    expect(res.status).toBe(200);
    const settings = (await res.json()) as PublicSettings;
    expect(settings.provider.baseUrl).toBe('https://example.com/v1');
    expect(settings.provider.hasApiKey).toBe(true);
    expect(settings.solveModel).toBe('m2');
    expect(settings.tts.rate).toBe(1.3);
  });

  it('非法设置返回 400', async () => {
    await setup();
    const bad = await t.request('/api/settings', { method: 'PUT', json: { provider: { baseUrl: 'ftp://x' } } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('http');
    const rate = await t.request('/api/settings', { method: 'PUT', json: { tts: { rate: 9 } } });
    expect(rate.status).toBe(400);
  });

  it('测试连接：成功时返回模型列表，密钥错误时给出中文原因且不泄露密钥', async () => {
    await setup();
    const ok = (await (await t.request('/api/settings/test', { method: 'POST', json: {} })).json()) as {
      ok: boolean;
      models: string[];
    };
    expect(ok.ok).toBe(true);
    expect(ok.models).toContain('gpt-6.1-sol');
    const bad = (await (
      await t.request('/api/settings/test', { method: 'POST', json: { apiKey: 'sk-wrong-key-999999' } })
    ).json()) as { ok: boolean; message: string };
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('API Key 无效');
    expect(bad.message).not.toContain('sk-wrong-key-999999');
  });

  it('applyUpdate 与 maskKey', () => {
    const base = {
      provider: { baseUrl: '', apiKey: 'k' },
      solveModel: 'a',
      sceneModel: 'a',
      reasoningEffort: '' as const,
      teachingStyle: 'direct' as const,
      tts: { rate: 1, voice: '' },
    };
    expect(() => applyUpdate(base, { reasoningEffort: 'extreme' as never })).toThrow();
    expect(applyUpdate(base, { teachingStyle: 'hint-first' }).teachingStyle).toBe('hint-first');
    expect(base.teachingStyle).toBe('direct');
    expect(maskKey('')).toBe('');
    expect(maskKey('short')).toBe('****');
  });
});

describe('解题对话', () => {
  it('新题目：创建会话、流式返回、保存记录', async () => {
    await setup();
    provider.reply = '设 $x=2$，**答案：** 4';
    const res = await t.request('/api/chat', { method: 'POST', json: { text: '2 加 2 等于几？' } });
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events[0]!.type).toBe('start');
    const streamed = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    expect(streamed).toBe(provider.reply);
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(1);
    expect(events.at(-1)!.type).toBe('done');

    const list = (await (await t.request('/api/conversations')).json()) as ConversationSummary[];
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('2 加 2 等于几？');
    const detail = (await (await t.request(`/api/conversations/${list[0]!.id}`)).json()) as ConversationDetail;
    expect(detail.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', '2 加 2 等于几？'],
      ['assistant', provider.reply],
    ]);

    const sent = provider.requests[0]!;
    expect(sent.model).toBe('gpt-6.1-sol');
    expect(sent.stream).toBe(true);
    const messages = sent.messages as { role: string }[];
    expect(messages[0]!.role).toBe('system');
  });

  it('追问时带上之前的对话', async () => {
    await setup();
    const first = await readEvents(await t.request('/api/chat', { method: 'POST', json: { text: '第一问' } }));
    const conversationId = first[0]!.conversationId as string;
    provider.reply = '第二答';
    await readEvents(await t.request('/api/chat', { method: 'POST', json: { conversationId, text: '为什么？' } }));
    const messages = provider.requests[1]!.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[3]!.content).toBe('为什么？');
    const list = (await (await t.request('/api/conversations')).json()) as ConversationSummary[];
    expect(list).toHaveLength(1);
  });

  it('图片题目：保存图片并以 image_url 发给模型', async () => {
    await setup();
    const events = await readEvents(await t.request('/api/chat', { method: 'POST', json: { text: '', images: [TINY_PNG] } }));
    const userMessage = events[0]!.userMessage as { images: string[] };
    expect(userMessage.images).toHaveLength(1);
    const name = userMessage.images[0]!;
    expect(fs.existsSync(path.join(t.dataDir, 'uploads', name))).toBe(true);

    const img = await t.request(`/api/uploads/${name}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');

    const content = (provider.requests[0]!.messages as { content: unknown }[])[1]!.content as {
      type: string;
      text?: string;
      image_url?: { url: string };
    }[];
    expect(content[0]).toEqual({ type: 'text', text: '请解答图片中的题目。' });
    expect(content[1]!.image_url!.url.startsWith('data:image/png;base64,')).toBe(true);

    const list = (await (await t.request('/api/conversations')).json()) as ConversationSummary[];
    expect(list[0]!.title).toBe('图片题目');
    // 删除会话时图片一起删除
    expect((await t.request(`/api/conversations/${list[0]!.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(fs.existsSync(path.join(t.dataDir, 'uploads', name))).toBe(false);
  });

  it('拒绝伪装成图片的文件和非法文件名', async () => {
    await setup();
    const fake = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    const res = await t.request('/api/chat', { method: 'POST', json: { text: 'x', images: [fake] } });
    expect(res.status).toBe(400);
    expect((await t.request('/api/uploads/..%2F..%2Fsecret.png')).status).toBe(404);
    expect(await (await t.request('/api/conversations')).json()).toEqual([]);
  });

  it('供应商出错时给出中文提示，并把失败记录保存下来', async () => {
    await setup();
    provider.failWith = 500;
    const events = await readEvents(await t.request('/api/chat', { method: 'POST', json: { text: '题目' } }));
    const error = events.find((e) => e.type === 'error')!;
    expect(error.message).toContain('供应商服务器出错');
    const done = events.find((e) => e.type === 'done')!;
    expect((done.message as { status: string }).status).toBe('error');

    // 失败的回答不会作为历史发给模型
    provider.failWith = null;
    const conversationId = events[0]!.conversationId as string;
    await readEvents(await t.request('/api/chat', { method: 'POST', json: { conversationId, text: '再试一次' } }));
    const roles = (provider.requests.at(-1)!.messages as { role: string }[]).map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'user']);
  });

  it('空消息与不存在的会话', async () => {
    await setup();
    expect((await t.request('/api/chat', { method: 'POST', json: { text: '   ' } })).status).toBe(400);
    expect((await t.request('/api/chat', { method: 'POST', json: { conversationId: 'nope', text: 'x' } })).status).toBe(404);
  });

  it('重命名会话', async () => {
    await setup();
    const events = await readEvents(await t.request('/api/chat', { method: 'POST', json: { text: '题' } }));
    const id = events[0]!.conversationId as string;
    expect((await t.request(`/api/conversations/${id}`, { method: 'PATCH', json: { title: '动点题' } })).status).toBe(200);
    const detail = (await (await t.request(`/api/conversations/${id}`)).json()) as ConversationDetail;
    expect(detail.title).toBe('动点题');
  });

  it('启发式风格使用不同的系统提示', async () => {
    await setup();
    await t.request('/api/settings', { method: 'PUT', json: { teachingStyle: 'hint-first' } });
    await readEvents(await t.request('/api/chat', { method: 'POST', json: { text: '题' } }));
    const system = (provider.requests[0]!.messages as { content: string }[])[0]!.content;
    expect(system).toContain('启发式');
  });
});

describe('SSE 解析', () => {
  it('解析正文、忽略空行和注释、识别结束和错误', () => {
    expect(parseSseLine('data: {"choices":[{"delta":{"content":"你"}}]}')).toBe('你');
    expect(parseSseLine(': keep-alive')).toBeNull();
    expect(parseSseLine('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
    expect(typeof parseSseLine('data: [DONE]')).toBe('symbol');
    expect(() => parseSseLine('data: {"error":{"message":"quota"}}')).toThrow('quota');
  });
});
