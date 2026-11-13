// 同时启动后端（3000）和前端开发服务器（5173）。
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['dev:server', 'dev:web'].map((script) =>
  spawn(npm, ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' }),
);

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());
