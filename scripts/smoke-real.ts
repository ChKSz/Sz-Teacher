// 用真实供应商跑一次完整的解题请求（需要 .env 里的密钥）。
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
const call = async (url: string, json?: unknown) => {
  const res = await app.request(url, {
    method: json === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return res;
};

await call('/api/auth/setup', { password: 'smoke-test-pw' });
const question =
  '如图，在矩形ABCD中，AB=8，BC=6，点P从点A出发，沿AB以每秒2个单位的速度向点B运动，设运动时间为t秒（0≤t≤4）。当t为何值时，△PBC是等腰三角形？';
const started = Date.now();
const res = await call('/api/chat', { text: question });
const text = await res.text();
const events = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
const deltas = events.filter((e) => e.type === 'delta');
const done = events.find((e) => e.type === 'done');
const error = events.find((e) => e.type === 'error');
console.log(`用时 ${Date.now() - started} ms，${deltas.length} 个片段，状态 ${done?.message.status}`);
if (error) console.log('错误：', error.message);
console.log('---- 回答 ----');
console.log(done?.message.content);
db.close();
fs.rmSync(dataDir, { recursive: true, force: true });
