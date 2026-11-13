// 忘记密码时使用：清除密码和所有登录状态，下次打开网页会重新要求设置密码。聊天记录不受影响。
// 运行：node --env-file-if-exists=.env scripts/reset-password.ts
import path from 'node:path';
import { loadConfig } from '../server/config.ts';
import { openDb } from '../server/db.ts';

const config = loadConfig();
const file = path.join(config.dataDir, 'sz-teacher.db');
const db = openDb(file);
db.prepare("DELETE FROM settings WHERE key = 'password_hash'").run();
db.prepare('DELETE FROM sessions').run();
db.close();
console.log(`已清除密码（${file}）。请立即打开网页设置新密码。`);
