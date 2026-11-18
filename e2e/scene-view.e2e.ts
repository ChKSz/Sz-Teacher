import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startE2EServer } from './run-server.ts';
import type { Scene } from '../shared/scene/types.ts';

let server: Awaited<ReturnType<typeof startE2EServer>>;
let browser: Browser;
let page: Page;
const errors: string[] = [];
// Dense circle construction inspired by the reported layout, not a replacement proof.
const fixture: Scene = {
  version: 1, title: '密集圆图 · 标签与视角回归测试',
  objects: [
    { id: 'C', type: 'point', x: 0, y: 0 }, { id: 'A', type: 'point', x: 3, y: 0 },
    { id: 'B', type: 'point', x: 0, y: 3 }, { id: 'D', type: 'point', x: -3, y: 0 },
    { id: 'E', type: 'point', x: 2.83, y: 1 }, { id: "E'", type: 'point', x: 2.83, y: -1, hidden: true },
    { id: 'P', type: 'point', x: 1.5, y: 1.5 }, { id: 'Q', type: 'point', x: 2.92, y: 0.5 },
    { id: "Q'", type: 'point', x: 2.92, y: -0.5, hidden: true },
    { id: 'circle', type: 'circle', center: 'C', radius: 3 },
    { id: 'BD', type: 'segment', from: 'B', to: 'D', label: '3√2' },
    { id: 'BA', type: 'segment', from: 'B', to: 'A', label: '3√2' },
    { id: 'DA', type: 'segment', from: 'D', to: 'A', label: '6' },
    { id: 'BE', type: 'segment', from: 'B', to: 'E', label: 'BE', dashed: true },
    { id: 'DE', type: 'segment', from: 'D', to: 'E', label: '√35', dashed: true },
    { id: "BE'", type: 'segment', from: 'B', to: "E'", label: "BE'", hidden: true, dashed: true },
    { id: "DE'", type: 'segment', from: 'D', to: "E'", label: '√35', hidden: true, dashed: true },
    { id: 'PQ', type: 'segment', from: 'P', to: 'Q', color: 'red', label: 'PQ' },
    { id: "PQ'", type: 'segment', from: 'P', to: "Q'", color: 'red', label: "PQ'", hidden: true },
  ],
  readouts: ['AC = 3', 'PQ = {dist(P,Q)}'],
  steps: [
    { say: '同侧情况', actions: [{ do: 'highlight', ids: ['PQ', 'BE'] }] },
    { say: '异侧情况', actions: [{ do: 'show', ids: ["E'", "Q'", "BE'", "DE'", "PQ'"] }, { do: 'highlight', ids: ["BE'", "DE'"] }] },
    { say: '对照', actions: [{ do: 'highlight', ids: ['PQ'] }] },
  ],
};
before(async () => {
  server = await startE2EServer();
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.url}/preview.html`);
  await page.waitForFunction(() => typeof window.__setScene === 'function');
  await page.evaluate(scene => window.__setScene!(scene), fixture);
  await page.locator('.scene-canvas').waitFor();
  await page.getByLabel('播放选项', { exact: true }).click();
  await page.getByRole('button', { name: '关闭朗读', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync('e2e/screenshots', { recursive: true });
});
after(async () => { await browser?.close(); await server?.close(); });

test('mobile dense figure: restrained labels, no duplicate fullscreen controls or static sample values', async () => {
  await page.getByRole('tab', { name: '第 2 步', exact: true }).click();
  assert.equal(await page.locator('filter').count(), 0, 'no glowing strokes');
  assert.equal(await page.getByRole('button', { name: '全屏看图' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '适应全图' }).count(), 0);
  assert.equal(await page.locator('.readouts').count(), 0);
  assert.ok(await page.locator('.seg-label').count() <= 3);
  const sizes = await page.locator('.pt-label').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height };
  }));
  assert.ok(sizes.length > 5 && sizes.every(size => size.height >= 13), 'labels remain readable on mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'e2e/screenshots/optimized-dense-mobile.png', fullPage: true });
});

test('zoom, pan, next step and fullscreen preserve the camera; reset fits all', async () => {
  await page.getByRole('button', { name: '放大图形' }).click();
  await page.getByRole('button', { name: '放大图形' }).click();
  const viewport = page.locator('.scene-viewport');
  const zoom = Number(await viewport.getAttribute('data-zoom'));
  assert.ok(zoom > 1.6);
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 35, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  const pan = await viewport.getAttribute('data-pan-x');
  assert.ok(Number(pan) < -20);
  await page.getByRole('tab', { name: '第 3 步', exact: true }).click();
  assert.equal(Number(await viewport.getAttribute('data-zoom')), zoom);
  await page.getByRole('button', { name: '全屏看图' }).click();
  assert.equal(await viewport.getAttribute('data-pan-x'), pan);
  await page.getByRole('button', { name: '退出全屏' }).click();
  assert.equal(Number(await viewport.getAttribute('data-zoom')), zoom);
  await page.getByRole('button', { name: '适应全图' }).click();
  assert.equal(await viewport.getAttribute('data-zoom'), '1');
  assert.equal(await viewport.getAttribute('data-pan-x'), '0');
});

test('touch pinch works in gesture mode and cancellation does not leave a stuck drag', async () => {
  await page.getByRole('button', { name: '手势看图', exact: true }).click();
  const viewport = page.locator('.scene-viewport');
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!;
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 65, y, id: 1 }, { x: x + 65, y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => Number(document.querySelector('.scene-viewport')?.getAttribute('data-zoom')) > 1.5);
  await cdp.detach();
  await page.getByRole('button', { name: '适应全图' }).click();
  await page.getByRole('button', { name: '退出手势', exact: true }).click();
  assert.equal(await viewport.evaluate(el => getComputedStyle(el).touchAction), 'pan-y');
});

test('fullscreen header and footer do not move while content scrolls; controls fit narrow screens', async () => {
  await page.getByRole('button', { name: '全屏看图', exact: true }).click();
  for (const width of [320, 360, 390, 480, 768]) {
    await page.setViewportSize({ width, height: 480 });
    const layout = await page.locator('.scene-fullscreen').evaluate(dialog => {
      const head = dialog.querySelector('.scene-head')!;
      const main = dialog.querySelector('.scene-main')!;
      const footer = dialog.querySelector('.scene-footer')!;
      const controls = [...footer.querySelectorAll('.scene-controls > button, .scene-options > summary')].map(el => el.getBoundingClientRect());
      const dots = [...footer.querySelectorAll('.dot')].map(el => el.getBoundingClientRect());
      const top = head.getBoundingClientRect().top;
      const bottom = footer.getBoundingClientRect().top;
      main.scrollTop = main.scrollHeight;
      return {
        dialogTop: dialog.getBoundingClientRect().top, top, bottom,
        afterTop: head.getBoundingClientRect().top, afterBottom: footer.getBoundingClientRect().top,
        mainTop: main.getBoundingClientRect().top, headBottom: head.getBoundingClientRect().bottom,
        mainBottom: main.getBoundingClientRect().bottom, controls: controls.map(r => [r.top, r.left, r.right]), dots: dots.map(r => r.top),
      };
    });
    assert.equal(layout.dialogTop, 0);
    assert.equal(layout.top, layout.afterTop);
    assert.equal(layout.bottom, layout.afterBottom);
    assert.ok(layout.mainTop >= layout.headBottom && layout.mainBottom <= layout.bottom + 1);
    assert.equal(new Set(layout.controls.map(r => r[0])).size, 1, `${width}px: playback controls fit on one row`);
    assert.ok(layout.controls.every(([, left, right]) => left! >= 0 && right! <= width));
    assert.equal(new Set(layout.dots).size, 1, `${width}px: all progress marks stay on one row`);
  }
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
});

test('focus is reversible and the canvas follows theme; captions collapse in fullscreen', async () => {
  await page.getByRole('tab', { name: '第 3 步', exact: true }).click();
  assert.equal(await page.locator('[data-id="BE\'"]').count(), 1);
  await page.getByLabel('播放选项', { exact: true }).click();
  await page.getByRole('button', { name: '仅看本步重点', exact: true }).click();
  assert.equal(await page.locator('[data-id="BE\'"]').count(), 0);
  assert.equal(await page.locator('[data-id="PQ"]').count(), 1);
  await page.getByLabel('播放选项', { exact: true }).click();
  await page.getByRole('button', { name: '完整图形', exact: true }).click();
  assert.equal(await page.locator('[data-id="BE\'"]').count(), 1);
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('.scene-canvas rect').first().evaluate(el => getComputedStyle(el).fill), 'rgb(33, 32, 29)');
  await page.screenshot({ path: 'e2e/screenshots/optimized-dense-dark.png', fullPage: true });
  await page.getByRole('button', { name: '全屏看图', exact: true }).click();
  await page.getByLabel('播放选项', { exact: true }).click();
  await page.getByRole('button', { name: '收起讲解文字', exact: true }).click();
  assert.equal(await page.locator('.scene-caption .markdown').isVisible(), false);
  await page.getByLabel('播放选项', { exact: true }).click();
  await page.getByRole('button', { name: '展开讲解文字', exact: true }).click();
  assert.equal(await page.locator('.scene-caption .markdown').isVisible(), true);
  assert.deepEqual(errors, []);
});
