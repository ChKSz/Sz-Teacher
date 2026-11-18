// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SceneViewport } from '../web/src/scene/SceneViewport.tsx';
import { INITIAL_CAMERA } from '../web/src/scene/camera.ts';
import type { Scene } from '../shared/scene/types.ts';

vi.mock('../web/src/scene/SceneCanvas.tsx', () => ({ SceneCanvas: () => createElement('svg', { className: 'scene-canvas' }) }));
const scene: Scene = { version: 1, title: 'test', objects: [], steps: [{ say: 'test' }] };
let container: HTMLDivElement;
let root: Root;
function Harness() {
  const [camera, onCamera] = useState(INITIAL_CAMERA);
  return createElement(SceneViewport, { scene, params: {}, visible: new Set<string>(), highlighted: new Set<string>(), camera, onCamera });
}
function viewport() { return container.querySelector<HTMLDivElement>('.scene-viewport')!; }
async function click(name: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name)!;
  expect(button).toBeDefined();
  await act(() => button.click());
}
async function pointer(type: string, id: number, x: number, y: number) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0 });
  await act(() => viewport().dispatchEvent(event));
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480, toJSON() {} });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(Harness)));
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('viewport DOM interaction', () => {
  it('buttons zoom and reset, disabling unavailable zoom directions', async () => {
    expect(container.querySelector<HTMLButtonElement>('[aria-label="缩小图形"]')!.disabled).toBe(true);
    await click('放大图形');
    expect(Number(viewport().dataset.zoom)).toBeCloseTo(1.3);
    expect(viewport().classList.contains('interactive')).toBe(false);
    await pointer('pointerdown', 1, 200, 200);
    await pointer('pointermove', 1, 200, 100);
    expect(viewport().dataset.panY).toBe('0');
    await click('适应全图');
    expect(viewport().dataset.zoom).toBe('1');
    expect(viewport().classList.contains('interactive')).toBe(false);
  });
  it('exiting gestures restores page scrolling without changing the zoom', async () => {
    await click('放大图形');
    await click('手势看图');
    expect(viewport().classList.contains('interactive')).toBe(true);
    await click('退出手势');
    expect(viewport().dataset.zoom).toBe('1.3');
    expect(viewport().classList.contains('interactive')).toBe(false);
  });
  it('two pointers zoom about their center, one pointer pans and cancel clears tracking', async () => {
    await click('手势看图');
    await pointer('pointerdown', 1, 280, 240);
    await pointer('pointerdown', 2, 360, 240);
    await pointer('pointermove', 1, 240, 240);
    await pointer('pointermove', 2, 400, 240);
    expect(Number(viewport().dataset.zoom)).toBeCloseTo(2);
    await pointer('pointerup', 2, 400, 240);
    const before = Number(viewport().dataset.panX);
    await pointer('pointermove', 1, 220, 240);
    expect(Number(viewport().dataset.panX)).toBeCloseTo(before - 20);
    await pointer('pointercancel', 1, 220, 240);
    const stopped = viewport().dataset.panX;
    await pointer('pointermove', 1, 180, 240);
    expect(viewport().dataset.panX).toBe(stopped);
  });
  it('ordinary wheel is not prevented; modified wheel zooms', async () => {
    const scroll = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    await act(() => viewport().dispatchEvent(scroll));
    expect(scroll.defaultPrevented).toBe(false);
    expect(viewport().dataset.zoom).toBe('1');
    const zoom = new WheelEvent('wheel', { deltaY: -100, clientX: 320, clientY: 240, ctrlKey: true, bubbles: true, cancelable: true });
    await act(() => viewport().dispatchEvent(zoom));
    expect(zoom.defaultPrevented).toBe(true);
    expect(Number(viewport().dataset.zoom)).toBeGreaterThan(1);
  });
  it('unzoomed single pointer leaves page-scroll mode undisturbed', async () => {
    await pointer('pointerdown', 1, 200, 200);
    await pointer('pointermove', 1, 200, 100);
    expect(viewport().dataset.panY).toBe('0');
    expect(viewport().classList.contains('interactive')).toBe(false);
  });
});
