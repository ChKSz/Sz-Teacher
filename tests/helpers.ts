import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../server/db.ts';
import { UploadStore } from '../server/uploads.ts';
import { createApp, SESSION_COOKIE } from '../server/app.ts';
import { LoginLimiter } from '../server/auth.ts';
import type { ServerConfig } from '../server/config.ts';

export interface FakeProvider {
  baseUrl: string;
  /** 每次请求 /chat/completions 的请求体。 */
  requests: Record<string, unknown>[];
  /** 下一次对话要返回的内容；函数形式可以按请求决定。 */
  reply: string | ((body: Record<string, unknown>) => string);
  /** 设置后，对话接口返回这个 HTTP 状态码和错误。 */
  failWith: number | null;
  close: () => Promise<void>;
}

/** 启动一个假的 OpenAI 兼容供应商。 */
export async function startFakeProvider(apiKey = 'sk-test-key-123456'): Promise<FakeProvider> {
  const state: FakeProvider = {
    baseUrl: '',
    requests: [],
    reply: '你好',
    failWith: null,
    close: async () => {},
  };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== `Bearer ${apiKey}`) {
      return send(401, { error: { message: `bad key ${req.headers.authorization ?? ''}` } });
    }
    if (req.url === '/v1/models') return send(200, { data: [{ id: 'gpt-6.1-sol' }, { id: 'other-model' }] });
    if (req.url !== '/v1/chat/completions') return send(404, { error: { message: 'not found' } });
    const body = JSON.parse(raw) as Record<string, unknown>;
    state.requests.push(body);
    if (state.failWith) return send(state.failWith, { error: { message: 'upstream failure' } });
    const text = typeof state.reply === 'function' ? state.reply(body) : state.reply;
    if (!body.stream) {
      return send(200, { choices: [{ message: { role: 'assistant', content: text } }] });
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chars = [...text];
    for (let i = 0; i < chars.length; i += 3) {
      const piece = chars.slice(i, i + 3).join('');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}

export interface TestApp {
  request: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  dataDir: string;
  cleanup: () => void;
  config: ServerConfig;
}

/** 创建一个使用临时目录和内存数据库的应用，并自动携带 Cookie。 */
export function createTestApp(provider: { baseUrl: string; apiKey?: string }, limiter?: LoginLimiter): TestApp {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-teacher-test-'));
  const config: ServerConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    webDir: path.join(dataDir, 'no-web'),
    secureCookies: false,
    trustProxy: true,
    initialProvider: { baseUrl: provider.baseUrl, apiKey: provider.apiKey ?? 'sk-test-key-123456', model: 'gpt-6.1-sol' },
  };
  const db = openDb(':memory:');
  const app = createApp({ config, db, uploads: new UploadStore(dataDir), limiter });
  let cookie = '';
  return {
    config,
    dataDir,
    cleanup: () => {
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
    request: async (url, init = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set('cookie', cookie);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(init.json);
      }
      const res = await app.request(url, { ...init, headers, body });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const match = new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(setCookie);
        cookie = match && match[1] ? `${SESSION_COOKIE}=${match[1]}` : '';
      }
      return res;
    },
  };
}

/** 读取 SSE 响应里的全部事件。 */
export async function readEvents(res: Response): Promise<{ type: string; [key: string]: unknown }[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as { type: string });
}

/** 1x1 红色 PNG。 */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
