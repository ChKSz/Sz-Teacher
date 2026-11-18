import { describe, expect, it } from 'vitest';
import { boxesOverlap, layoutLabels, mathTextRuns, measureLabel, radialCandidates, segmentCandidates, segmentIntersectsBox, wrapLabel, type LayoutLabel } from '../web/src/scene/labelLayout.ts';

const empty = { points: [], segments: [] };
const options = { width: 640, height: 480 };
function label(id: string, x: number, y: number, width = 28): LayoutLabel {
  const anchor = { x, y };
  return { id, anchor, width, height: 18, candidates: radialCandidates(anchor, { x: 1, y: -1 }), priority: 100 };
}

describe('统一标签布局', () => {
  it('密集点名、线段、角标和自由文字共享避让空间', () => {
    const labels = [label('P', 400, 200), label('Q', 410, 215), label('E', 415, 230), label('length', 405, 210, 54), label('angle', 415, 205, 36), label('text', 420, 220, 70)];
    const points = labels.slice(0, 3).map((item) => ({ ...item.anchor, radius: 3 }));
    const placed = layoutLabels(labels, { points, segments: [{ a: { x: 350, y: 200 }, b: { x: 470, y: 240 } }] }, options);
    expect(placed).toHaveLength(labels.length);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(boxesOverlap(placed[i]!, placed[j]!)).toBe(false);
    for (const item of placed) for (const point of points) expect(boxesOverlap(item, { x: point.x - 3, y: point.y - 3, width: 6, height: 6 })).toBe(false);
  });
  it('文字框留在画布边界内，屏外几何不产生边缘堆积', () => {
    const placed = layoutLabels([label('A', 1, 1), label('B', 639, 479), label('offscreen', -2, 150)], empty, options);
    expect(placed.map((item) => item.id)).toEqual(['A', 'B']);
    for (const box of placed) {
      expect(box.x).toBeGreaterThanOrEqual(6);
      expect(box.y).toBeGreaterThanOrEqual(6);
      expect(box.x + box.width).toBeLessThanOrEqual(634);
      expect(box.y + box.height).toBeLessThanOrEqual(474);
    }
  });
  it('保留安全的上一帧候选，但发生遮挡时允许换位', () => {
    const item = label('A', 200, 200);
    const previous = new Map([['A', item.candidates[3]!.key]]);
    const first = layoutLabels([item], empty, { ...options, previous })[0]!;
    expect(first.candidate).toBe(item.candidates[3]!.key);
    const second = layoutLabels([item], { points: [{ ...first.center, radius: 10 }], segments: [] }, { ...options, previous })[0]!;
    expect(second.candidate).not.toBe(first.candidate);
    expect(previous.get('A')).toBe(item.candidates[3]!.key);
  });
  it('避开线段且较远标签带短引线', () => {
    const item: LayoutLabel = { id: 'x', anchor: { x: 100, y: 100 }, width: 30, height: 18, candidates: [{ key: 'blocked', x: 100, y: 100 }, { key: 'safe', x: 100, y: 155 }] };
    const placed = layoutLabels([item], { points: [], segments: [{ a: { x: 0, y: 100 }, b: { x: 200, y: 100 } }] }, options)[0]!;
    expect(placed.candidate).toBe('safe');
    expect(placed.leader).toBeDefined();
    expect(placed.leader!.a.y).toBeGreaterThan(100);
    expect(placed.leader!.b.y).toBeLessThan(placed.center.y);
  });
  it('点名优先贴近顶点，贴近有线的角也不会拉引线出去', () => {
    const item: LayoutLabel = { id: 'B', anchor: { x: 100, y: 100 }, width: 10, height: 17, closeToPoint: true,
      candidates: [{ key: 'near', x: 89, y: 100 }, { key: 'far', x: 60, y: 100 }] };
    const placed = layoutLabels([item], { points: [{ ...item.anchor, radius: 2 }], segments: [{ a: { x: 80, y: 100 }, b: item.anchor }] }, options)[0]!;
    expect(placed.candidate).toBe('near');
    expect(placed.leader).toBeUndefined();
  });
  it('线段候选的引线锚点与沿线位置一致', () => {
    const candidates = segmentCandidates({ x: 0, y: 100 }, { x: 200, y: 100 }, { x: 0, y: -1 });
    expect(candidates[0]!.y).toBeLessThan(100);
    for (const candidate of candidates) expect(candidate.anchor!.y).toBe(100);
    expect(new Set(candidates.map((candidate) => candidate.key)).size).toBe(candidates.length);
  });
  it('矩形与线段相交检测支持竖线和退化线', () => {
    const box = { x: 10, y: 10, width: 20, height: 20 };
    expect(segmentIntersectsBox({ a: { x: 15, y: 0 }, b: { x: 15, y: 40 } }, box)).toBe(true);
    expect(segmentIntersectsBox({ a: { x: 5, y: 0 }, b: { x: 5, y: 40 } }, box)).toBe(false);
    expect(segmentIntersectsBox({ a: { x: 15, y: 15 }, b: { x: 15, y: 15 } }, box)).toBe(true);
  });
  it('无 DOM 时测量中文、撇号和宽字母，支持真实字体测量注入', () => {
    expect(measureLabel('WWW', 16, '').width).toBeGreaterThan(measureLabel('iii', 16, '').width);
    expect(measureLabel('面积', 16, '').width).toBe(32);
    const context = { font: '', measureText: () => ({ width: 123 }) as TextMetrics };
    expect(measureLabel('A′', 16, 'italic 16px serif', context).width).toBe(123);
    expect(context.font).toBe('italic 16px serif');
  });
  it('数学变量斜体，数字、中文、撇号和运算符正体', () => {
    expect(mathTextRuns('BE′ = 3√2 + 2t')).toEqual([
      { text: 'BE', italic: true }, { text: '′ = 3√2 + 2', italic: false }, { text: 't', italic: true },
    ]);
    expect(mathTextRuns('面积')).toEqual([{ text: '面积', italic: false }]);
    expect(mathTextRuns('sin')).toEqual([{ text: 'sin', italic: false }]);
  });
  it('长中文和显式换行按实际测量生成相同的多行包围盒', () => {
    const measure = (text: string) => Array.from(text).length * 15;
    const result = wrapLabel('数学几何'.repeat(15), 220, 15, measure);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.join('')).toBe('数学几何'.repeat(15));
    expect(result.width).toBeLessThanOrEqual(220);
    expect(result.height).toBeCloseTo(15 * 1.15 + (result.lines.length - 1) * result.lineHeight);
    for (const line of result.lines) expect(measure(line)).toBeLessThanOrEqual(result.width);
    expect(wrapLabel('AB\nCD', 220, 15, measure).lines).toEqual(['AB', 'CD']);
  });
  it('同组曲线惩罚与采样密度无关，远处障碍由粗筛排除', () => {
    const item: LayoutLabel = { id: 'x', anchor: { x: 100, y: 100 }, width: 30, height: 18, candidates: [{ key: 'first', x: 100, y: 100 }, { key: 'second', x: 100, y: 150 }] };
    const curve = { a: { x: 50, y: 100 }, b: { x: 150, y: 100 }, group: 'curve' };
    const other = { a: { x: 50, y: 150 }, b: { x: 150, y: 150 }, group: 'other' };
    const sparse = layoutLabels([item], { points: [], segments: [curve, other] }, options);
    const dense = layoutLabels([item], { points: [], segments: [...Array.from({ length: 240 }, () => curve), other, { a: { x: 900, y: 900 }, b: { x: 1000, y: 1000 } }] }, options);
    expect(dense).toEqual(sparse);
    expect(dense[0]!.candidate).toBe('first');
  });
  it('径向候选使用固定八方向，首选方向变化不改变同key位置', () => {
    const a = radialCandidates({ x: 100, y: 100 }, { x: 1, y: 0.1 });
    const b = radialCandidates({ x: 100, y: 100 }, { x: 0.1, y: 1 });
    for (const candidate of a) expect(b.find((item) => item.key === candidate.key)).toEqual(candidate);
    expect(a[0]!.key).not.toBe(b[0]!.key);
  });
  it('布局纯函数不修改输入，重复运行结果一致', () => {
    const labels = [label('A', 200, 200), label('B', 210, 200)];
    const before = JSON.stringify(labels);
    expect(layoutLabels(labels, empty, options)).toEqual(layoutLabels(labels, empty, options));
    expect(JSON.stringify(labels)).toBe(before);
  });
});
