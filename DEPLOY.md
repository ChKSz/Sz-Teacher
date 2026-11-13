# 部署到宝塔服务器

整个应用是一个 Node 程序：网页、接口、数据库都在里面，服务器上只需要运行它一个进程。

```
浏览器 ──HTTPS──▶ 宝塔 Nginx（443）──▶ Node 程序（127.0.0.1:3000）──▶ 模型供应商
                                          └─ data/（数据库 + 题目图片）
```

## 1. 准备

- 一个域名，解析（A 记录）到服务器 IP。
- 宝塔 → 软件商店 → 安装 **Node.js 版本管理器**，装 **Node 24**（必须 ≥ 24，程序用到了 Node 24 自带的 SQLite 和 TypeScript 运行能力）。
- 宝塔里安装 **PM2 管理器**（或者用"网站 → Node 项目"，它内部也是 PM2）。

## 2. 上传代码

两种方式任选：

- **Git（推荐）**：代码推到 GitHub 后，在服务器上 `git clone` 到 `/www/wwwroot/sz-teacher`，以后更新只要 `git pull`。
- **手动上传**：本地把项目打成 zip（**不要包含** `node_modules`、`data`、`dist`、`.env`），用宝塔文件管理器上传到 `/www/wwwroot/sz-teacher` 并解压。

## 3. 安装与构建

宝塔 → 终端：

```bash
cd /www/wwwroot/sz-teacher
# 服务器在美国，用官方源更快（项目里的 .npmrc 指向国内镜像）
npm ci --registry=https://registry.npmjs.org
npm run build
```

## 4. 配置

```bash
cp .env.example .env
nano .env        # 填 LLM_API_KEY；其他保持默认即可
chmod 600 .env
```

先确认服务器能访问模型供应商（美国服务器访问部分国内线路可能不通）：

```bash
npm run probe
```

"基本对话"显示"可用"才继续。如果连不上，要先换一个能从美国访问的 Base URL。

## 5. 启动

```bash
pm2 start ecosystem.config.cjs
pm2 save          # 服务器重启后自动启动
pm2 logs sz-teacher --lines 20   # 应看到"Sz-Teacher 已启动"
curl -s http://127.0.0.1:3000/api/auth/status   # 应返回 {"initialized":false,...}
```

或者在宝塔"网站 → Node 项目 → 添加"：项目目录选 `/www/wwwroot/sz-teacher`，启动命令填
`node --env-file-if-exists=.env server/index.ts`，端口 3000，并在环境变量里加
`SECURE_COOKIES=true`、`TRUST_PROXY=true`。

## 6. 网站与 HTTPS

1. 宝塔 → 网站 → 添加站点，域名填你的域名（纯静态即可，不需要 PHP）。
2. 站点设置 → SSL → Let's Encrypt → 申请，并开启"强制 HTTPS"。
3. 站点设置 → 配置文件，按 `deploy/nginx-site.conf` 加上反向代理配置，保存。
   **`proxy_buffering off` 一定要有**，否则解答不会边生成边显示。

**建议在启动前**在 `.env` 里加一行 `INITIAL_PASSWORD=你的密码`：程序第一次启动时会用它设置密码，之后可以从 `.env` 删掉。不预设的话，浏览器第一次打开会让你设置密码，在你设置之前任何人打开网站都能抢先设置。

> `SECURE_COOKIES=true` 时登录凭证只通过 HTTPS 发送。如果暂时只用 `http://IP:端口` 访问，需要把它改成 `false`，否则会登录不上。

## 7. 更新

```bash
cd /www/wwwroot/sz-teacher
git pull
npm ci --registry=https://registry.npmjs.org
npm run build
pm2 restart sz-teacher
```

数据库结构变化会在启动时自动迁移。

## 8. 备份

所有数据都在 `data/` 目录：`sz-teacher.db`（聊天记录、设置）和 `uploads/`（题目照片）。
宝塔 → 计划任务 → 备份目录，选 `/www/wwwroot/sz-teacher/data`，每天一次即可。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 登录后马上又回到登录页 | 用 http 访问但 `SECURE_COOKIES=true`；改用 https，或把它设为 false |
| 解答要等很久才一次性出现 | Nginx 没有 `proxy_buffering off` |
| 上传照片提示"请求太大" | Nginx 缺少 `client_max_body_size 40m` |
| 设置里"测试连接"失败 | 服务器访问不到供应商，运行 `npm run probe` 看具体原因 |
| 密码输错被锁 | 等 15 分钟；或 `pm2 restart sz-teacher` 立即解除 |
| 忘记密码 | `node scripts/reset-password.ts`，然后重新打开网页设置新密码 |
