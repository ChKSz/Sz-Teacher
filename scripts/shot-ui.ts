// 开发用：截取各主要界面（浅色 + 深色、桌面 + 手机），检查视觉效果。
// 先 npm run build，再运行：node scripts/shot-ui.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startE2EServer } from '../e2e/run-server.ts';

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const OUT = path.resolve('e2e/screenshots/ui');
fs.mkdirSync(OUT, { recursive: true });

const server = await startE2EServer();
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? EDGE.find((p) => fs.existsSync(p)), headless: true });

const settle = (page: Page) => page.waitForTimeout(700);

async function run(scheme: 'light' | 'dark', width: number, height: number, tag: string, first: boolean) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', colorScheme: scheme });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('pageerror', err));
  const shot = async (name: string) => {
    await settle(page);
    await page.screenshot({ path: path.join(OUT, `${tag}-${scheme}-${name}.png`) });
  };
  await page.goto(server.url);
  if (first) {
    await page.getByText('第一次使用').waitFor();
    await shot('0-setup');
    await page.getByLabel('密码', { exact: true }).fill('secret123');
    await page.getByLabel('确认密码').fill('secret123');
    await page.getByRole('button', { name: '设置密码并进入' }).click();
  } else {
    await page.getByLabel('密码', { exact: true }).waitFor();
    await shot('0-login');
    await page.getByLabel('密码', { exact: true }).fill('secret123');
    await page.getByRole('button', { name: '登录' }).click();
  }
  await page.getByText('今天想弄懂哪道题？').waitFor();
  await shot('1-welcome');

  await page.getByLabel('输入题目').fill('点P从A出发每秒2个单位，AB=8，求t');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByText('答案：').waitFor();
  await shot('2-answer');

  await page.getByRole('button', { name: '生成动画讲解' }).first().click();
  await page.locator('.msg.assistant .scene-player').first().waitFor({ timeout: 20_000 });
  await page.getByLabel('播放选项', { exact: true }).first().click();
  const voice = page.getByRole('button', { name: '关闭朗读' });
  if (await voice.count()) await voice.first().click();
  await page.getByRole('tab', { name: '第 3 步' }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.msg.assistant .scene-player').first().scrollIntoViewIfNeeded();
  await shot('3-scene');

  await page.getByRole('button', { name: '错题笔记' }).click();
  await page.getByRole('textbox', { name: '错题笔记' }).fill('漏了 P 与 B 重合的情况');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await shot('4-note');

  if (width < 700) {
    await page.getByRole('button', { name: '打开题目列表' }).click();
    await shot('5-sidebar');
    await page.getByRole('button', { name: '关闭题目列表' }).click();
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await shot('6-settings');
  await page.keyboard.press('Escape');

  if (width < 700 && !(await page.locator('.layout.sidebar-open').count())) await page.getByRole('button', { name: '打开题目列表' }).click();
  await page.locator('.conv-item').first().hover();
  await page.getByRole('button', { name: /^删除/ }).first().click();
  await shot('7-confirm');
  await page.getByRole('button', { name: '取消' }).click();

  if (width < 700 && !(await page.locator('.layout.sidebar-open').count())) await page.getByRole('button', { name: '打开题目列表' }).click();
  await page.getByRole('button', { name: '示例讲解', exact: true }).click();
  await page.locator('.scene-canvas').waitFor();
  if (await voice.count()) await voice.first().click();
  await page.getByRole('tab', { name: '第 4 步' }).click();
  await page.waitForTimeout(1500);
  await shot('8-demo');
  await context.close();
}

try {
  await run('light', 1280, 860, 'desk', true);
  await run('dark', 1280, 860, 'desk', false);
  await run('light', 390, 844, 'phone', false);
  await run('dark', 390, 844, 'phone', false);
  console.log('截图已保存到', OUT);
} finally {
  await browser.close();
  await server.close();
}
