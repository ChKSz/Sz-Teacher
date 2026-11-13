// 用 SVG 绘制几何场景。坐标换算：数学坐标（y 向上）→ 屏幕坐标（y 向下）。
import { useMemo } from 'react';
import { computeScene, interpolate, sceneBounds } from '../../../shared/scene/engine.ts';
import type { Color, Computed, Scene, SceneObject, Vec } from '../../../shared/scene/types.ts';
import { isPointObject } from '../../../shared/scene/types.ts';

export const COLORS: Record<Color, string> = {
  blue: '#2f6fed',
  red: '#e0383e',
  green: '#1f9d55',
  orange: '#e8890c',
  purple: '#8b4fd8',
  gray: '#8a94a6',
  black: '#1d2433',
};

const W = 640;
const H = 480;

interface Props {
  scene: Scene;
  params: Record<string, number>;
  visible: Set<string>;
  highlighted: Set<string>;
}

export function SceneCanvas({ scene, params, visible, highlighted }: Props) {
  const bounds = useMemo(() => sceneBounds(scene), [scene]);
  // 等比例缩放，保证角度和长度不变形
  const view = useMemo(() => {
    const sx = W / (bounds.xmax - bounds.xmin);
    const sy = H / (bounds.ymax - bounds.ymin);
    const s = Math.min(sx, sy);
    const cx = (bounds.xmin + bounds.xmax) / 2;
    const cy = (bounds.ymin + bounds.ymax) / 2;
    const toScreen = (p: Vec) => ({ x: W / 2 + (p.x - cx) * s, y: H / 2 - (p.y - cy) * s });
    const fromScreen = (x: number, y: number) => ({ x: cx + (x - W / 2) / s, y: cy - (y - H / 2) / s });
    return { s, toScreen, fromScreen };
  }, [bounds]);

  const { objects, points } = useMemo(() => computeScene(scene, params), [scene, params]);

  const T = view.toScreen;
  const anyHighlight = highlighted.size > 0;
  const layers: Record<'fill' | 'line' | 'mark' | 'point' | 'text', React.ReactNode[]> = {
    fill: [],
    line: [],
    mark: [],
    point: [],
    text: [],
  };

  // 点的标签放在远离图形中心的方向
  const center = useMemo(() => {
    const ps = Object.values(points);
    if (!ps.length) return { x: 0, y: 0 };
    return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
  }, [points]);

  const labelSlots: { mid: Vec; nx: number; ny: number; text: string; color: string; opacity: number; key: string }[] = [];

  // 位置重合的点只显示一个标签，写成 "P(E)"
  const labelOwner = new Map<string, string>();
  const mergedLabels = new Map<string, string[]>();
  for (const o of scene.objects) {
    if (!visible.has(o.id) || !isPointObject(o)) continue;
    const c = objects.get(o.id);
    if (c?.kind !== 'point') continue;
    const label = o.label ?? o.id;
    if (!label) continue;
    const sp = T(c.p);
    const key = `${Math.round(sp.x / 6)},${Math.round(sp.y / 6)}`;
    const owner = labelOwner.get(key);
    if (owner) mergedLabels.get(owner)!.push(label);
    else {
      labelOwner.set(key, o.id);
      mergedLabels.set(o.id, [label]);
    }
  }

  for (const o of scene.objects) {
    if (!visible.has(o.id)) continue;
    const c = objects.get(o.id);
    if (!c || c.kind === 'undefined') continue;
    const hl = highlighted.has(o.id);
    const dim = anyHighlight && !hl;
    const color = COLORS[o.color ?? (isPointObject(o) ? 'black' : 'gray')];
    draw(o, c, color, hl, dim);
  }

  function draw(o: SceneObject, c: Computed, color: string, hl: boolean, dim: boolean) {
    const opacity = dim ? 0.35 : 1;
    const width = hl ? 4.5 : 2.2;
    const dash = 'dashed' in o && o.dashed ? '7 6' : undefined;
    const key = o.id;
    const glow = hl ? 'url(#glow)' : undefined;
    switch (c.kind) {
      case 'segment': {
        const a = T(c.a);
        const b = T(c.b);
        layers.line.push(
          <line key={key} data-id={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity} strokeLinecap="round" filter={glow} />,
        );
        // 太短的线段（动点刚出发时）不标注，避免文字挤在点上
        if (o.type === 'segment' && o.label && Math.hypot(b.x - a.x, b.y - a.y) > 28) {
          const text = interpolate(o.label, scene, params, points);
          // 标签放在线段外侧（远离图形中心）
          const nx = -(b.y - a.y);
          const ny = b.x - a.x;
          const nl = Math.hypot(nx, ny) || 1;
          const cs = T(center);
          const mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const sign = (mid0.x - cs.x) * nx + (mid0.y - cs.y) * ny >= 0 ? 1 : -1;
          // 中点附近有点时，沿线段错开一些
          const near = (m: Vec) => Object.values(points).some((p) => Math.hypot(T(p).x - m.x, T(p).y - m.y) < 18);
          let mid = mid0;
          for (const k of [0.5, 0.35, 0.65, 0.25, 0.75]) {
            const m = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
            if (!near(m)) {
              mid = m;
              break;
            }
          }
          labelSlots.push({ mid, nx: (sign * nx) / nl, ny: (sign * ny) / nl, text, color, opacity, key: `${key}-label` });
        }
        return;
      }
      case 'line':
      case 'ray': {
        const a = T(c.a);
        const b = T(c.b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const far = (W + H) * 2;
        const start = c.kind === 'line' ? { x: a.x - (dx / l) * far, y: a.y - (dy / l) * far } : a;
        const end = { x: a.x + (dx / l) * far, y: a.y + (dy / l) * far };
        layers.line.push(
          <line key={key} data-id={key} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity} filter={glow} />,
        );
        return;
      }
      case 'polygon': {
        const pts = c.pts.map(T).map((p) => `${p.x},${p.y}`).join(' ');
        const fill = o.type === 'polygon' && o.fill;
        if (fill) {
          layers.fill.push(
            <polygon key={key} data-id={key} points={pts} fill={color} fillOpacity={hl ? 0.32 : 0.16} stroke="none" opacity={opacity} />,
          );
        }
        layers.line.push(
          <polygon key={`${key}-edge`} data-id={fill ? undefined : key} points={pts} fill="none" stroke={fill ? color : COLORS.black} strokeWidth={fill ? (hl ? 3.5 : 1.5) : width} strokeDasharray={dash} opacity={fill ? opacity * 0.8 : opacity} strokeLinejoin="round" filter={glow} />,
        );
        return;
      }
      case 'circle': {
        const p = T(c.c);
        layers.line.push(
          <circle key={key} data-id={key} cx={p.x} cy={p.y} r={c.r * view.s} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} opacity={opacity} filter={glow} />,
        );
        return;
      }
      case 'angle': {
        const o2 = T(c.o);
        const a = T(c.a);
        const b = T(c.b);
        const ua = unit(a.x - o2.x, a.y - o2.y);
        const ub = unit(b.x - o2.x, b.y - o2.y);
        if (!ua || !ub) return;
        const stroke = hl ? COLORS.red : color;
        if (o.type === 'angle' && o.right) {
          const r = 14;
          const p1 = { x: o2.x + ua.x * r, y: o2.y + ua.y * r };
          const p2 = { x: o2.x + (ua.x + ub.x) * r, y: o2.y + (ua.y + ub.y) * r };
          const p3 = { x: o2.x + ub.x * r, y: o2.y + ub.y * r };
          layers.mark.push(
            <polyline key={key} data-id={key} points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`} fill="none" stroke={stroke} strokeWidth={hl ? 2.5 : 1.6} opacity={opacity} />,
          );
        } else {
          const r = 24;
          const angA = Math.atan2(ua.y, ua.x);
          let angB = Math.atan2(ub.y, ub.x);
          let sweep = angB - angA;
          while (sweep <= -Math.PI) sweep += 2 * Math.PI;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          angB = angA + sweep;
          const s = { x: o2.x + Math.cos(angA) * r, y: o2.y + Math.sin(angA) * r };
          const e = { x: o2.x + Math.cos(angB) * r, y: o2.y + Math.sin(angB) * r };
          const path = `M ${o2.x} ${o2.y} L ${s.x} ${s.y} A ${r} ${r} 0 0 ${sweep > 0 ? 1 : 0} ${e.x} ${e.y} Z`;
          layers.mark.push(
            <path key={key} data-id={key} d={path} fill={stroke} fillOpacity={0.15} stroke={stroke} strokeWidth={hl ? 2.5 : 1.5} opacity={opacity} />,
          );
          if (o.type === 'angle' && o.label) {
            const mid = angA + sweep / 2;
            layers.text.push(
              <text key={`${key}-label`} x={o2.x + Math.cos(mid) * (r + 16)} y={o2.y + Math.sin(mid) * (r + 16)} className="seg-label" fill={stroke} textAnchor="middle" dominantBaseline="middle" opacity={opacity}>
                {interpolate(o.label, scene, params, points)}
              </text>,
            );
          }
        }
        return;
      }
      case 'function':
      case 'trace': {
        const d = c.pts.map((run) => run.map((p, i) => `${i ? 'L' : 'M'} ${T(p).x.toFixed(1)} ${T(p).y.toFixed(1)}`).join(' ')).join(' ');
        layers.line.push(
          <path key={key} data-id={key} d={d} fill="none" stroke={color} strokeWidth={c.kind === 'trace' ? (hl ? 4 : 2.5) : width} strokeDasharray={c.kind === 'trace' ? '2 5' : undefined} strokeLinecap="round" opacity={c.kind === 'trace' ? opacity * 0.6 : opacity} filter={glow} />,
        );
        if (o.type === 'function' && o.label && c.pts[0]?.length) {
          const run = c.pts[c.pts.length - 1]!;
          const last = T(run[Math.floor(run.length * 0.85)]!);
          layers.text.push(
            <text key={`${key}-label`} x={last.x + 8} y={last.y - 8} className="seg-label" fill={color} opacity={opacity}>
              {o.label}
            </text>,
          );
        }
        return;
      }
      case 'text': {
        const p = T(c.at);
        if (o.type !== 'text') return;
        layers.text.push(
          <text key={key} data-id={key} x={p.x} y={p.y} className={`free-text ${hl ? 'hl' : ''}`} fill={color} opacity={opacity} textAnchor="middle" dominantBaseline="middle">
            {interpolate(o.text, scene, params, points)}
          </text>,
        );
        return;
      }
      case 'point': {
        if (!isPointObject(o)) return;
        const pointOpacity = dim ? 0.75 : 1;
        const p = T(c.p);
        const moving = o.moving;
        const r = moving ? (hl ? 8 : 6.5) : hl ? 6 : 4.2;
        layers.point.push(
          <g key={key} data-id={key} opacity={pointOpacity}>
            {moving && <circle cx={p.x} cy={p.y} r={r + 6} fill={color} opacity={0.18} className="pulse" />}
            <circle cx={p.x} cy={p.y} r={r} fill={moving ? '#fff' : color} stroke={color} strokeWidth={moving ? 3 : 1.5} />
          </g>,
        );
        const names = mergedLabels.get(o.id);
        const label = names ? (names.length > 1 ? `${names[0]}(${names.slice(1).join(',')})` : names[0]) : '';
        if (label) {
          const dir = unit(c.p.x - center.x, -(c.p.y - center.y)) ?? { x: -0.7, y: 0.7 };
          layers.text.push(
            <text key={`${key}-label`} x={p.x + dir.x * 18} y={p.y + dir.y * 18} className={`pt-label ${moving ? 'moving' : ''}`} fill={moving ? color : COLORS.black} textAnchor="middle" dominantBaseline="middle">
              {label}
            </text>,
          );
        }
        return;
      }
    }
  }

  // 线段标签：依次放置，与已放置的标签重叠时往外推
  const placed: Vec[] = [];
  for (const slot of labelSlots) {
    let pos = { x: slot.mid.x + slot.nx * 16, y: slot.mid.y + slot.ny * 16 };
    for (let push = 16; push < 80 && placed.some((p) => Math.hypot(p.x - pos.x, p.y - pos.y) < 22); push += 14) {
      pos = { x: slot.mid.x + slot.nx * (push + 14), y: slot.mid.y + slot.ny * (push + 14) };
    }
    placed.push(pos);
    layers.text.push(
      <text key={slot.key} x={pos.x} y={pos.y} className="seg-label" fill={slot.color} opacity={slot.opacity} textAnchor="middle" dominantBaseline="middle">
        {slot.text}
      </text>,
    );
  }

  const axes = scene.axes
    ? renderAxes(view, {
        xmin: view.fromScreen(0, 0).x,
        xmax: view.fromScreen(W, 0).x,
        ymin: view.fromScreen(0, H).y,
        ymax: view.fromScreen(0, 0).y,
      }, niceStep(Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin)))
    : null;

  return (
    <svg className="scene-canvas" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={scene.title} preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="glow" filterUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={W} height={H} fill="#fff" />
      {axes}
      {layers.fill}
      {layers.line}
      {layers.mark}
      {layers.point}
      {layers.text}
    </svg>
  );
}

function unit(x: number, y: number): Vec | null {
  const l = Math.hypot(x, y);
  return l < 1e-9 ? null : { x: x / l, y: y / l };
}

function niceStep(range: number): number {
  const raw = range / 10;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

function renderAxes(
  view: { toScreen: (p: Vec) => Vec },
  b: { xmin: number; xmax: number; ymin: number; ymax: number },
  step: number,
) {
  const T = view.toScreen;
  const ticks: React.ReactNode[] = [];
  const grid: React.ReactNode[] = [];
  for (let x = Math.ceil(b.xmin / step) * step; x <= b.xmax; x += step) {
    const p = T({ x, y: 0 });
    const top = T({ x, y: b.ymax });
    const bottom = T({ x, y: b.ymin });
    grid.push(<line key={`gx${x}`} x1={p.x} y1={top.y} x2={p.x} y2={bottom.y} stroke="#eef1f6" />);
    if (Math.abs(x) > 1e-9) {
      ticks.push(
        <text key={`tx${x}`} x={p.x} y={p.y + 14} className="tick" textAnchor="middle">
          {Number(x.toFixed(6))}
        </text>,
      );
    }
  }
  for (let y = Math.ceil(b.ymin / step) * step; y <= b.ymax; y += step) {
    const p = T({ x: 0, y });
    const left = T({ x: b.xmin, y });
    const right = T({ x: b.xmax, y });
    grid.push(<line key={`gy${y}`} x1={left.x} y1={p.y} x2={right.x} y2={p.y} stroke="#eef1f6" />);
    if (Math.abs(y) > 1e-9) {
      ticks.push(
        <text key={`ty${y}`} x={p.x - 6} y={p.y} className="tick" textAnchor="end" dominantBaseline="middle">
          {Number(y.toFixed(6))}
        </text>,
      );
    }
  }
  const x0 = T({ x: b.xmin, y: 0 });
  const x1 = T({ x: b.xmax, y: 0 });
  const y0 = T({ x: 0, y: b.ymin });
  const y1 = T({ x: 0, y: b.ymax });
  return (
    <g className="axes">
      {grid}
      <line x1={x0.x} y1={x0.y} x2={x1.x} y2={x1.y} stroke="#9aa3b5" strokeWidth={1.2} />
      <line x1={y0.x} y1={y0.y} x2={y1.x} y2={y1.y} stroke="#9aa3b5" strokeWidth={1.2} />
      <text x={x1.x - 6} y={x1.y - 8} className="tick" textAnchor="end">x</text>
      <text x={y1.x + 8} y={y1.y + 12} className="tick">y</text>
      {ticks}
    </g>
  );
}
