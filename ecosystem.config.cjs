// PM2 进程配置。宝塔的"Node 项目"或命令行 `pm2 start ecosystem.config.cjs` 都可以用。
module.exports = {
  apps: [
    {
      name: 'sz-teacher',
      script: 'server/index.ts',
      interpreter: 'node',
      node_args: '--env-file-if-exists=.env',
      cwd: __dirname,
      instances: 1, // SQLite 单文件数据库，只能运行一个实例
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
        SECURE_COOKIES: 'true',
        TRUST_PROXY: 'true',
      },
    },
  ],
};
