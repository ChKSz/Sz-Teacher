# 首次部署到宝塔服务器

应用使用 Node.js 24、PM2 单进程和 SQLite。Nginx 提供 HTTPS，并把网页和接口全部转发给 `127.0.0.1:3000`。

## 1. 准备服务器和域名

- 域名添加 A 记录，指向服务器公网 IP。
- 宝塔安装 Nginx、Node.js 版本管理器和 Node.js 24（必须 ≥ 24，后端直接运行 TypeScript 并使用内置 SQLite）。
- 安装 PM2 管理器，或使用宝塔的 Node 项目管理。两种进程管理方式只选一种，避免重复启动。
- 终端执行 `node -v`、`npm -v`、`pm2 -v`，确认当前用户使用的是刚安装的 Node.js 24。以下 PM2 命令始终使用同一个系统用户。
- 安全组和防火墙放行 80、443；应用端口 3000 保持仅本机监听。

## 2. 上传发布包

本地准备的 `release/sz-teacher-production-*.zip` 包含当前源码和已构建的 `dist/`，不含 `.env`、本机 `data/`、`node_modules/` 和 Git 历史。发布包可包含尚未提交的代码，因此应以随包的发布说明和校验值确认版本。

宝塔文件管理器创建 `/www/wwwroot/sz-teacher`，上传 ZIP 并解压到该目录。确认 `package.json`、`server/`、`shared/`、`dist/` 都直接位于该目录下，避免多套一层目录。

在宝塔终端安装运行依赖：

```bash
cd /www/wwwroot/sz-teacher
npm ci --omit=dev --registry=https://registry.npmjs.org
```

使用发布包时，前端已经构建完成，无需在服务器重新构建。

如果从 Git 或普通源码包部署，则安装完整依赖后构建：

```bash
cd /www/wwwroot/sz-teacher
npm ci --include=dev --registry=https://registry.npmjs.org
npm run typecheck
npm test
npm run build
```

## 3. 启动前配置密码和模型

```bash
cd /www/wwwroot/sz-teacher
cp .env.example .env
chmod 600 .env
nano .env
mkdir -p data
chmod 700 data
```

首次部署在 `.env` 中填写以下配置，密码换成自己的长密码：

```dotenv
LLM_BASE_URL=https://你的模型服务地址/v1
LLM_API_KEY=填写模型密钥
LLM_MODEL=填写可用模型名称
INITIAL_PASSWORD="替换为自己的长密码"
HOST=127.0.0.1
PORT=3000
SECURE_COOKIES=true
TRUST_PROXY=true
```

`INITIAL_PASSWORD` 至少 6 位，建议使用 16 位以上随机密码。必须在首次启动前设置，防止其他人抢先初始化。密码包含 `#` 或空格时应使用引号。不要上传本机 `.env` 或把密钥粘贴到聊天中。

小米语音为可选项：填写 `MIMO_API_KEY`，或上线后在“学习设置 → 朗读”中配置。

运行供应商探测（会调用真实供应商，可能产生费用）：

```bash
npm run probe
```

确认“基本对话”可用。模型、语音配置也可以稍后在网页设置中完成。服务器应能连通所选供应商。

## 4. 通过 PM2 启动

```bash
cd /www/wwwroot/sz-teacher
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs sz-teacher --lines 30 --nostream
curl -fsS http://127.0.0.1:3000/api/auth/status
```

应看到“Sz-Teacher 已启动”，状态接口应返回：

```json
{"initialized":true,"authenticated":false}
```

如果 `initialized` 为 `false`，先停止应用，检查 `.env` 中的 `INITIAL_PASSWORD`，重新启动并确认成功后再开放网站。

配置开机自启：

```bash
pm2 startup
```

按照 PM2 输出执行对应的系统服务注册命令，再执行 `pm2 save`。**`pm2 save` 只保存进程列表，不能单独完成开机自启。** 如果通过宝塔管理 PM2，确认面板已开启对应的开机自启。

宝塔“网站 → Node 项目”替代方案：目录选 `/www/wwwroot/sz-teacher`，启动命令用 `node --env-file-if-exists=.env server/index.ts`，端口 3000，进程数量 1，使用上面的 `.env`。不要同时再用命令行 PM2 启动同一个应用。

## 5. 配置站点和 HTTPS

1. 宝塔添加静态站点，填写域名。**站点根目录设为独立空目录 `/www/wwwroot/sz-teacher-public`**，由宝塔创建；应用仍位于 `/www/wwwroot/sz-teacher`。站点根目录不能指向源码、`data/` 或发布 ZIP。
2. 在 SSL 中申请 Let's Encrypt 证书，开启“强制 HTTPS”，保留宝塔的证书续签验证配置。
3. 按 [deploy/nginx-site.conf](deploy/nginx-site.conf) 配置反向代理。片段放入现有 `server { }` 中；已有 `location /` 时替换，避免重复。删除默认针对 JS、CSS、图片的静态缓存 `location`，避免请求被截走而无法进入应用；无需 PHP。
4. 保存前用宝塔“配置检测”验证 Nginx 配置，成功后重载 Nginx。

关键配置：

- `Host` 和 `X-Forwarded-Host` 都使用 `$http_host`，用于正确校验登录请求来源。
- `X-Real-IP` 使用 `$remote_addr`，用于密码重试限速。
- `proxy_buffering off`、`proxy_cache off`，保证解答逐字输出。
- `client_max_body_size 40m`，允许上传题目照片。
- 代理读写超时 600 秒，允许较长的模型调用。

如果用宝塔“反向代理”功能，目标为 `http://127.0.0.1:3000`，“发送域名”为 `$http_host`，再补齐上面的代理头、超时和缓冲配置。所有请求都经应用处理，题目图片和语音下载仍需登录。

## 6. 上线验收

把下面命令中的域名替换为实际域名：

```bash
curl -fsS https://你的域名/api/auth/status
```

应返回 `initialized: true`。随后在浏览器确认：

- HTTPS 打开并用预设密码登录；刷新页面仍然登录。
- 文字提问能流式显示答案，追问和公式正常。
- 上传一道图片题，确认图片和回答正常，刷新后题目仍在。
- 生成动画讲解；使用小米语音时，保存配置并试听。
- 退出登录后，历史题目、题目图片和音频接口要求重新登录。

PM2 日志没有持续异常后，可从 `.env` 中删除 `INITIAL_PASSWORD`；数据库中已保存的密码仍有效。

本地测试使用模拟模型供应商；服务器上的真实模型、语音、域名和证书需要在这里验收。

## 7. 备份与后续更新

数据目录 `data/` 包含数据库、题目照片和可重建的语音缓存。数据库和设置含供应商密钥，备份应放在站点目录之外并限制访问。`.env` 单独妥善保存。

SQLite 使用 WAL 模式，不能只复制运行中的 `.db` 文件。小规模自用部署可采用短暂停机备份，以下命令按顺序执行，每一步成功后再继续：

```bash
cd /www/wwwroot/sz-teacher
mkdir -p /www/backup/sz-teacher
chmod 700 /www/backup/sz-teacher
pm2 stop sz-teacher
# 确认进程已停止后备份整个数据目录
tar -czf "/www/backup/sz-teacher/data-$(date +%Y%m%d-%H%M%S).tar.gz" data
pm2 start sz-teacher
```

如果备份失败，仍需执行 `pm2 start sz-teacher` 恢复服务。可以将同样的停机、备份、恢复流程配置为宝塔计划任务；仅选“备份目录”无法保证运行中 SQLite 的一致性。备份后应在独立目录验证可恢复，禁止覆盖在线数据库。

更新前保存旧版代码和构建产物，完成上面的备份。Git 部署可执行：

```bash
cd /www/wwwroot/sz-teacher
git pull --ff-only
npm ci --include=dev --registry=https://registry.npmjs.org
npm run typecheck
npm test
npm run build
pm2 restart ecosystem.config.cjs --update-env
```

发布包部署用新包更新程序文件，保留服务器 `.env` 和 `data/`，安装运行依赖后重启。数据库启动时自动迁移；发生问题时应按同一备份时点恢复代码和数据，不能只换回旧代码。

## 常见问题

| 现象 | 处理 |
|---|---|
| 登录后回到登录页 | 用 HTTPS 访问，生产保持 `SECURE_COOKIES=true` |
| 提示“拒绝跨站请求” | 按模板覆盖 `Host`、`X-Forwarded-Host`，发送域名使用 `$http_host` |
| 解答全部生成后才显示 | 检查代理的 `proxy_buffering off` 和缓存设置 |
| JS、CSS、图片返回 404 | 删除宝塔默认静态缓存匹配段，让请求转发给 Node |
| 上传提示请求太大 | 检查 `client_max_body_size 40m` |
| 模型连接失败 | 在服务器执行 `npm run probe`，检查地址、密钥、模型和出站网络 |
| 重启服务器后应用没启动 | 检查 `pm2 startup` 的系统服务注册及 `pm2 save` |
| 密码输错被锁 | 等待 15 分钟 |
| 忘记密码 | 先限制公网访问，停止应用，执行 `node --env-file-if-exists=.env scripts/reset-password.ts`；在 `.env` 设置新 `INITIAL_PASSWORD` 后启动，确认密码已初始化再恢复访问 |
