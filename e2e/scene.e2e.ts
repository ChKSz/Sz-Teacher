// 讲解播放器端到端测试：示例剧本能画出来、能分步播放、滑块能拖动。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startE2EServer } from './run-server.ts';
import { EXAMPLES } from '../shared/scene/examples.ts';

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const SHOT_DIR = path.resolve('e2e/screenshots');

let server: Awaited<ReturnType<typeof startE2EServer>>;
let browser: Browser;
let page: Page;

before(async () => {
  server = await startE2EServer();
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH ?? EDGE.find((p) => fs.existsSync(p)), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto(server.url);
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByLabel('确认密码').fill('secret123');
  await page.getByRole('button', { name: '设置密码并进入' }).click();
  await page.getByText('今天想弄懂哪道题？').waitFor();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function silence() {
  const options = page.getByLabel('播放选项', { exact: true });
  await options.click();
  const voice = page.getByRole('button', { name: '关闭朗读', exact: true });
  if (await voice.count()) await voice.click();
  else await options.click();
}

test('示例讲解：每个示例都能画出图形并逐步播放', async () => {
  await page.getByRole('button', { name: '示例讲解', exact: true }).click();
  await page.locator('.scene-canvas').waitFor();
  assert.match(page.url(), /#demo$/);

  for (const [i, scene] of EXAMPLES.entries()) {
    await page.getByRole('tab', { name: scene.title }).click();
    await page.locator('.scene-title', { hasText: scene.title }).waitFor();
    await page.locator('.badge.ok').waitFor();

    // 初始状态：可见的点都画出来了
    const visiblePoints = scene.objects.filter((o) => !o.hidden && ['point', 'onPath', 'midpoint', 'polar', 'rotate', 'foot', 'ratio'].includes(o.type));
    for (const p of visiblePoints) {
      assert.equal(await page.locator(`.scene-canvas [data-id="${p.id}"]`).count(), 1, `${scene.title}：点 ${p.id} 应该画出来`);
    }

    // 关闭朗读（无头浏览器没有语音），逐步点"下一步"
    await silence();
    for (let s = 0; s < scene.steps.length; s += 1) {
      await page.getByRole('tab', { name: `第 ${s + 1} 步` }).click();
      await page.locator('.step-no', { hasText: `第 ${s + 1}/${scene.steps.length} 步` }).waitFor();
    }
    // 等最后一步动画结束
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(SHOT_DIR, `scene-${i + 1}-end.png`) });

    // 本步 show 的对象都已出现
    const shown = new Set(scene.steps.flatMap((s) => (s.actions ?? []).flatMap((a) => (a.do === 'show' ? a.ids : []))));
    for (const id of shown) {
      const hidden = scene.steps.some((s) => (s.actions ?? []).some((a) => a.do === 'hide' && a.ids.includes(id)));
      if (!hidden) assert.ok((await page.locator(`.scene-canvas [data-id="${id}"]`).count()) >= 1, `${scene.title}：${id} 应该显示`);
    }
  }
  assert.deepEqual((page as unknown as { errors: string[] }).errors, []);
});

test('拖动滑块时动点跟着移动，实时数值随之变化', async () => {
  await page.getByRole('tab', { name: EXAMPLES[0]!.title }).click();
  const point = page.locator('.scene-canvas [data-id="P"] circle').last();
  const slider = page.getByRole('slider', { name: '运动时间 t（秒）' });
  await slider.fill('0');
  const x0 = Number(await point.getAttribute('cx'));
  const before = await page.locator('.readouts').innerText();
  await slider.fill('2');
  const x2 = Number(await point.getAttribute('cx'));
  const afterText = await page.locator('.readouts').innerText();
  assert.ok(x2 > x0 + 50, `P 应向右移动（${x0} → ${x2}）`);
  assert.notEqual(before, afterText);
  assert.match(afterText, /PB = 4/);
  await page.screenshot({ path: path.join(SHOT_DIR, 'scene-slider.png') });
});

test('自动播放能从头走到最后一步', async () => {
  await page.getByRole('tab', { name: EXAMPLES[2]!.title }).click();
  await silence();
  await page.getByRole('button', { name: '无声播放', exact: true }).click();
  const last = EXAMPLES[2]!.steps.length;
  await page.locator('.step-no', { hasText: `第 ${last}/${last} 步` }).waitFor({ timeout: 30_000 });
  await page.locator('.play-btn', { hasText: '无声播放' }).waitFor({ timeout: 15_000 });
});

test('手机尺寸下播放器可用', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: EXAMPLES[0]!.title }).click();
  await page.getByRole('tab', { name: '第 4 步' }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(SHOT_DIR, 'scene-mobile.png'), fullPage: true });
  const box = await page.locator('.scene-canvas').boundingBox();
  assert.ok(box && box.width <= 390 && box.width > 300, '画布应适应手机宽度');
});

test('暂停后从动画当前位置继续，最后一步暂停也不会跳回开头', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('tab', { name: EXAMPLES[0]!.title }).click();
  await silence();
  await page.getByLabel('播放选项', { exact: true }).click();
  await page.getByRole('button', { name: '回到开头', exact: true }).click();
  await page.getByRole('button', { name: '无声播放', exact: true }).click();
  await page.locator('.step-no', { hasText: '第 1/7 步' }).waitFor();
  await page.waitForFunction(() => Number(document.querySelector<HTMLInputElement>('.param-slider input')?.value) > 1);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const pausedValue = await page.getByRole('slider').inputValue();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('slider').inputValue(), pausedValue, '暂停后图形应保持不动');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  assert.ok(Number(await page.getByRole('slider').inputValue()) >= Number(pausedValue), '继续不能把动点重置到起点');
  await page.waitForTimeout(400);
  assert.ok(Number(await page.getByRole('slider').inputValue()) > Number(pausedValue), '继续后动点应当继续运动');
  await page.getByRole('button', { name: '暂停', exact: true }).click();

  await page.getByRole('tab', { name: '第 6 步', exact: true }).click();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.locator('.step-no', { hasText: '第 7/7 步' }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  assert.match(await page.locator('.step-no').innerText(), /第 7\/7 步/);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
});

test('手机可全屏看图，通过文字目录跳转，退出后保留步骤', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '全屏看图' }).click();
  const dialog = page.getByRole('dialog', { name: '全屏动画讲解' });
  await dialog.waitFor();
  await dialog.getByLabel('播放选项', { exact: true }).click();
  await dialog.getByText('跳到指定步骤', { exact: true }).click();
  await page.locator('.step-directory li').nth(2).getByRole('button').click();
  await page.locator('.step-no', { hasText: '第 3/7 步' }).waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, 'scene-fullscreen-mobile.png') });
  const next = await page.getByRole('button', { name: '下一步' }).boundingBox();
  assert.ok(next && next.width >= 44 && next.height >= 44, '手机播放按钮应足够大');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.match(await page.locator('.step-no').innerText(), /第 3\/7 步/);
});
