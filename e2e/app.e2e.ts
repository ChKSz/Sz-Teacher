// 端到端测试：用本机 Edge 浏览器操作真实页面。
// 运行前先 npm run build。运行：npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startE2EServer } from './run-server.ts';
import { TINY_PNG, TEST_WAV } from '../tests/helpers.ts';
import { rectangleMovingPoint } from '../shared/scene/examples.ts';

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
  await page.getByLabel('知识点', { exact: true }).fill('等腰三角形');
  await page.getByLabel('错因', { exact: true }).fill('遗漏分类');
  await selectMenu(page, '复习状态', '已掌握');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await page.locator('.note-text', { hasText: '漏了 P 与 B 重合的情况' }).waitFor();
  await page.getByRole('tab', { name: /错题本/ }).click();
  await selectMenu(page, '筛选复习状态', '待复习');
  await page.getByText('没有符合条件的题目').waitFor();
  await selectMenu(page, '筛选复习状态', '已掌握');
  await selectMenu(page, '筛选知识点', '等腰三角形');
  await page.locator('.conv-item .star-mark').first().waitFor();
  await page.reload();
  await page.locator('.note-text', { hasText: '漏了 P 与 B 重合的情况' }).waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, '2c-notes.png') });

  // 设置面板：密钥打码、测试连接
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '学习设置' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '测试连接' }).isVisible(), false);
  await page.getByRole('tab', { name: '高级配置' }).click();
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

test('手机拍题入口可用，旋转裁剪后的图片正确发送，讲解方式和快捷追问可用', async () => {
  const page = await newPage(390, 844);
  await page.goto(server.url);
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByText('今天想弄懂哪道题？').waitFor();
  await page.getByRole('button', { name: '模型与讲解设置', exact: true }).click();
  await page.getByRole('button', { name: '先给提示', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.choice-grid.teaching button')?.getAttribute('aria-pressed') === 'true');
  await page.keyboard.press('Escape');

  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = '#be633f'; ctx.fillRect(20, 20, 100, 100);
    ctx.fillStyle = 'black'; ctx.font = '24px sans-serif'; ctx.fillText('数学题：求三角形面积', 20, 160);
    return canvas.toDataURL('image/png');
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '拍照', exact: true }).click();
  await (await chooser).setFiles({ name: '题目.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1]!, 'base64') });
  await page.getByRole('button', { name: '编辑图片 1' }).click();
  await page.getByRole('button', { name: '向右旋转' }).click();
  await page.waitForFunction(() => (document.querySelector('.crop-stage img') as HTMLImageElement)?.naturalWidth === 200);
  await page.getByLabel('右边界').fill('50');
  await page.screenshot({ path: path.join(SHOT_DIR, 'image-editor-mobile.png') });
  await page.getByRole('button', { name: '保存图片' }).click();
  await page.waitForFunction(() => (document.querySelector('.thumb img') as HTMLImageElement)?.naturalWidth === 100);
  assert.equal(await page.locator('.thumb img').evaluate((img) => (img as HTMLImageElement).naturalHeight), 400);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('我看到了图片里的题目').waitFor();
  const system = (server.provider.requests.at(-1)!.messages as { content: string }[])[0]!.content;
  assert.match(system, /启发式/);
  await page.getByRole('button', { name: '检查我的解法' }).click();
  assert.match(await page.getByLabel('输入题目').inputValue(), /我的解法是/);
  const before = await page.locator('.msg.user').count();
  await page.getByRole('button', { name: '给我提示', exact: true }).click();
  await page.locator('.msg.assistant').nth(before).locator('.msg-actions').waitFor();
  assert.equal(await page.locator('.msg.user').count(), before + 1);
  await page.context().close();
});

test('动画刷新恢复生成进度，失败保留旧动画并可重试', async () => {
  const page = await newPage();
  await page.goto(server.url);
  await page.getByLabel('密码', { exact: true }).fill('secret123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByLabel('输入题目').fill('测试动画恢复：矩形中的动点');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '生成动画讲解' }).waitFor();
  const originalReply = server.provider.reply;
  let finish!: (value: string) => void;
  server.provider.reply = () => new Promise<string>((resolve) => { finish = resolve; });
  try {
    await page.getByRole('button', { name: '生成动画讲解' }).click();
    await page.locator('.scene-working').waitFor();
    await page.reload();
    await page.locator('.scene-working').waitFor();
    await page.locator('.conv-scene-status.working').waitFor();
    finish(JSON.stringify(rectangleMovingPoint));
    await page.locator('.scene-player').waitFor({ timeout: 15_000 });
    server.provider.failWith = 429;
    await page.getByRole('button', { name: '重新生成', exact: true }).click();
    await page.getByText('重新生成失败，已保留原来的动画。', { exact: false }).waitFor();
    assert.equal(await page.locator('.scene-player').count(), 1);
    await page.reload();
    await page.getByRole('button', { name: '重试生成' }).waitFor();
    assert.equal(await page.locator('.scene-player').count(), 1);
    server.provider.failWith = null;
    server.provider.reply = JSON.stringify(rectangleMovingPoint);
    await page.getByRole('button', { name: '重试生成' }).click();
    await page.locator('.scene-error').waitFor({ state: 'hidden' });
    await page.locator('.scene-working').waitFor({ state: 'hidden' });
    await page.locator('.conv-scene-status.done').first().waitFor();
  } finally {
    finish?.(JSON.stringify(rectangleMovingPoint));
    server.provider.reply = originalReply;
    server.provider.failWith = null;
    await page.context().close();
  }
});

async function selectMenu(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('消息下方可复制公式原文并重试失败请求，生成时禁止重复重试', async () => {
  const page = await newPage(390, 844);
  const originalReply = server.provider.reply;
  let finish: ((text: string) => void) | undefined;
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedText: string }).copiedText = text; } } });
    });
    await page.goto(server.url);
    await page.getByLabel('密码', { exact: true }).fill('secret123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const question = '求解 $x^2=4$，保留公式原文';
    server.provider.failWith = 429;
    await page.getByLabel('输入题目').fill(question);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const failed = page.locator('.msg.assistant.is-error');
    await failed.waitFor();
    await page.locator('.msg.user').getByRole('button', { name: '复制内容', exact: true }).click();
    await page.locator('.msg.user').getByRole('button', { name: '已复制', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText), question);
    server.provider.failWith = null;
    server.provider.reply = () => new Promise<string>((resolve) => { finish = resolve; });
    await failed.getByRole('button', { name: '重试请求', exact: true }).click();
    await page.locator('.streaming').waitFor();
    assert.ok((await page.getByRole('button', { name: '重试请求', exact: true }).all()).length >= 3);
    for (const button of await page.getByRole('button', { name: '重试请求', exact: true }).all()) assert.equal(await button.isDisabled(), true);
    const answer = '**重新解答**：$x=\\pm 2$';
    while (!finish) await page.waitForTimeout(20);
    finish(answer);
    await page.locator('.msg.assistant').last().getByRole('button', { name: '复制内容', exact: true }).waitFor();
    assert.equal(await page.locator('.msg.user').count(), 2);
    assert.equal(await page.locator('.msg.assistant').count(), 2);
    const messages = server.provider.requests.at(-1)!.messages as { role: string; content: string }[];
    assert.deepEqual(messages.map((message) => message.role), ['system', 'user']);
    assert.equal(messages.at(-1)!.content, question);
    await page.locator('.msg.assistant').last().getByRole('button', { name: '复制内容', exact: true }).click();
    await page.locator('.msg.assistant').last().getByRole('button', { name: '已复制', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText), answer);
    await page.screenshot({ path: path.join(SHOT_DIR, 'message-actions-mobile.png') });
    await page.reload();
    await page.locator('.msg.assistant').nth(1).waitFor();
    assert.equal(await page.locator('.msg.user').count(), 2);
  } finally {
    finish?.('结束测试'); server.provider.reply = originalReply; server.provider.failWith = null;
    await page.context().close();
  }
});

test('模型列表与菜单保存到服务端，公式可输入预览，桌面侧栏折叠后刷新保持', async () => {
  const page = await newPage();
  try {
    await page.goto(server.url);
    await page.getByLabel('密码', { exact: true }).fill('secret123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('今天想弄懂哪道题？').waitFor();
    assert.equal(await page.locator('.welcome-actions, .tips').count(), 0);
    await page.getByRole('button', { name: '收起侧边栏' }).click();
    await page.getByRole('button', { name: '展开侧边栏' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    await page.getByRole('button', { name: '收起侧边栏' }).waitFor();
    await page.getByRole('button', { name: '模型与讲解设置', exact: true }).click();
    await page.getByRole('button', { name: '管理模型与语音' }).click();
    await page.getByRole('button', { name: '获取模型列表' }).click();
    await page.getByText('已获取 2 个模型，供应商与列表已保存到服务器').waitFor();
    await page.getByRole('combobox', { name: '解题模型', exact: true }).click();
    await page.screenshot({ path: path.join(SHOT_DIR, 'model-select-desktop.png') });
    await page.getByRole('option', { name: 'other-model', exact: true }).click();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByText('已保存', { exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('button', { name: '模型与讲解设置', exact: true }).click();
    await page.getByRole('button', { name: '深入', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.choice-grid button:last-child')?.getAttribute('aria-pressed') === 'true');
    await page.getByRole('button', { name: '完整讲解', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.choice-grid.teaching button:last-child')?.getAttribute('aria-pressed') === 'true');
    await page.screenshot({ path: path.join(SHOT_DIR, 'model-menu-desktop.png') });
    await page.reload();
    await page.getByRole('button', { name: '模型与讲解设置', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'other-model', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: '深入', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '公式输入与预览' }).click();
    await page.getByRole('button', { name: '分数', exact: true }).click();
    assert.equal(await page.getByLabel('输入题目').inputValue(), '$\\frac{x}{b}$');
    await page.getByLabel('输入题目').fill('求解 \\(x^2=4\\)');
    await page.locator('.math-preview .katex').waitFor();
    const focus = await page.getByLabel('输入题目').evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
    assert.deepEqual(focus, { outline: 'none', shadow: 'none' });
    assert.equal(await page.locator('select').count(), 0);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('.msg.user .katex').waitFor();
    await page.getByText('答案：').waitFor();
    assert.equal(server.provider.requests.at(-1)?.model, 'other-model');
    assert.equal(server.provider.requests.at(-1)?.reasoning_effort, 'high');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '模型与讲解设置', exact: true }).click();
    await page.screenshot({ path: path.join(SHOT_DIR, 'model-menu-mobile-light.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(SHOT_DIR, 'model-menu-mobile-dark.png') });
    assert.ok(await page.locator('.model-menu-popup').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await page.context().close(); }
});

test('完整语音提前准备并缓存，倍速保留音调，回复灰显与动画等待状态正确', async () => {
  const page = await newPage(390, 844);
  const originalReply = server.provider.reply;
  let release: (() => void) | undefined;
  try {
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      const scope = window as unknown as { testAudio: HTMLAudioElement[] };
      scope.testAudio = [];
      window.Audio = function (src?: string) { const audio = new NativeAudio(src); scope.testAudio.push(audio); return audio; } as unknown as typeof Audio;
    });
    await page.goto(server.url);
    await page.getByLabel('密码', { exact: true }).fill('secret123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('combobox', { name: '朗读来源', exact: true }).click();
    await page.getByRole('option', { name: /小米 MiMo/ }).click();
    await page.getByLabel('小米语音接口地址', { exact: true }).fill(server.provider.baseUrl);
    await page.getByLabel('小米语音密钥', { exact: true }).fill('sk-test-key-123456');
    await page.getByRole('slider', { name: /语速/ }).fill('1.8');
    const preview = page.waitForResponse((res) => res.url().endsWith('/api/tts/prepare'));
    await page.getByRole('button', { name: '保存并试听' }).click();
    assert.equal((await preview).status(), 200);
    await page.getByRole('button', { name: '保存并试听' }).waitFor();
    assert.deepEqual(await page.evaluate(() => {
      const audio = (window as unknown as { testAudio: HTMLAudioElement[] }).testAudio.at(-1)!;
      return { rate: audio.playbackRate, pitch: audio.preservesPitch };
    }), { rate: 1.8, pitch: true });
    await page.getByRole('button', { name: '关闭设置' }).click();

    const audioCount = () => server.provider.requests.filter((req) => req.audio).length;
    const baseline = audioCount();
    const answer = '先求出三角形的底和高。再用底乘高除以二，得到三角形面积。'.repeat(15);
    server.provider.reply = answer;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.provider.audioReply = async () => { await gate; return TEST_WAV; };
    await page.getByLabel('输入题目').fill('讲解一下三角形面积');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const waiting = page.getByRole('button', { name: '语音准备中…', exact: true });
    await waiting.waitFor();
    assert.equal(await waiting.isDisabled(), true);
    await page.screenshot({ path: path.join(SHOT_DIR, 'speech-preparing-mobile.png') });
    release!();
    await page.getByRole('button', { name: '朗读', exact: true }).waitFor();
    assert.equal(audioCount(), baseline + 1, '整段回复只向小米请求一次');
    const request = server.provider.requests.filter((req) => req.audio).at(-1)!;
    assert.equal((request.messages as { content: string }[]).at(-1)!.content, answer);
    await page.getByRole('button', { name: '朗读', exact: true }).click();
    await page.getByRole('button', { name: '停止朗读', exact: true }).click();
    await page.getByRole('button', { name: '朗读', exact: true }).click();
    await page.getByRole('button', { name: '停止朗读', exact: true }).click();
    assert.equal(audioCount(), baseline + 1, '播放和重播不能调用合成接口');
    await page.reload();
    await page.getByRole('button', { name: '朗读', exact: true }).waitFor();
    assert.equal(audioCount(), baseline + 1, '刷新复用服务端音频缓存');

    server.provider.reply = originalReply;
    const animationGate = new Promise<void>((resolve) => { release = resolve; });
    server.provider.audioReply = async () => { await animationGate; return TEST_WAV; };
    const batch = page.waitForRequest((req) => req.url().endsWith('/api/tts/prepare') && req.postDataJSON().texts.length > 1);
    await page.getByRole('button', { name: '生成动画讲解', exact: true }).click();
    const texts = (await batch).postDataJSON().texts;
    assert.deepEqual(texts, rectangleMovingPoint.steps.map((step) => step.say));
    await page.getByText('正在准备整段动画语音…', { exact: false }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '第 1 步', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(SHOT_DIR, 'scene-speech-preparing-mobile.png') });
    release!();
    await page.getByRole('tab', { name: '第 1 步', exact: true }).waitFor();
    const readyCount = audioCount();
    await page.getByRole('tab', { name: '第 1 步', exact: true }).click();
    await page.getByRole('tab', { name: '第 2 步', exact: true }).click();
    await page.getByRole('button', { name: '重播这一步', exact: true }).click();
    await page.getByRole('button', { name: '关闭朗读', exact: true }).click();
    assert.equal(audioCount(), readyCount, '步骤跳转和重播只使用已备好的音频');
    await page.reload();
    await page.getByRole('tab', { name: '第 1 步', exact: true }).waitFor();
    assert.equal(audioCount(), readyCount, '动画刷新也复用缓存');

    await page.route('**/api/tts/prepare', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '测试语音准备失败' }) }));
    await page.reload();
    await page.getByText('测试语音准备失败', { exact: false }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: '朗读', exact: true }).isDisabled(), true);
    await page.unroute('**/api/tts/prepare');
    await page.getByRole('button', { name: '重新准备语音', exact: true }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((button) => button.textContent === '朗读' && !button.disabled));
    await page.getByRole('button', { name: '重试准备语音', exact: true }).click();
    await page.getByRole('tab', { name: '第 1 步', exact: true }).waitFor();
    assert.equal(audioCount(), readyCount);
  } finally {
    release?.(); server.provider.audioReply = undefined; server.provider.reply = originalReply;
    await page.context().close();
  }
});
