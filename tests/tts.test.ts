import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, TEST_WAV, type TestApp } from './helpers.ts';
import { SpeechCache } from '../server/speechCache.ts';
import { defaultSettings } from '../server/settings.ts';

let app: TestApp | undefined;
afterEach(() => { app?.cleanup(); app = undefined; vi.unstubAllGlobals(); });

async function setup(withKey = true) {
  app = createTestApp({ baseUrl: 'https://example.com/v1' });
  await app.request('/api/auth/setup', { method: 'POST', json: { password: 'secret123' } });
  const saved = await app.request('/api/settings', { method: 'PUT', json: { tts: {
    provider: 'xiaomi', ...(withKey ? { apiKey: 'mimo-test-secret-123456' } : {}), xiaomiVoice: '冰糖', style: '耐心讲解',
  } } });
  expect(saved.status).toBe(200);
  return app;
}

it('小米语音使用官方消息、音色与鉴权协议，返回可播放的 WAV，密钥不回显', async () => {
  const app = await setup();
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { audio: { data: TEST_WAV.toString('base64') } } }] }));
  vi.stubGlobal('fetch', fetcher);
  const res = await app.request('/api/tts', { method: 'POST', json: { text: '这是第一步。' } });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('audio/wav');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(Buffer.from(await res.arrayBuffer())).toEqual(TEST_WAV);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
  expect(new Headers(init.headers).get('api-key')).toBe('mimo-test-secret-123456');
  expect(JSON.parse(init.body as string)).toEqual({ model: 'mimo-v2.5-tts', stream: false,
    messages: [{ role: 'user', content: '耐心讲解' }, { role: 'assistant', content: '这是第一步。' }],
    audio: { format: 'wav', voice: '冰糖' } });
  const publicSettings = await (await app.request('/api/settings')).text();
  expect(publicSettings).not.toContain('mimo-test-secret-123456');
  expect(JSON.parse(publicSettings).tts.hasApiKey).toBe(true);
});

it('无密钥、无效内容和未登录时不会调用语音供应商', async () => {
  const app = await setup(false);
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const noKey = await app.request('/api/tts', { method: 'POST', json: { text: '你好' } });
  expect(await noKey.text()).toContain('填写小米语音密钥');
  for (const text of ['', 'a'.repeat(20001), 42]) {
    expect((await app.request('/api/tts', { method: 'POST', json: { text } })).status).toBe(400);
  }
  await app.request('/api/auth/logout', { method: 'POST' });
  expect((await app.request('/api/tts', { method: 'POST', json: { text: '你好' } })).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});

async function waitJob(app: TestApp, id: string) {
  for (let i = 0; i < 300; i++) {
    const value = await (await app.request(`/api/tts/jobs/${id}`)).json();
    if (value.status !== 'preparing') return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('语音任务未完成');
}

it('回复全文仅合成一次，重播、刷新和调速复用落盘缓存，更换音色重新合成', async () => {
  const app = await setup();
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { audio: { data: TEST_WAV.toString('base64') } } }] }));
  vi.stubGlobal('fetch', fetcher);
  const text = '这是一段完整讲解，不能逐句发送。'.repeat(120);
  const job = await (await app.request('/api/tts/prepare', { method: 'POST', json: { texts: [text] } })).json();
  const ready = await waitJob(app, job.id);
  expect(ready.status).toBe('ready');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init[1].body as string).messages.at(-1).content).toBe(text);
  expect((await app.request(ready.clips[0])).status).toBe(200);
  await app.request('/api/settings', { method: 'PUT', json: { tts: { rate: 1.8 } } });
  const again = await (await app.request('/api/tts/prepare', { method: 'POST', json: { texts: [text] } })).json();
  await waitJob(app, again.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const tts = { ...defaultSettings(app.config).tts, provider: 'xiaomi' as const, apiKey: 'mimo-test-secret-123456', xiaomiVoice: '冰糖', style: '耐心讲解' };
  await new SpeechCache(app.dataDir).ensure(tts, text);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await app.request('/api/settings', { method: 'PUT', json: { tts: { xiaomiVoice: '茉莉' } } });
  const changed = await (await app.request('/api/tts/prepare', { method: 'POST', json: { texts: [text] } })).json();
  await waitJob(app, changed.id);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await app.request('/api/auth/logout', { method: 'POST' });
  expect((await app.request(ready.clips[0])).status).toBe(401);
});

it('动画一次提交所有步骤，合成去重并限制并发，全部完成才返回可播放列表', async () => {
  const app = await setup();
  let active = 0; let peak = 0;
  const fetcher = vi.fn(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    active--;
    return Response.json({ choices: [{ message: { audio: { data: TEST_WAV.toString('base64') } } }] });
  });
  vi.stubGlobal('fetch', fetcher);
  const texts = ['第一步。', '第二步。', '', '第三步。', '第四步。', '第一步。'];
  const start = () => app.request('/api/tts/prepare', { method: 'POST', json: { texts } });
  const [one, two] = await Promise.all([start(), start()]);
  const job = await one.json();
  expect((await two.json()).id).toBe(job.id);
  expect(job).toMatchObject({ status: 'preparing', clips: [] });
  const result = await waitJob(app, job.id);
  expect(result).toMatchObject({ status: 'ready', completed: 5, total: 5 });
  expect(result.clips).toHaveLength(6);
  expect(result.clips[2]).toBeNull();
  expect(result.clips[0]).toBe(result.clips[5]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(peak).toBeLessThanOrEqual(3);
});

it('整批准备失败时显示错误，重试只合成失败步骤', async () => {
  const app = await setup();
  let failing = true;
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    if (failing && JSON.parse(init.body as string).messages.at(-1).content === '第二步。') return new Response('', { status: 429 });
    return Response.json({ choices: [{ message: { audio: { data: TEST_WAV.toString('base64') } } }] });
  });
  vi.stubGlobal('fetch', fetcher);
  const start = async () => (await app.request('/api/tts/prepare', { method: 'POST', json: { texts: ['第一步。', '第二步。'] } })).json();
  const first = await start();
  expect(await waitJob(app, first.id)).toMatchObject({ status: 'error', clips: [], error: expect.stringContaining('额度不足') });
  failing = false;
  const again = await start();
  expect((await waitJob(app, again.id)).status).toBe('ready');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([[401, '语音密钥无效'], [429, '语音额度不足'], [404, '语音模型或接口不存在']])('上游 %s 错误转换成可读中文且不泄露供应商内容', async (status, message) => {
  const app = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('敏感上游内容', { status: Number(status) })));
  const res = await app.request('/api/tts', { method: 'POST', json: { text: '你好' } });
  const body = await res.text();
  expect(body).toContain(message); expect(body).not.toContain('敏感上游内容');
});

it.each(['非 JSON', JSON.stringify({ choices: [{ message: { audio: { data: 'YWJj' } } }] })])('供应商返回无效音频时不会当作成功', async (payload) => {
  const app = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
  const res = await app.request('/api/tts', { method: 'POST', json: { text: '你好' } });
  expect(res.status).toBe(400); expect(await res.text()).toMatch(/格式不正确/);
});

it('更换语音地址需要重新填写密钥，失败不覆盖原配置', async () => {
  const app = await setup();
  const res = await app.request('/api/settings', { method: 'PUT', json: { tts: { baseUrl: 'https://other.example/v1' } } });
  expect(res.status).toBe(400);
  expect((await (await app.request('/api/settings')).json()).tts.baseUrl).toBe('https://api.xiaomimimo.com/v1');
});
