// Screen-space label placement. Geometry is never moved; callers supply measured text boxes.
export interface LabelPoint { x: number; y: number }
export interface LabelBox { x: number; y: number; width: number; height: number }
export interface LabelCandidate extends LabelPoint { key: string; anchor?: LabelPoint }
export interface LayoutLabel {
  id: string;
  anchor: LabelPoint;
  width: number;
  height: number;
  candidates: LabelCandidate[];
  priority?: number;
  /** Point names should stay close to their vertices, even along a nearby edge. */
  closeToPoint?: boolean;
}
export interface LabelSegment { a: LabelPoint; b: LabelPoint; group?: string }
export interface LabelObstacles {
  points: (LabelPoint & { radius?: number })[];
  segments: LabelSegment[];
}
export interface PlacedLabel extends LabelBox {
  id: string;
  candidate: string;
  center: LabelPoint;
  anchor: LabelPoint;
  leader?: LabelSegment;
}
export interface LayoutOptions {
  width: number;
  height: number;
  padding?: number;
  unit?: number;
  previous?: ReadonlyMap<string, string>;
}

export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Segment/rectangle clipping, including collinear and zero-length segments. */
export function segmentIntersectsBox({ a, b }: LabelSegment, box: LabelBox): boolean {
  let lo = 0;
  let hi = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.x, box.x + box.width - a.x, a.y - box.y, box.y + box.height - a.y];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (Math.abs(pi) < 1e-10) { if (qi < 0) return false; }
    else {
      const t = qi / pi;
      if (pi < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
  }
  return true;
}

/** Stable candidate keys allow a label to follow its moving anchor without switching sides. */
export function radialCandidates(anchor: LabelPoint, preferred: LabelPoint, unit = 1, includeCenter = false, radii = [17, 28, 43, 62]): LabelCandidate[] {
  const preferredDirection = Math.round(Math.atan2(preferred.y, preferred.x) / (Math.PI / 4));
  const candidates: LabelCandidate[] = includeCenter ? [{ ...anchor, key: 'center' }] : [];
  for (const radius of radii) {
    for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const direction = ((preferredDirection + turn) % 8 + 8) % 8;
      const theta = direction * Math.PI / 4;
      candidates.push({ key: `${radius}:${direction}`, x: anchor.x + Math.cos(theta) * radius * unit, y: anchor.y + Math.sin(theta) * radius * unit });
    }
  }
  return candidates;
}

export function segmentCandidates(a: LabelPoint, b: LabelPoint, preferred: LabelPoint, unit = 1): LabelCandidate[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = -(b.y - a.y) / length;
  let ny = (b.x - a.x) / length;
  if (nx * preferred.x + ny * preferred.y < 0) { nx = -nx; ny = -ny; }
  const candidates: LabelCandidate[] = [];
  for (const offset of [14, 25, 40, 58]) {
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const side of [1, -1]) {
        const anchor = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        candidates.push({ key: `${offset}:${t}:${side}`, anchor, x: anchor.x + nx * offset * side * unit, y: anchor.y + ny * offset * side * unit });
      }
    }
  }
  return candidates;
}

/** Deterministic greedy placement, prioritizing essential labels and retaining safe previous slots.
 * Crowded/overconstrained diagrams degrade to the lowest-cost position, never alter geometry.
 */
export function layoutLabels(labels: readonly LayoutLabel[], obstacles: LabelObstacles, options: LayoutOptions): PlacedLabel[] {
  const unit = options.unit ?? 1;
  const padding = options.padding ?? 6 * unit;
  const placed: PlacedLabel[] = [];
  // Index only viewport-intersecting AABBs. Long lines cannot create unbounded grid cells.
  const cellSize = 64 * unit;
  const segmentGrid = new Map<string, number[]>();
  const segmentBounds = obstacles.segments.map(({ a, b }) => ({ xmin: Math.min(a.x, b.x), xmax: Math.max(a.x, b.x), ymin: Math.min(a.y, b.y), ymax: Math.max(a.y, b.y) }));
  for (const [index, box] of segmentBounds.entries()) {
    if (box.xmax < 0 || box.xmin > options.width || box.ymax < 0 || box.ymin > options.height) continue;
    for (let x = Math.floor(Math.max(0, box.xmin) / cellSize); x <= Math.floor(Math.min(options.width, box.xmax) / cellSize); x++) {
      for (let y = Math.floor(Math.max(0, box.ymin) / cellSize); y <= Math.floor(Math.min(options.height, box.ymax) / cellSize); y++) {
        const key = `${x}:${y}`;
        const bucket = segmentGrid.get(key);
        if (bucket) bucket.push(index);
        else segmentGrid.set(key, [index]);
      }
    }
  }
  const sorted = labels.map((label, index) => ({ label, index })).sort((a, b) => (b.label.priority ?? 0) - (a.label.priority ?? 0) || a.index - b.index);
  for (const { label } of sorted) {
    // Do not pull labels belonging to offscreen geometry back onto the screen edge.
    if (label.anchor.x < 0 || label.anchor.x > options.width || label.anchor.y < 0 || label.anchor.y > options.height) continue;
    let best: { box: LabelBox; candidate: LabelCandidate; score: number } | undefined;
    const width = Math.min(label.width + 4 * unit, options.width - padding * 2);
    const height = Math.min(label.height + 3 * unit, options.height - padding * 2);
    for (const [index, candidate] of label.candidates.entries()) {
      const rawX = candidate.x - width / 2;
      const rawY = candidate.y - height / 2;
      const box = { x: Math.max(padding, Math.min(options.width - padding - width, rawX)), y: Math.max(padding, Math.min(options.height - padding - height, rawY)), width, height };
      const center = { x: box.x + width / 2, y: box.y + height / 2 };
      const travel = Math.hypot(center.x - label.anchor.x, center.y - label.anchor.y) / unit;
      let score = index * 0.16 + Math.hypot(center.x - candidate.x, center.y - candidate.y) / unit * 1.5;
      if (label.closeToPoint) score += travel * 2.1;
      if (options.previous?.get(label.id) !== candidate.key) score += label.closeToPoint ? 4 : 9;
      for (const other of placed) {
        if (boxesOverlap(box, other)) {
          const area = (Math.min(box.x + width, other.x + other.width) - Math.max(box.x, other.x)) * (Math.min(box.y + height, other.y + other.height) - Math.max(box.y, other.y));
          score += 10000 + area / (unit * unit) * 20;
        }
      }
      for (const point of obstacles.points) {
        const r = (point.radius ?? 3 * unit) + 2 * unit;
        if (boxesOverlap(box, { x: point.x - r, y: point.y - r, width: r * 2, height: r * 2 })) score += 3000;
      }
      const nearby = new Set<number>();
      for (let x = Math.floor(box.x / cellSize); x <= Math.floor((box.x + width) / cellSize); x++) {
        for (let y = Math.floor(box.y / cellSize); y <= Math.floor((box.y + height) / cellSize); y++) {
          for (const index of segmentGrid.get(`${x}:${y}`) ?? []) nearby.add(index);
        }
      }
      const hitGroups = new Set<string>();
      for (const index of nearby) {
        const segment = obstacles.segments[index]!;
        if (segment.group !== undefined && hitGroups.has(segment.group)) continue;
        const bounds = segmentBounds[index]!;
        if (bounds.xmax < box.x || bounds.xmin > box.x + width || bounds.ymax < box.y || bounds.ymin > box.y + height) continue;
        if (segmentIntersectsBox(segment, box)) {
          score += label.closeToPoint ? 12 : 160;
          if (segment.group !== undefined) hitGroups.add(segment.group);
        }
      }
      if (!best || score < best.score) best = { box, candidate, score };
    }
    if (!best) continue;
    const center = { x: best.box.x + width / 2, y: best.box.y + height / 2 };
    const anchor = best.candidate.anchor ?? label.anchor;
    const edge = { x: Math.max(best.box.x, Math.min(best.box.x + width, anchor.x)), y: Math.max(best.box.y, Math.min(best.box.y + height, anchor.y)) };
    const distance = Math.hypot(edge.x - anchor.x, edge.y - anchor.y);
    const leader = !label.closeToPoint && distance > 23 * unit ? {
      a: { x: anchor.x + (edge.x - anchor.x) * 5 * unit / distance, y: anchor.y + (edge.y - anchor.y) * 5 * unit / distance },
      b: edge,
    } : undefined;
    placed.push({ ...best.box, id: label.id, candidate: best.candidate.key, center, anchor, leader });
  }
  return placed;
}

export interface WrappedLabel { lines: string[]; width: number; height: number; lineHeight: number }

/** Wrap by measured glyph width, including CJK and explicit newlines; rendering uses identical lines. */
export function wrapLabel(text: string, maxWidth: number, fontSize: number, measure: (text: string) => number): WrappedLabel {
  const limit = Math.max(fontSize, maxWidth);
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      const next = line + character;
      if (line && measure(next) > limit) { lines.push(line); line = character; }
      else line = next;
    }
    lines.push(line);
  }
  const lineHeight = fontSize * 1.3;
  return { lines, width: Math.max(0, ...lines.map(measure)), height: fontSize * 1.15 + (lines.length - 1) * lineHeight, lineHeight };
}

/** Variables use math italics; numbers, prime marks and operators stay upright. */
export function mathTextRuns(text: string): { text: string; italic: boolean }[] {
  return (text.match(/[A-Za-z]+|[^A-Za-z]+/gu) ?? []).map((run) => ({ text: run, italic: /^[A-Za-z]/u.test(run) && !/^(sin|cos|tan|log|ln|exp)$/u.test(run) }));
}

/** Canvas measurement is optional: SSR/tests retain a conservative Unicode-aware fallback. */
export function measureLabel(text: string, fontSize: number, font: string, context?: Pick<CanvasRenderingContext2D, 'font' | 'measureText'> | null): { width: number; height: number } {
  if (context) {
    context.font = font;
    const metrics = context.measureText(text);
    if (Number.isFinite(metrics.width) && metrics.width > 0) return { width: metrics.width, height: fontSize * 1.15 };
  }
  const width = Array.from(text).reduce((sum, char) => sum + (/[^\u0000-\u024f]/u.test(char) ? 1 : /[il1'′.,]/u.test(char) ? 0.36 : /[MW]/u.test(char) ? 0.9 : 0.62), 0) * fontSize;
  return { width, height: fontSize * 1.15 };
}
