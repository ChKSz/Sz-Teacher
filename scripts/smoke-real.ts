// 用真实供应商跑一次完整对话（需要 .env 里的密钥）：解题 → 针对某一步追问；再试一次启发式模式。
// 运行：node --env-file=.env scripts/smoke-real.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.ts';
import { UploadStore } from '../server/uploads.ts';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-smoke-'));
const config = { ...loadConfig(), dataDir, webDir: path.join(dataDir, 'none') };
const db = openDb(':memory:');
const app = createApp({ config, db, uploads: new UploadStore(dataDir) });
let cookie = '';
const call = async (url: string, json?: unknown, method = json === undefined ? 'GET' : 'POST') => {
  const res = await app.request(url, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return res;
};
const ask = async (text: string, conversationId?: string) => {
  const started = Date.now();
  const raw = await (await call('/api/chat', { text, conversationId })).text();
  const events = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  const done = events.find((e) => e.type === 'done');
  const error = events.find((e) => e.type === 'error');
  console.log(`\n==== 用时 ${Date.now() - started} ms，状态 ${done?.message.status}${error ? `，错误：${error.message}` : ''}`);
  console.log(done?.message.content);
  return events[0].conversationId as string;
};

await call('/api/auth/setup', { password: 'smoke-test-pw' });
const question =
  '如图，在矩形ABCD中，AB=8，BC=6，点P从点A出发，沿AB以每秒2个单位的速度向点B运动，设运动时间为t秒（0≤t≤4）。当t为何值时，△PBC是等腰三角形？';
const id = await ask(question);
await ask('关于动画讲解的第 5 步：\n> **情况②** $PB=PC$：$PC$ 是斜边，总有 $PC>PB$，不可能 ✗\n\n这一步我没看懂，能换个方式再讲讲吗？', id);

await call('/api/settings', { teachingStyle: 'hint-first' }, 'PUT');
await ask('已知 x+y=5，xy=6，求 x²+y² 的值。');
db.close();
fs.rmSync(dataDir, { recursive: true, force: true });
