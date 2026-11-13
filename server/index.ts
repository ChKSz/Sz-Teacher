import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { UploadStore } from './uploads.ts';
import { createApp } from './app.ts';
import { getPasswordHash, hashPassword, setInitialPasswordHash, validateNewPassword } from './auth.ts';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'sz-teacher.db'));
const uploads = new UploadStore(config.dataDir);
// 部署时可以通过环境变量预设密码，避免上线后到设置密码之前被别人抢先设置。
const initialPassword = process.env.INITIAL_PASSWORD;
if (initialPassword && getPasswordHash(db) === null) {
  setInitialPasswordHash(db, await hashPassword(validateNewPassword(initialPassword)));
  console.log('已使用 INITIAL_PASSWORD 设置访问密码（之后可在网页设置里修改，可从 .env 删除该项）');
}

const app = createApp({ config, db, uploads });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Sz-Teacher 已启动：http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${info.port}`);
  console.log(`数据目录：${config.dataDir}`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
