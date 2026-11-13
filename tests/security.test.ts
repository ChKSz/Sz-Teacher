import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, readEvents, startFakeProvider, type FakeProvider, type TestApp } from './helpers.ts';
import { LoginLimiter } from '../server/auth.ts';
import { generateScene } from '../server/sceneGen.ts';
import { rectangleMovingPoint } from '../shared/scene/examples.ts';

let provider: FakeProvider;
let t: TestApp | undefined;
beforeAll(async () => {
  provider = await startFakeProvider();
});
afterAll(async () => {
  await provider.close();
});
beforeEach(() => {
  provider.requests = [];
  provider.failWith = null;
  provider.reply = '你好';
});
afterEach(() => {
  t?.cleanup();
  t = undefined;
});

async function lockedSetup(max = 3): Promise<TestApp> {
  const app = createTestApp({ baseUrl: provider.baseUrl }, new LoginLimiter(max, 60_000, 60_000));
  t = app;
  await app.request('/api/auth/setup', { method: 'POST', json: { password: 'secret123' } });
  await app.request('/api/auth/logout', { method: 'POST' });
  return app;
}

const login = (app: TestApp, password: string, headers: Record<string, string>) =>
  app.request('/api/auth/login', { method: 'POST', headers, json: { password } });

describe('登录限速', () => {
  it('伪造 X-Forwarded-For 前缀不能绕过锁定（以 X-Real-IP 为准）', async () => {
    const app = await lockedSetup();
    for (let i = 0; i < 3; i += 1) {
      await login(app, 'bad-pass', { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': `1.2.3.${i}, 9.9.9.9` });
    }
    const res = await login(app, 'secret123', { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '7.7.7.7, 9.9.9.9' });
    expect(res.status).toBe(429);
  });

  it('没有 X-Real-IP 时只信任 X-Forwarded-For 的最后一项', async () => {
    const app = await lockedSetup();
    for (let i = 0; i < 3; i += 1) await login(app, 'bad', { 'x-forwarded-for': `1.2.3.${i}, 8.8.8.8` });
    const res = await login(app, 'secret123', { 'x-forwarded-for': '5.5.5.5, 8.8.8.8' });
    expect(res.status).toBe(429);
  });

  it('并发猜测：超过上限的请求直接被锁定', async () => {
    const app = await lockedSetup(3);
    const results = await Promise.all(Array.from({ length: 10 }, () => login(app, 'bad-pass', { 'x-real-ip': '6.6.6.6' })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(3);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(7);
  });

  it('登录成功后清除计数', async () => {
    const app = await lockedSetup(3);
    const headers = { 'x-real-ip': '4.4.4.4' };
    await login(app, 'bad', headers);
    await login(app, 'bad', headers);
    expect((await login(app, 'secret123', headers)).status).toBe(200);
    await app.request('/api/auth/logout', { method: 'POST' });
    expect((await login(app, 'bad', headers)).status).toBe(401);
  });

  it('大量不同 IP 不会让记录无限增长', () => {
    const limiter = new LoginLimiter(5, 60_000, 60_000);
    for (let i = 0; i < 20_000; i += 1) limiter.recordFailure(`10.0.${i >> 8}.${i & 255}`);
    const size = (limiter as unknown as { failures: Map<string, unknown> }).failures.size;
    expect(size).toBeLessThanOrEqual(10_001);
  });

  it('登录接口拒绝过大的请求体', async () => {
    const app = await lockedSetup();
    const res = await login(app, 'x'.repeat(10_000), {});
    expect(res.status).toBe(413);
  });
});

describe('其他修复', () => {
  it('测试连接：换了 Base URL 却不填密钥时，不会把已保存的密钥发出去', async () => {
    const app = createTestApp({ baseUrl: provider.baseUrl });
    t = app;
    await app.request('/api/auth/setup', { method: 'POST', json: { password: 'secret123' } });
    const before = provider.requests.length;
    const res = (await (
      await app.request('/api/settings/test', { method: 'POST', json: { baseUrl: 'http://127.0.0.1:9/v1' } })
    ).json()) as { ok: boolean; message: string };
    expect(res.ok).toBe(false);
    expect(res.message).toContain('请同时填写 API Key');
    expect(provider.requests.length).toBe(before);
  });

  it('非标准端口访问时，带端口的 Origin 也能通过', async () => {
    const app = createTestApp({ baseUrl: provider.baseUrl });
    t = app;
    const res = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { origin: 'https://tutor.example:8443', host: 'tutor.example:8443' },
      json: { password: 'secret123' },
    });
    expect(res.status).toBe(200);
  });

  it('生成过程中会话被删除：仍然发出结束事件', async () => {
    const app = createTestApp({ baseUrl: provider.baseUrl });
    t = app;
    await app.request('/api/auth/setup', { method: 'POST', json: { password: 'secret123' } });
    const first = await readEvents(await app.request('/api/chat', { method: 'POST', json: { text: '题' } }));
    const id = first[0]!.conversationId as string;
    provider.reply = () => {
      void app.request(`/api/conversations/${id}`, { method: 'DELETE' });
      return '很长的回答';
    };
    const events = await readEvents(await app.request('/api/chat', { method: 'POST', json: { conversationId: id, text: '追问' } }));
    expect(['done', 'error']).toContain(events.at(-1)!.type);
  });

  it('供应商不支持 response_format：之后每一轮都不再发送', async () => {
    const wrong = structuredClone(rectangleMovingPoint);
    wrong.checks = [{ expr: 'dist(P,B) == dist(B,C)', at: { t: 2 } }];
    let calls = 0;
    provider.reply = () => {
      calls += 1;
      return JSON.stringify(calls < 3 ? wrong : rectangleMovingPoint);
    };
    let withFormat = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { response_format?: unknown }) : {};
      if (body.response_format) {
        withFormat += 1;
        return new Response(JSON.stringify({ error: { message: 'response_format unsupported' } }), { status: 400 });
      }
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      const result = await generateScene({
        provider: { baseUrl: provider.baseUrl, apiKey: 'sk-test-key-123456' },
        model: 'm',
        question: 'q',
        images: [],
        solution: 's',
      });
      expect(result.verified).toBe(true);
      expect(result.attempts).toBe(3);
      expect(withFormat).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
