import { describe, expect, it } from 'vitest';
import { constrainCamera, INITIAL_CAMERA, zoomCamera } from '../web/src/scene/camera.ts';
import { focusedVisible } from '../web/src/scene/focus.ts';
import { liveReadoutTemplates, stepAnnotations, isSegmentName } from '../web/src/scene/annotations.ts';
import type { Scene } from '../shared/scene/types.ts';

describe('camera interaction', () => {
  it('zooms around the gesture anchor without moving its world point', () => {
    const anchor = { x: 450, y: 170 };
    const next = zoomCamera(INITIAL_CAMERA, 2, anchor);
    expect(320 + (anchor.x - 320) * next.zoom + next.x).toBe(anchor.x);
    expect(240 + (anchor.y - 240) * next.zoom + next.y).toBe(anchor.y);
  });
  it('bounds zoom and panning, and resets when fitted', () => {
    expect(zoomCamera(INITIAL_CAMERA, 20).zoom).toBe(6);
    expect(zoomCamera({ zoom: 3, x: 40, y: 50 }, 0.1)).toEqual(INITIAL_CAMERA);
    expect(constrainCamera({ zoom: 2, x: 999, y: -999 })).toEqual({ zoom: 2, x: 320, y: -240 });
  });
});

describe('minimal annotations', () => {
  it('limits in-figure data to objects introduced or highlighted in the step', () => {
    expect([...stepAnnotations({ say: 'diameter', actions: [{ do: 'show', ids: ['AD'] }, { do: 'hide', ids: ['BC'] }] }, new Set(['AD', 'E']))]).toEqual(['AD', 'E']);
    expect(stepAnnotations(undefined, new Set()).size).toBe(0);
    expect(isSegmentName('Q′P', 'P', "Q'")).toBe(true);
    expect(isSegmentName('6', 'A', 'D')).toBe(false);
  });
  it('shows only changing numbers on visible objects and drops static examples', () => {
    const scene: Scene = { version: 1, title: 'readouts', steps: [], params: [{ name: 't', min: 0, max: 3 }], objects: [
      { id: 'A', type: 'point', x: 0, y: 0 }, { id: 'B', type: 'point', x: 3, y: 0 },
      { id: 'P', type: 'ratio', from: 'A', to: 'B', ratio: 't/3' },
      { id: 'Q', type: 'midpoint', of: ['A', 'P'] },
    ], readouts: ['AB = 3', 'AB = {dist(A,B)}', 'AP = {dist(A,P)}', 'AP = {dist(A,P)}', 'AQ = {dist(A,Q)}', 't = {t}'] };
    expect(liveReadoutTemplates({ ...scene, params: [] }, new Set(['A', 'B', 'P', 'Q']))).toEqual([]);
    expect(liveReadoutTemplates(scene, new Set(['A', 'B', 'P']))).toEqual(['AP = {dist(A,P)}', 't = {t}']);
    expect(liveReadoutTemplates(scene, new Set(['A', 'B', 'P', 'Q']))).toContain('AQ = {dist(A,Q)}');
  });
});

describe('reversible step focus', () => {
  const scene: Scene = { version: 1, title: 'focus', objects: [
    { id: 'A', type: 'point', x: 0, y: 0 }, { id: 'B', type: 'point', x: 4, y: 0 },
    { id: 'P', type: 'point', x: 2, y: 3, hidden: true },
    { id: 'Q', type: 'point', x: 2, y: -3, hidden: true },
    { id: 'AB', type: 'segment', from: 'A', to: 'B' },
    { id: 'AP', type: 'segment', from: 'A', to: 'P', hidden: true },
    { id: 'BQ', type: 'segment', from: 'B', to: 'Q', hidden: true },
  ], steps: [{ say: 'same side', actions: [{ do: 'highlight', ids: ['AP'] }] }, { say: 'compare' }] };
  it('keeps the original figure and the highlighted construction endpoints', () => {
    const visible = new Set(scene.objects.map(o => o.id));
    const focus = focusedVisible(scene, visible, new Set(['AP']), 0);
    expect([...focus].sort()).toEqual(['A', 'AB', 'AP', 'B', 'P']);
    expect(visible.size).toBe(7);
  });
  it('does not guess or remove objects without an explicit step focus', () => {
    const visible = new Set(scene.objects.map(o => o.id));
    expect(focusedVisible(scene, visible, new Set(), 1)).toBe(visible);
  });
  it('never resurrects explicitly hidden objects', () => {
    const visible = new Set(['A', 'B', 'AB']);
    expect([...focusedVisible(scene, visible, new Set(['AP']), 0)].sort()).toEqual(['A', 'AB', 'B']);
  });
});
