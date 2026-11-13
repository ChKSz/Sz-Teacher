// 真实模型的完整流程：启动服务器 → 浏览器登录 → 提问 → 等解答 → 生成动画讲解 → 截图。
// 运行：node --env-file=.env scripts/e2e-real.ts "题目"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright-core';
import { loadConfig } from '../server/config.ts';
import { openDb } from '../server/db.ts';
import { UploadStore } from '../server/uploads.ts';
import { createApp } from '../server/app.ts';

const question = process.argv[2] ?? '如图，在△ABC中，AB=AC=5，BC=6，点D是BC的中点，点P从点B出发沿BA向点A运动，速度为每秒1个单位，设运动时间为t秒。当t为何值时，△BDP是直角三角形？';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sz-real-'));
const db = openDb(path.join(dataDir, 'db.sqlite'));
const app = createApp({ config: { ...loadConfig(), dataDir, webDir: path.resolve('dist') }, db, uploads: new UploadStore(dataDir) });
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
await new Promise<void>((r) => server.once('listening', () => r()));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const out = path.resolve('data/try/real');
fs.mkdirSync(out, { recursive: true });
try {
  await page.goto(url);
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByLabel('确认密码').fill('secret123');
  await page.getByRole('button', { name: '设置密码并进入' }).click();
  await page.getByLabel('输入题目').fill(question);
  let t0 = Date.now();
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('button', { name: '🎬 生成动画讲解' }).waitFor({ timeout: 300_000 });
  console.log(`解答完成 ${Date.now() - t0} ms`);
  await page.screenshot({ path: path.join(out, '1-answer.png'), fullPage: true });
  t0 = Date.now();
  await page.getByRole('button', { name: '🎬 生成动画讲解' }).click();
  await page.locator('.scene-player, .scene-section .error-text').first().waitFor({ timeout: 480_000 });
  console.log(`讲解完成 ${Date.now() - t0} ms`);
  const err = await page.locator('.scene-section .error-text').count();
  if (err) console.log('错误：', await page.locator('.scene-section .error-text').innerText());
  else {
    console.log('验算：', (await page.locator('.scene-player .badge').innerText().catch(() => '无')).trim());
    const voice = page.getByRole('button', { name: '关闭朗读' });
    if (await voice.count()) await voice.click();
    const steps = await page.locator('.step-dots .dot').count();
    for (let i = 1; i <= steps; i += 1) {
      await page.getByRole('tab', { name: `第 ${i} 步` }).click();
      await page.waitForTimeout(2500);
      await page.locator('.scene-player').screenshot({ path: path.join(out, `step-${String(i).padStart(2, '0')}.png`) });
    }
    console.log(`${steps} 步截图 → ${out}`);
  }
} finally {
  await browser.close();
  server.close();
  db.close();
}
