// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScenePlayer } from '../web/src/scene/ScenePlayer.tsx';
import type { Scene } from '../shared/scene/types.ts';

const scene: Scene = { version: 1, title: '交互回归', objects: [
  { id: 'A', type: 'point', x: 0, y: 0 }, { id: 'B', type: 'point', x: 3, y: 0 },
  { id: 'P', type: 'point', x: 1, y: 2, hidden: true },
  { id: 'AB', type: 'segment', from: 'A', to: 'B' },
  { id: 'AP', type: 'segment', from: 'A', to: 'P', hidden: true, dashed: true },
], steps: [
  { say: '构造', actions: [{ do: 'show', ids: ['P', 'AP'] }, { do: 'highlight', ids: ['AP'] }] },
  { say: '观察原图', actions: [{ do: 'highlight', ids: ['AB'] }] },
], readouts: ['AB = 3'] };
let container: HTMLDivElement; let root: Root;
async function click(name: string) {
  const button = [...document.querySelectorAll<HTMLElement>('button, summary')].find(b => b.getAttribute('aria-label') === name || b.textContent === name)!;
  expect(button).toBeDefined();
  const menu = button.closest<HTMLDetailsElement>('.scene-options');
  if (menu && button.tagName === 'BUTTON') await act(() => { menu.open = true; });
  await act(() => button.click());
}
function camera() { return document.querySelector<HTMLElement>('.scene-viewport')!; }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(() => root.render(createElement(ScenePlayer, { scene, tts: { rate: 1, voice: '' } })));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('player presentation integration', () => {
  it('preserves zoom across steps and entering/leaving the fullscreen portal', async () => {
    await click('放大图形'); const zoom = camera().dataset.zoom;
    await click('第 1 步'); expect(camera().dataset.zoom).toBe(zoom);
    await click('全屏看图');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(camera().dataset.zoom).toBe(zoom);
    await click('第 2 步'); expect(camera().dataset.zoom).toBe(zoom);
    await click('退出全屏'); expect(camera().dataset.zoom).toBe(zoom);
    expect(document.body.style.overflow).not.toBe('hidden');
    await click('适应全图'); expect(camera().dataset.zoom).toBe('1');
  });
  it('focus removes old auxiliary objects but complete view restores them', async () => {
    await click('第 2 步');
    expect(document.querySelector('[data-id="AP"]')).not.toBeNull();
    await click('仅看本步重点');
    expect(document.querySelector('[data-id="AP"]')).toBeNull();
    expect(document.querySelector('[data-id="AB"]')).not.toBeNull();
    await click('完整图形'); expect(document.querySelector('[data-id="AP"]')).not.toBeNull();
  });
  it('only one fullscreen button, no initial duplicate hint or static readouts, and text collapse works in fullscreen', async () => {
    expect(document.querySelectorAll('button[aria-label="全屏看图"]')).toHaveLength(1);
    expect(document.querySelector('button[aria-label="适应全图"]')).toBeNull();
    expect(document.querySelector('.readouts')).toBeNull();
    expect(document.querySelector('.scene-caption')).toBeNull();
    await click('第 1 步');
    expect(document.querySelector('.step-directory')?.textContent).not.toContain('构造');
    await click('全屏看图');
    await click('收起讲解文字'); expect(document.querySelector('.scene-caption.is-collapsed')).not.toBeNull();
    await click('展开讲解文字'); expect(document.querySelector('.scene-caption.is-collapsed')).toBeNull();
    expect(document.querySelector('.step-no')?.textContent).toContain('第 1/2 步');
  });
  it('starts the current utterance in the click, and waits for speech to finish before advancing', async () => {
    vi.useFakeTimers();
    const utterances: SpeechSynthesisUtterance[] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(publicText: string) { this.text = publicText; } text: string; });
    vi.stubGlobal('speechSynthesis', { cancel() {}, getVoices: () => [], speak: (u: SpeechSynthesisUtterance) => utterances.push(u) });
    await click('开始讲解');
    expect(utterances.map(u => u.text)).toEqual(['构造']);
    await act(() => utterances[0]?.onstart?.({} as SpeechSynthesisEvent));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(document.querySelector('.step-no')?.textContent).toContain('第 1/2 步');
    await act(() => utterances[0]?.onend?.({} as SpeechSynthesisEvent));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(utterances.map(u => u.text)).toEqual(['构造', '观察原图']);
    await act(() => { utterances[1]?.onstart?.({} as SpeechSynthesisEvent); utterances[1]?.onend?.({} as SpeechSynthesisEvent); });
    vi.useRealTimers();
  });
  it('narration error pauses instead of skipping; silent playback is explicit', async () => {
    vi.useFakeTimers();
    let utterance: SpeechSynthesisUtterance | undefined;
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    vi.stubGlobal('speechSynthesis', { cancel() {}, getVoices: () => [], speak: (u: SpeechSynthesisUtterance) => { utterance = u; } });
    await click('开始讲解');
    await act(() => utterance?.onerror?.({ error: 'language-unavailable' } as SpeechSynthesisErrorEvent));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(document.querySelector('.step-no')?.textContent).toContain('第 1/2 步');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('已停在当前步骤');
    await click('改为无声播放');
    await click('继续');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(document.querySelector('.step-no')?.textContent).toContain('第 1/2 步');
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(document.querySelector('.step-no')?.textContent).toContain('第 2/2 步');
    vi.useRealTimers();
  });
  it('pauses an in-flight animation and utterance, then resumes without restarting either', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const speak = vi.fn<(u: SpeechSynthesisUtterance) => void>();
    const pause = vi.fn();
    const resume = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    vi.stubGlobal('speechSynthesis', { cancel() {}, getVoices: () => [], speak, pause, resume });
    const moving: Scene = { ...scene, params: [{ name: 't', min: 0, max: 10 }], steps: [{ say: '运动', actions: [{ do: 'animate', param: 't', to: 10, duration: 4 }] }, scene.steps[1]!] };
    await act(() => root.render(createElement(ScenePlayer, { scene: moving, tts: { rate: 1, voice: '' } })));
    await click('开始讲解');
    const utterance = speak.mock.calls[0]![0];
    await act(() => utterance.onstart?.({} as SpeechSynthesisEvent));
    const timer = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
    const value = () => Number(document.querySelector<HTMLInputElement>('input[type="range"]')!.value);
    await timer(2000);
    expect(value()).toBeCloseTo(5, 0);
    await click('暂停');
    const pausedAt = value();
    await timer(9000);
    expect(value()).toBe(pausedAt);
    expect(pause).toHaveBeenCalledTimes(1);
    await click('继续');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(value()).toBe(pausedAt);
    await timer(1000);
    expect(value()).toBeGreaterThan(pausedAt);
    expect(value()).toBeLessThan(10);
    await timer(1100);
    expect(value()).toBe(10);
    expect(document.querySelector('.step-no')?.textContent).toContain('第 1/2 步');
    await act(() => utterance.onend?.({} as SpeechSynthesisEvent));
    await timer(400);
    expect(speak).toHaveBeenCalledTimes(2);
  });
  it('pauses the remaining wait between steps in silent mode', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const timer = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
    await click('关闭朗读');
    await click('无声播放');
    await timer(2400);
    await click('暂停');
    await timer(5000);
    expect(document.querySelector('.step-no')?.textContent).toContain('第 1/2 步');
    await click('继续');
    await timer(700);
    expect(document.querySelector('.step-no')?.textContent).toContain('第 2/2 步');
  });
  it('new scene resets the camera', async () => {
    await click('放大图形');
    await act(() => root.render(createElement(ScenePlayer, { scene: { ...scene, title: '另一题' }, tts: { rate: 1, voice: '' } })));
    expect(camera().dataset.zoom).toBe('1');
  });
});
