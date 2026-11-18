// Geometry stays in mathematical coordinates; camera and label layout operate in SVG screen space.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { computeScene, interpolate, sceneBounds } from '../../../shared/scene/engine.ts';
import type { Color, Scene, Vec } from '../../../shared/scene/types.ts';
import { isPointObject } from '../../../shared/scene/types.ts';
import { layoutLabels, mathTextRuns, measureLabel, radialCandidates, segmentCandidates, wrapLabel, type LayoutLabel, type LabelCandidate, type LabelObstacles } from './labelLayout.ts';
import { isSegmentName } from './annotations.ts';

const COLORS = {
  blue: 'var(--scene-blue)', red: 'var(--scene-red)', green: 'var(--scene-green)', orange: 'var(--scene-orange)', purple: 'var(--scene-purple)',
  gray: 'var(--muted)', black: 'var(--text)', bg: 'var(--scene-bg)', grid: 'var(--border)', axis: 'var(--text-2)',
} satisfies Record<Color | 'bg' | 'grid' | 'axis', string>;
const W = 640;
const H = 480;
const SERIF = '"Times New Roman", "Source Serif 4 Variable", "Noto Serif SC Variable", serif';
export interface SceneCamera { zoom: number; x: number; y: number }
interface Props {
  scene: Scene;
  params: Record<string, number>;
  visible: Set<string>;
  highlighted: Set<string>;
  camera?: SceneCamera;
  /** Actual CSS pixels per SVG logical unit, independent of camera zoom. */
  displayScale?: number;
  /** Extra labels are reserved for this step's introduced or emphasized objects. */
  annotations?: ReadonlySet<string>;
  /** While zoomed, keep the same baseline fit across step changes. */
  frameVisible?: ReadonlySet<string>;
}
interface LabelPaint { text: string; lines: string[]; lineHeight: number; color: string; opacity: number; style: CSSProperties; className: string; dataId?: string }

export function SceneCanvas({ scene, params, visible, highlighted, camera, displayScale = 1, annotations = highlighted, frameVisible = visible }: Props) {
  const unit = 1 / (Number.isFinite(displayScale) && displayScale > 0 ? Math.max(0.2, displayScale) : 1);
  const zoom = camera && Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const panX = Number.isFinite(camera?.x) ? camera!.x : 0;
  const panY = Number.isFinite(camera?.y) ? camera!.y : 0;
  const bounds = useMemo(() => sceneBounds(scene, frameVisible), [scene, frameVisible]);
  const view = useMemo(() => {
    const s = Math.min(W / (bounds.xmax - bounds.xmin), H / (bounds.ymax - bounds.ymin)) * zoom;
    const cx = (bounds.xmin + bounds.xmax) / 2;
    const cy = (bounds.ymin + bounds.ymax) / 2;
    return {
      s,
      toScreen: (p: Vec) => ({ x: W / 2 + (p.x - cx) * s + panX, y: H / 2 - (p.y - cy) * s + panY }),
      fromScreen: (x: number, y: number) => ({ x: cx + (x - W / 2 - panX) / s, y: cy - (y - H / 2 - panY) / s }),
    };
  }, [bounds, zoom, panX, panY]);
  const { objects, points } = useMemo(() => computeScene(scene, params), [scene, params]);
  const T = view.toScreen;
  const previous = useRef<{ scene: Scene; slots: Map<string, string> } | null>(null);
  const [measurement, setMeasurement] = useState<CanvasRenderingContext2D | null>(null);
  const [, setFontRevision] = useState(0);
  useEffect(() => {
    let active = true;
    try { setMeasurement(document.createElement('canvas').getContext('2d')); } catch { /* SSR/limited DOM fallback */ }
    const refresh = () => { if (active) setFontRevision((revision) => revision + 1); };
    void document.fonts?.ready.then(refresh);
    document.fonts?.addEventListener('loadingdone', refresh);
    return () => { active = false; document.fonts?.removeEventListener('loadingdone', refresh); };
  }, []);

  const layers: Record<'fill' | 'line' | 'mark' | 'point', ReactNode[]> = { fill: [], line: [], mark: [], point: [] };
  const labels: LayoutLabel[] = [];
  const paints = new Map<string, LabelPaint>();
  const obstacles: LabelObstacles = { points: [], segments: [] };
  const visiblePoints = [...objects.entries()].filter(([id, c]) => visible.has(id) && c.kind === 'point').flatMap(([, c]) => c.kind === 'point' ? [T(c.p)] : []);
  const center = visiblePoints.length ? { x: visiblePoints.reduce((sum, p) => sum + p.x, 0) / visiblePoints.length, y: visiblePoints.reduce((sum, p) => sum + p.y, 0) / visiblePoints.length } : { x: W / 2, y: H / 2 };
  function addLabel(id: string, text: string, anchor: Vec, candidates: LabelCandidate[], color: string, opacity: number, kind: 'point' | 'segment' | 'text' | 'tick', priority: number, dataId?: string) {
    const normalized = text.replace(/'/g, '′');
    let size = (kind === 'point' ? 15 : kind === 'tick' ? 11 : 13) * unit;
    const fontStyle = kind === 'point' ? 'italic' : 'normal';
    const maxWidth = Math.min(220 * unit, W - 24 * unit);
    const measuredWidth = (text: string) => mathTextRuns(text).reduce((sum, run) => sum + measureLabel(run.text, size, `${run.italic ? 'italic' : 'normal'} 400 ${size}px ${SERIF}`, measurement).width, 0);
    let wrapped = wrapLabel(normalized, maxWidth, size, measuredWidth);
    // Pathological paragraphs also need actual glyphs (not merely their collision box) to fit vertically.
    for (let attempt = 0; wrapped.height > H - 24 * unit && attempt < 8; attempt++) {
      size *= Math.min(0.9, Math.sqrt((H - 24 * unit) / wrapped.height));
      wrapped = wrapLabel(normalized, maxWidth, size, measuredWidth);
    }
    labels.push({ id, anchor, candidates, width: wrapped.width, height: wrapped.height, priority, closeToPoint: kind === 'point' });
    paints.set(id, { text: normalized, lines: wrapped.lines, lineHeight: wrapped.lineHeight, color, opacity, dataId, className: kind === 'point' ? 'pt-label' : kind === 'text' ? 'free-text' : kind === 'tick' ? 'tick' : 'seg-label', style: { fontFamily: SERIF, fontSize: size, fontStyle, fontWeight: 400, stroke: COLORS.bg, strokeWidth: 2.5 * unit, paintOrder: 'stroke', strokeLinejoin: 'round', fill: color } });
  }
  function addSegments(pts: Vec[], group: string, closed = false) {
    for (let i = 1; i < pts.length; i++) obstacles.segments.push({ a: pts[i - 1]!, b: pts[i]!, group });
    if (closed && pts.length > 1) obstacles.segments.push({ a: pts[pts.length - 1]!, b: pts[0]!, group });
  }
  // Merge only genuinely coincident mathematical points, never merely nearby screen pixels.
  const owners: { at: Vec; id: string; names: string[] }[] = [];
  for (const o of scene.objects) {
    const c = objects.get(o.id);
    if (!visible.has(o.id) || !isPointObject(o) || c?.kind !== 'point' || (o.label ?? o.id) === '') continue;
    const owner = owners.find((item) => Math.hypot(item.at.x - c.p.x, item.at.y - c.p.y) < 1e-8);
    if (owner) owner.names.push(o.label ?? o.id);
    else owners.push({ at: c.p, id: o.id, names: [o.label ?? o.id] });
  }
  const merged = new Map(owners.map((owner) => [owner.id, owner.names.join(' = ')]));

  const primaryAnnotations = [...scene.objects].sort((a, b) => Number(highlighted.has(b.id)) - Number(highlighted.has(a.id)));
  const segmentLabels = new Map<string, string>();
  const repeatedLabels = new Set<string>();
  for (const o of primaryAnnotations) {
    if (o.type !== 'segment' || !o.label || !visible.has(o.id) || !annotations.has(o.id)) continue;
    const c = objects.get(o.id);
    if (c?.kind !== 'segment') continue;
    const a = T(c.a); const b = T(c.b);
    if (Math.hypot(b.x - a.x, b.y - a.y) <= 24 * unit) continue;
    const label = interpolate(o.label, scene, params, points).trim();
    if (!label || isSegmentName(label, o.from, o.to)) continue;
    if (repeatedLabels.has(label)) continue;
    repeatedLabels.add(label);
    segmentLabels.set(o.id, label);
    if (segmentLabels.size >= 3) break;
  }

  for (const o of scene.objects) {
    if (!visible.has(o.id)) continue;
    const c = objects.get(o.id);
    if (!c || c.kind === 'undefined') continue;
    const hl = highlighted.has(o.id);
    const dim = highlighted.size > 0 && !hl;
    const opacity = dim ? 0.72 : 1;
    const color = hl && (!o.color || o.color === 'black' || o.color === 'gray') ? COLORS.blue : COLORS[o.color ?? 'black'];
    const width = (hl ? 1.9 : 1.15) * unit;
    const dash = 'dashed' in o && o.dashed ? `${5 * unit} ${3.5 * unit}` : undefined;
    const common = { stroke: color, strokeWidth: width, strokeDasharray: dash, opacity, fill: 'none' };
    const key = o.id;
    switch (c.kind) {
      case 'segment': {
        const a = T(c.a); const b = T(c.b);
        obstacles.segments.push({ a, b });
        layers.line.push(<line key={key} data-id={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />);
        const label = segmentLabels.get(key);
        if (label) {
          const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          addLabel(`${key}-label`, label, anchor, segmentCandidates(a, b, { x: anchor.x - center.x, y: anchor.y - center.y }, unit), color, opacity, 'segment', hl ? 80 : 40);
        }
        break;
      }
      case 'line': case 'ray': {
        const a = T(c.a); const b = T(c.b);
        const d = unitVector(b.x - a.x, b.y - a.y);
        if (!d) break;
        const far = Math.max(W + H, Math.hypot(a.x - W / 2, a.y - H / 2)) * 3;
        const start = c.kind === 'line' ? { x: a.x - d.x * far, y: a.y - d.y * far } : a;
        const end = { x: a.x + d.x * far, y: a.y + d.y * far };
        obstacles.segments.push({ a: start, b: end });
        layers.line.push(<line key={key} data-id={key} x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...common} />);
        break;
      }
      case 'polygon': {
        const pts = c.pts.map(T);
        addSegments(pts, key, true);
        const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
        const fill = o.type === 'polygon' && o.fill;
        if (fill) layers.fill.push(<polygon key={key} data-id={key} points={pointsAttr} fill={color} fillOpacity={hl ? 0.12 : 0.06} />);
        layers.line.push(<polygon key={`${key}-edge`} data-id={fill ? undefined : key} points={pointsAttr} {...common} strokeLinejoin="round" />);
        break;
      }
      case 'circle': {
        const p = T(c.c); const radius = c.r * view.s;
        layers.line.push(<circle key={key} data-id={key} cx={p.x} cy={p.y} r={radius} {...common} />);
        addSegments(Array.from({ length: 97 }, (_, i) => ({ x: p.x + Math.cos(i * Math.PI / 48) * radius, y: p.y + Math.sin(i * Math.PI / 48) * radius })), key);
        break;
      }
      case 'angle': {
        const vertex = T(c.o); const a = T(c.a); const b = T(c.b);
        const ua = unitVector(a.x - vertex.x, a.y - vertex.y); const ub = unitVector(b.x - vertex.x, b.y - vertex.y);
        if (!ua || !ub) break;
        const radius = (o.type === 'angle' && o.right ? 11 : 22) * unit;
        if (o.type === 'angle' && o.right) {
          const pts = [{ x: vertex.x + ua.x * radius, y: vertex.y + ua.y * radius }, { x: vertex.x + (ua.x + ub.x) * radius, y: vertex.y + (ua.y + ub.y) * radius }, { x: vertex.x + ub.x * radius, y: vertex.y + ub.y * radius }];
          addSegments(pts, key);
          layers.mark.push(<polyline key={key} data-id={key} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} {...common} />);
        } else {
          const start = Math.atan2(ua.y, ua.x);
          let sweep = Math.atan2(ub.y, ub.x) - start;
          while (sweep <= -Math.PI) sweep += Math.PI * 2;
          while (sweep > Math.PI) sweep -= Math.PI * 2;
          const pts = Array.from({ length: 13 }, (_, i) => ({ x: vertex.x + Math.cos(start + sweep * i / 12) * radius, y: vertex.y + Math.sin(start + sweep * i / 12) * radius }));
          addSegments(pts, key);
          layers.mark.push(<path key={key} data-id={key} d={`M ${pts[0]!.x} ${pts[0]!.y} A ${radius} ${radius} 0 0 ${sweep > 0 ? 1 : 0} ${pts[12]!.x} ${pts[12]!.y}`} {...common} />);
          if (o.type === 'angle' && o.label && annotations.has(key)) {
            const dir = { x: Math.cos(start + sweep / 2), y: Math.sin(start + sweep / 2) };
            const anchor = { x: vertex.x + dir.x * radius, y: vertex.y + dir.y * radius };
            addLabel(`${key}-label`, interpolate(o.label, scene, params, points), anchor, radialCandidates(anchor, dir, unit), color, opacity, 'segment', hl ? 85 : 60);
          }
        }
        break;
      }
      case 'function': case 'trace': {
        const runs = c.pts.map((run) => run.map(T));
        for (const run of runs) addSegments(run, key);
        const d = runs.map((run) => run.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')).join(' ');
        layers.line.push(<path key={key} data-id={key} d={d} {...common} strokeDasharray={c.kind === 'trace' ? `${2 * unit} ${4 * unit}` : undefined} />);
        if (o.type === 'function' && o.label) {
          const run = runs.findLast((item) => item.length > 0);
          if (run) {
            const anchor = run[Math.floor(run.length * 0.85)]!;
            addLabel(`${key}-label`, o.label, anchor, radialCandidates(anchor, { x: 1, y: -1 }, unit), color, opacity, 'segment', 45);
          }
        }
        break;
      }
      case 'text': {
        if (o.type !== 'text' || !annotations.has(key)) break;
        const anchor = T(c.at);
        addLabel(key, interpolate(o.text, scene, params, points), anchor, radialCandidates(anchor, { x: 0, y: -1 }, unit, true), color, opacity, 'text', hl ? 90 : 50, key);
        break;
      }
      case 'point': {
        if (!isPointObject(o)) break;
        const p = T(c.p); const r = (o.moving ? 3.7 : hl ? 3.2 : 2.4) * unit;
        obstacles.points.push({ ...p, radius: r });
        layers.point.push(<g key={key} data-id={key}><circle cx={p.x} cy={p.y} r={r} fill={o.moving ? COLORS.bg : color} stroke={color} strokeWidth={(o.moving ? 1.5 : 0.7) * unit} /></g>);
        const text = merged.get(key);
        if (text) addLabel(`${key}-label`, text, p, radialCandidates(p, { x: p.x - center.x || -1, y: p.y - center.y || -1 }, unit, false, [11, 15, 20, 27, 36]), COLORS.black, 1, 'point', hl ? 120 : 100);
        break;
      }
    }
  }

  if (scene.axes) {
    const bottomLeft = view.fromScreen(0, H); const topRight = view.fromScreen(W, 0);
    const step = niceStep(Math.max(topRight.x - bottomLeft.x, topRight.y - bottomLeft.y) * unit);
    const tickStyle: CSSProperties = { fontFamily: SERIF, fontSize: 12 * unit, fontWeight: 400, fill: COLORS.axis };
    for (let x = Math.ceil(bottomLeft.x / step) * step, count = 0; x <= topRight.x && count < 100; x += step, count++) {
      const p = T({ x, y: 0 });
      layers.fill.push(<line key={`grid-x-${count}`} x1={p.x} y1={0} x2={p.x} y2={H} stroke={COLORS.grid} strokeWidth={0.5 * unit} />);
      if (Math.abs(x) > step * 1e-6) addLabel(`axis-x-${count}`, String(Number(x.toFixed(6))), p, [{ key: 'below', x: p.x, y: p.y + 15 * unit }, { key: 'above', x: p.x, y: p.y - 15 * unit }], COLORS.axis, 1, 'tick', 10);
    }
    for (let y = Math.ceil(bottomLeft.y / step) * step, count = 0; y <= topRight.y && count < 100; y += step, count++) {
      const p = T({ x: 0, y });
      layers.fill.push(<line key={`grid-y-${count}`} x1={0} y1={p.y} x2={W} y2={p.y} stroke={COLORS.grid} strokeWidth={0.5 * unit} />);
      if (Math.abs(y) > step * 1e-6) addLabel(`axis-y-${count}`, String(Number(y.toFixed(6))), p, [{ key: 'left', x: p.x - 16 * unit, y: p.y }, { key: 'right', x: p.x + 16 * unit, y: p.y }], COLORS.axis, 1, 'tick', 10);
    }
    const origin = T({ x: 0, y: 0 });
    obstacles.segments.push({ a: { x: 0, y: origin.y }, b: { x: W, y: origin.y } }, { a: { x: origin.x, y: 0 }, b: { x: origin.x, y: H } });
    layers.line.unshift(<g key="axes" className="axes"><line x1={0} y1={origin.y} x2={W} y2={origin.y} stroke={COLORS.axis} strokeWidth={unit} /><line x1={origin.x} y1={0} x2={origin.x} y2={H} stroke={COLORS.axis} strokeWidth={unit} /><text x={W - 10 * unit} y={origin.y - 8 * unit} style={tickStyle}>x</text><text x={origin.x + 8 * unit} y={15 * unit} style={tickStyle}>y</text></g>);
  }
  const placed = layoutLabels(labels, obstacles, { width: W, height: H, unit, previous: previous.current?.scene === scene ? previous.current.slots : undefined });
  // Commit preferences only after React commits this frame (safe under StrictMode/concurrent rendering).
  useEffect(() => { previous.current = { scene, slots: new Map(placed.map((label) => [label.id, label.candidate])) }; });
  return <svg className="scene-canvas" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={scene.title} preserveAspectRatio="xMidYMid meet">
    <rect width={W} height={H} fill={COLORS.bg} />
    {layers.fill}{layers.line}{layers.mark}{layers.point}
    <g className="scene-labels">
      {placed.map((label) => label.leader && <line key={`${label.id}-leader`} x1={label.leader.a.x} y1={label.leader.a.y} x2={label.leader.b.x} y2={label.leader.b.y} stroke={COLORS.gray} strokeWidth={0.65 * unit} opacity={0.8} />)}
      {placed.map((label) => {
        const paint = paints.get(label.id)!;
        return <text key={label.id} data-id={paint.dataId} data-label-id={label.id} x={label.center.x} y={label.center.y} textAnchor="middle" dominantBaseline="central" className={paint.className} fill={paint.color} opacity={paint.opacity} style={paint.style}>{paint.lines.length === 1 ? mathTextRuns(paint.text).map((run, index) => <tspan key={index} style={{ fontStyle: run.italic ? 'italic' : 'normal' }}>{run.text}</tspan>) : paint.lines.map((line, lineIndex) => <tspan key={lineIndex} data-label-line={lineIndex} x={label.center.x} y={label.center.y + (lineIndex - (paint.lines.length - 1) / 2) * paint.lineHeight}>{mathTextRuns(line).map((run, index) => <tspan key={index} style={{ fontStyle: run.italic ? 'italic' : 'normal' }}>{run.text}</tspan>)}</tspan>)}</text>;
      })}
    </g>
  </svg>;
}

function unitVector(x: number, y: number): Vec | null {
  const length = Math.hypot(x, y);
  return length < 1e-9 ? null : { x: x / length, y: y / length };
}
function niceStep(range: number): number {
  const raw = range / 10;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const multiplier of [1, 2, 5, 10]) if (raw <= multiplier * power) return multiplier * power;
  return 10 * power;
}
