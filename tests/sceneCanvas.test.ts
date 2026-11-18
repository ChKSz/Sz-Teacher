import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SceneCanvas } from '../web/src/scene/SceneCanvas.tsx';
import type { Scene } from '../shared/scene/types.ts';

const scene: Scene = {
  version: 1, title: '渲染契约', steps: [],
  objects: [
    { id: 'A', type: 'point', x: -1, y: 0 },
    { id: 'B', type: 'point', x: 1, y: 0 },
    { id: 'O', type: 'point', x: 0, y: 0 },
    { id: 'AB', type: 'segment', from: 'A', to: 'B', label: '2' },
    { id: 'circle', type: 'circle', center: 'O', radius: 1 },
    { id: 'note', type: 'text', at: [0, 0.6], text: '长度' },
  ],
};
const base = { scene, params: {}, visible: new Set(scene.objects.map((object) => object.id)), highlighted: new Set<string>() };
function attr(markup: string, id: string, attribute: string): number {
  const element = new RegExp(`<[^>]+data-id="${id}"[^>]*>`).exec(markup)?.[0] ?? '';
  return Number(new RegExp(`${attribute}="([^"]+)"`).exec(element)?.[1]);
}

describe('SceneCanvas camera and rendering', () => {
  it('camera applies center-based zoom and SVG-unit translation, not geometry changes', () => {
    const normal = renderToStaticMarkup(createElement(SceneCanvas, base));
    const zoomed = renderToStaticMarkup(createElement(SceneCanvas, { ...base, camera: { zoom: 2, x: 11, y: -13 } }));
    expect(attr(zoomed, 'AB', 'x1')).toBeCloseTo(320 + (attr(normal, 'AB', 'x1') - 320) * 2 + 11);
    expect(attr(zoomed, 'AB', 'y1')).toBeCloseTo(240 + (attr(normal, 'AB', 'y1') - 240) * 2 - 13);
    expect(attr(zoomed, 'circle', 'r')).toBeCloseTo(attr(normal, 'circle', 'r') * 2);
    expect(attr(zoomed, 'AB', 'stroke-width')).toBe(attr(normal, 'AB', 'stroke-width'));
  });
  it('displayScale compensates screen strokes and label size', () => {
    const normal = renderToStaticMarkup(createElement(SceneCanvas, base));
    const mobile = renderToStaticMarkup(createElement(SceneCanvas, { ...base, displayScale: 0.5 }));
    expect(attr(mobile, 'AB', 'stroke-width')).toBeCloseTo(attr(normal, 'AB', 'stroke-width') * 2);
    expect(mobile).toContain('font-size:30px');
    expect(normal).toContain('font-size:15px');
  });
  it('inherits theme colors and keeps only geometric labels before a step starts', () => {
    const markup = renderToStaticMarkup(createElement(SceneCanvas, base));
    expect(markup).toContain('fill="var(--scene-bg)"');
    expect(markup).not.toContain('feGaussianBlur');
    expect(markup).not.toContain('paper-grid');
    for (const id of ['A', 'B', 'O', 'AB', 'circle']) expect(markup.match(new RegExp(`data-id="${id}"`, 'g'))).toHaveLength(1);
    expect(markup).not.toContain('data-id="note"');
    expect(markup).not.toContain('data-label-id="AB-label"');
  });
  it('wraps long Chinese labels into actual SVG lines at 320px width', () => {
    const text = '数学几何'.repeat(15);
    const longScene: Scene = { ...scene, objects: [{ id: 'note', type: 'text', at: [0, 0], text }] };
    const markup = renderToStaticMarkup(createElement(SceneCanvas, { ...base, scene: longScene, visible: new Set(['note']), annotations: new Set(['note']), displayScale: 0.5 }));
    const lines = [...markup.matchAll(/data-label-line="\d+" x="([^"]+)" y="([^"]+)"/g)];
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(Number(line[1])).toBeGreaterThan(0);
      expect(Number(line[1])).toBeLessThan(640);
      expect(Number(line[2])).toBeGreaterThan(15);
      expect(Number(line[2])).toBeLessThan(465);
    }
    expect(markup.replace(/<[^>]*>/g, '')).toBe(text);
  });
  it('fits visible objects without reserving space for later constructions', () => {
    const small = new Set(['A', 'B', 'AB']);
    const withDistant: Scene = { ...scene, objects: [...scene.objects, { id: 'X', type: 'point', x: 50, y: 50, hidden: true }] };
    const markup = renderToStaticMarkup(createElement(SceneCanvas, { ...base, scene: withDistant, visible: small }));
    expect(attr(markup, 'AB', 'x2') - attr(markup, 'AB', 'x1')).toBeGreaterThan(400);
  });
  it('deduplicates equal values and suppresses redundant segment names', () => {
    const extra: Scene = { ...scene, objects: [...scene.objects,
      { id: 'AO', type: 'segment', from: 'A', to: 'O', label: '2' },
      { id: 'OB', type: 'segment', from: 'O', to: 'B', label: 'OB' },
    ] };
    const markup = renderToStaticMarkup(createElement(SceneCanvas, { ...base, scene: extra, visible: new Set(extra.objects.map(o => o.id)), annotations: new Set(['AB', 'AO', 'OB']), highlighted: new Set(['AO']) }));
    expect(markup).toContain('data-label-id="AO-label"');
    expect(markup).not.toContain('data-label-id="AB-label"');
    expect(markup).not.toContain('data-label-id="OB-label"');
  });
  it('highlight preserves IDs and adds restrained line emphasis', () => {
    const normal = renderToStaticMarkup(createElement(SceneCanvas, base));
    const highlighted = renderToStaticMarkup(createElement(SceneCanvas, { ...base, highlighted: new Set(['AB']) }));
    expect(attr(highlighted, 'AB', 'stroke-width')).toBeGreaterThan(attr(normal, 'AB', 'stroke-width'));
    expect(highlighted).not.toContain('filter=');
    expect(highlighted).toContain('data-label-id="AB-label"');
  });
});
