// 端到端测试：用本机 Edge 浏览器操作真实页面。
// 运行前先 npm run build。运行：npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startE2EServer } from './run-server.ts';
import { TINY_PNG } from '../tests/helpers.ts';

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

let server: Awaited<ReturnType<typeof startE2EServer>>;
let browser: Browser;
export const SHOT_DIR = path.resolve('e2e/screenshots');

before(async () => {
  if (!fs.existsSync('dist/index.html')) throw new Error('请先运行 npm run build');
  server = await startE2EServer();
  const executablePath = process.env.BROWSER_PATH ?? EDGE_PATHS.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('找不到 Edge/Chrome，可用 BROWSER_PATH 指定');
  browser = await chromium.launch({ executablePath, headless: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function newPage(width = 1280, height = 860): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (err) => {
    throw err;
  });
  return page;
}

test('设置密码 → 提问 → 流式回答 → 追问 → 刷新后记录还在 → 退出再登录', async () => {
  const page = await newPage();
  await page.goto(server.url);

  // 首次使用：设置密码
  await page.getByText('第一次使用').waitFor();
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByLabel('确认密码').fill('secret123');
  await page.getByRole('button', { name: '设置密码并进入' }).click();
  await page.getByText('今天想弄懂哪道题？').waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, '1-welcome.png') });

  // 提问
  await page.getByLabel('输入题目').fill('点P从A出发每秒2个单位，AB=8，求t');
  await page.getByRole('button', { name: '发送' }).click();
  await page.locator('.msg.assistant .katex-display').first().waitFor();
  await page.getByText('答案：').waitFor();
  assert.equal(await page.locator('.msg.user').count(), 1);
  assert.equal(await page.locator('.msg.assistant').count(), 1);
  assert.ok((await page.locator('.msg.assistant .katex').count()) >= 3, '公式应被 KaTeX 渲染');
  await page.locator('.conv-item.active').getByText('点P从A出发').waitFor();
  assert.match(page.url(), /#c=[0-9a-f-]{36}$/);

  // 追问
  await page.getByLabel('输入题目').fill('为什么PB是8-2t？');
  await page.keyboard.press('Enter');
  await page.getByText('因为').waitFor();
  assert.equal(await page.locator('.msg.assistant').count(), 2);
  await page.screenshot({ path: path.join(SHOT_DIR, '2-chat.png') });

  // 刷新后记录还在（通过地址栏 #c= 回到同一道题）
  await page.reload();
  await page.getByText('因为').waitFor();
  assert.equal(await page.locator('.msg').count(), 4);

  // 模型请求里带了上下文
  const lastRequest = server.provider.requests.at(-1)!;
  assert.deepEqual(
    (lastRequest.messages as { role: string }[]).map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
  );

  // 生成动画讲解：按钮 → 进度 → 播放器出现，刷新后仍在
  await page.getByRole('button', { name: '生成动画讲解' }).first().click();
  await page.locator('.msg.assistant .scene-player').first().waitFor({ timeout: 20_000 });
  await page.locator('.msg.assistant .badge.ok').first().waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, '2b-scene-inline.png') });
  await page.reload();
  await page.locator('.msg.assistant .scene-player').first().waitFor();

  // 在讲解某一步点"这步没懂"，自动发出带步骤内容的追问
  const before = await page.locator('.msg.user').count();
  await page.getByRole('tab', { name: '第 4 步' }).first().click();
  await page.getByRole('button', { name: '这步没懂' }).first().click();
  await page.locator('.msg.user').nth(before).waitFor();
  const askText = await page.locator('.msg.user').nth(before).innerText();
  assert.match(askText, /第 4 步/);
  assert.match(askText, /PB=BC/);
  await page.locator('.msg.assistant').nth(before).locator('.msg-actions').waitFor();

  // 错题本：收藏 + 笔记，侧边栏筛选
  await page.getByRole('button', { name: '加入错题本' }).click();
  await page.getByRole('button', { name: '移出错题本' }).waitFor();
  await page.getByRole('button', { name: '错题笔记' }).click();
  await page.getByRole('textbox', { name: '错题笔记' }).fill('漏了 P 与 B 重合的情况');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await page.locator('.note-text', { hasText: '漏了 P 与 B 重合的情况' }).waitFor();
  await page.getByRole('tab', { name: /错题本/ }).click();
  await page.locator('.conv-item .star-mark').first().waitFor();
  await page.reload();
  await page.locator('.note-text', { hasText: '漏了 P 与 B 重合的情况' }).waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, '2c-notes.png') });

  // 设置面板：密钥打码、测试连接
  await page.getByRole('button', { name: '设置' }).click();
  const keyInput = page.getByPlaceholder(/已保存 sk-…3456/);
  await keyInput.waitFor();
  await page.getByRole('button', { name: '测试连接' }).click();
  await page.getByText(/连接成功/).waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, '3-settings.png') });
  const html = await page.content();
  assert.ok(!html.includes('sk-test-key-123456'), '页面里不能出现完整密钥');

  // 退出再登录
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('button', { name: '登录' }).waitFor();
  await page.getByLabel('密码', { exact: true }).fill('wrong-pass');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('密码不正确').waitFor();
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('点P从A出发').first().waitFor();
  await page.context().close();
});

test('上传图片提问，手机尺寸下侧边栏可以打开', async () => {
  const page = await newPage(390, 844);
  await page.goto(server.url);
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('今天想弄懂哪道题？').waitFor();

  const file = path.join(os.tmpdir(), 'sz-e2e-question.png');
  fs.writeFileSync(file, Buffer.from(TINY_PNG.split(',')[1]!, 'base64'));
  await page.locator('input[type=file][multiple]').setInputFiles(file);
  await page.locator('.thumb img').waitFor();
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByText('我看到了图片里的题目').waitFor();
  const img = page.locator('.msg.user img');
  await img.waitFor();
  assert.ok(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0), '图片应能从服务器加载');
  await page.screenshot({ path: path.join(SHOT_DIR, '4-mobile-image.png') });

  // 手机布局：侧边栏默认隐藏，点按钮后出现
  await page.getByRole('button', { name: '打开题目列表' }).click();
  await page.getByRole('button', { name: '新题目' }).click();
  await page.getByText('今天想弄懂哪道题？').waitFor();
  fs.rmSync(file, { force: true });
  await page.context().close();
});
