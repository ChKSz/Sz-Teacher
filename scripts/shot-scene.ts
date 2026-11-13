// 把剧本 JSON 逐步截图，检查画面效果。需要先 npm run build。
// 运行：node scripts/shot-scene.ts data/try/scene-0.json [输出目录]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';

const file = process.argv[2]!;
const outDir = process.argv[3] ?? path.join(path.dirname(file), path.basename(file, '.json'));
const scene = JSON.parse(fs.readFileSync(file, 'utf8'));
const dist = path.resolve('dist');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const target = path.join(dist, url === '/' ? 'preview.html' : url);
  if (!target.startsWith(dist) || !fs.existsSync(target)) {
    res.writeHead(404).end();
    return;
  }
  const ext = path.extname(target);
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(target));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/web/preview.html`;
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(fs.existsSync(path.join(dist, 'web/preview.html')) ? url : url.replace('/web/', '/'));
await page.waitForFunction(() => typeof window.__setScene === 'function');
await page.evaluate((s) => window.__setScene!(s), scene);
await page.locator('.scene-canvas').waitFor();
const voice = page.getByRole('button', { name: '关闭朗读' });
if (await voice.count()) await voice.click();
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < scene.steps.length; i += 1) {
  await page.getByRole('tab', { name: `第 ${i + 1} 步` }).click();
  const total = (scene.steps[i].actions ?? []).filter((a: { do: string }) => a.do === 'animate').reduce((s: number, a: { duration?: number }) => s + (a.duration ?? 1.5), 0);
  await page.waitForTimeout(total * 1000 + 300);
  await page.locator('.scene-player').screenshot({ path: path.join(outDir, `step-${String(i + 1).padStart(2, '0')}.png`) });
}
console.log(`${scene.steps.length} 张截图 → ${outDir}`);
if (errors.length) console.log('页面错误：', errors);
await browser.close();
server.close();
