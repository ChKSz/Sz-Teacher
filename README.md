# Sz-Teacher 📐

初中数学一对一 AI 讲师：拍照或输入题目 → 分步解答 → 一键生成**带朗读的几何动画讲解**（动点会动、辅助线一步步画出来、可以拖动滑块自己观察）。

## 功能

- **解题**：打字、粘贴或拍照上传题目，解答边生成边显示，公式排版清晰；可以随时追问。
- **动画讲解**：模型把解答改写成"讲解剧本"，程序负责画图、播放、朗读。
  - 动点沿边运动、旋转、对称、函数图象、动点轨迹等常见初中图形
  - 每一步：动画 + 高亮 + 朗读；可暂停、回退、重播、拖动参数滑块
  - **验算**：程序把每个结论代回图形计算，不成立就让模型修正；仍不通过会标出"验算未通过"
  - 某一步没看懂，点"🙋 这步没懂"直接追问
- **错题本**：收藏题目、写错因笔记，侧边栏筛选和搜索
- **讲解风格**：直接讲解，或"先给提示，让我自己想"
- **云端同步**：部署到自己的服务器，手机、电脑登录同一个密码，记录自动同步

## 本地运行

需要 Node.js 24 以上。

```bash
npm install
cp .env.example .env      # 填入 LLM_API_KEY
npm run build
npm start                 # 打开 http://127.0.0.1:3000
```

开发时用 `npm run dev`（前端 http://localhost:5173，修改代码自动刷新）。

## 部署到服务器

见 [DEPLOY.md](DEPLOY.md)（宝塔面板 + PM2 + Nginx + HTTPS）。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run probe` | 检测模型供应商支持哪些能力（对话、流式、图片、JSON 等） |
| `npm test` | 单元测试与接口测试 |
| `npm run test:e2e` | 用本机 Edge 浏览器做端到端测试（先 `npm run build`） |
| `npm run typecheck` | 类型检查 |
| `node --env-file=.env scripts/smoke-real.ts` | 用真实模型跑一遍解题和追问 |
| `node --env-file=.env scripts/try-scene.ts 0` | 用真实模型为示例题生成动画讲解 |
| `node scripts/shot-scene.ts <剧本.json>` | 把剧本逐步截图，检查画面 |
| `node scripts/reset-password.ts` | 忘记密码时清除密码 |

## 结构

```
server/        后端（Hono + Node 自带 SQLite）
  app.ts         接口：登录、设置、对话、动画讲解
  llm.ts         OpenAI 兼容接口客户端
  sceneGen.ts    生成剧本 → 校验验算 → 修正 的循环
  scenePrompt.ts 剧本格式说明（给模型看的）
shared/scene/  剧本格式、几何计算引擎、表达式求值、校验器、示例剧本（前后端共用）
web/src/       前端（React）
  scene/         SVG 绘图与讲解播放器
tests/         单元与接口测试（vitest）
e2e/           浏览器端到端测试
```

数据都在 `data/`：`sz-teacher.db`（记录、设置）和 `uploads/`（题目照片）。备份这个目录即可。
