// 几何计算引擎：根据剧本和参数值，算出每个对象的位置。纯函数，前后端共用。
import { evalExpr, ExprError, type EvalEnv } from './expr.ts';
import type { Computed, Expr, PointObject, Scene, SceneObject, Vec } from './types.ts';
import { isPointObject } from './types.ts';

const DEG = Math.PI / 180;

class Undefined extends Error {}

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}
function scale(a: Vec, k: number): Vec {
  return { x: a.x * k, y: a.y * k };
}
function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}
function cross(a: Vec, b: Vec): number {
  return a.x * b.y - a.y * b.x;
}
function len(a: Vec): number {
  return Math.hypot(a.x, a.y);
}

export function lineIntersection(p1: Vec, p2: Vec, p3: Vec, p4: Vec): Vec | null {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-12 * Math.max(1, len(d1) * len(d2))) return null;
  const t = cross(sub(p3, p1), d2) / denom;
  return add(p1, scale(d1, t));
}

export function footOf(p: Vec, a: Vec, b: Vec): Vec {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 === 0) return a;
  return add(a, scale(d, dot(sub(p, a), d) / l2));
}

export function rotate(p: Vec, c: Vec, degrees: number): Vec {
  const r = degrees * DEG;
  const v = sub(p, c);
  return { x: c.x + v.x * Math.cos(r) - v.y * Math.sin(r), y: c.y + v.x * Math.sin(r) + v.y * Math.cos(r) };
}

/** 沿折线走 distance 的路程。 */
export function alongPath(vertices: Vec[], distance: number): Vec {
  if (vertices.length === 0) throw new Undefined('路径为空');
  let remaining = Math.max(0, distance);
  for (let i = 0; i < vertices.length - 1; i += 1) {
    const a = vertices[i]!;
    const b = vertices[i + 1]!;
    const segment = len(sub(b, a));
    if (remaining <= segment || i === vertices.length - 2) {
      const k = segment === 0 ? 0 : Math.min(1, remaining / segment);
      return add(a, scale(sub(b, a), k));
    }
    remaining -= segment;
  }
  return vertices[0]!;
}

/** 点依赖的其他点（用于拓扑排序和校验）。 */
export function pointDependencies(o: PointObject): string[] {
  switch (o.type) {
    case 'point':
      return [];
    case 'midpoint':
      return [...o.of];
    case 'onPath':
      return [...o.path];
    case 'ratio':
      return [o.from, o.to];
    case 'intersection':
      return [...o.lines[0], ...o.lines[1]];
    case 'lineCircle':
      return [...o.line];
    case 'foot':
      return [o.from, ...o.line];
    case 'rotate':
      return [o.of, o.center];
    case 'reflect':
      return [o.of, ...o.line];
    case 'polar':
      return [o.from];
  }
}

export function exprStrings(o: SceneObject): Expr[] {
  switch (o.type) {
    case 'point':
      return [o.x, o.y];
    case 'onPath':
      return [o.dist];
    case 'ratio':
      return [o.ratio];
    case 'rotate':
      return [o.angle];
    case 'polar':
      return [o.angle, o.length];
    case 'circle':
      return o.radius !== undefined ? [o.radius] : [];
    case 'function':
      return [o.xmin ?? -10, o.xmax ?? 10];
    case 'text':
      return Array.isArray(o.at) ? [...o.at] : [];
    default:
      return [];
  }
}

export interface ComputeResult {
  objects: Map<string, Computed>;
  points: Record<string, Vec>;
}

export function defaultParams(scene: Scene): Record<string, number> {
  const values: Record<string, number> = {};
  for (const p of scene.params ?? []) values[p.name] = p.value ?? p.min;
  return values;
}

/** 按依赖顺序排列对象：点在前（拓扑序），其他对象在后。 */
export function orderObjects(scene: Scene): SceneObject[] {
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  const ordered: SceneObject[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (o: SceneObject) => {
    const s = state.get(o.id);
    if (s === 'done') return;
    if (s === 'visiting') throw new ExprError(`点 ${o.id} 存在循环依赖`);
    state.set(o.id, 'visiting');
    if (isPointObject(o)) {
      for (const dep of pointDependencies(o)) {
        const d = byId.get(dep);
        if (d) visit(d);
      }
    }
    // 圆依赖圆心和 through 点；交点依赖圆
    if (o.type === 'lineCircle') {
      const c = byId.get(o.circle);
      if (c) visit(c);
    }
    if (o.type === 'circle') {
      const c = byId.get(o.center);
      if (c) visit(c);
      if (o.through) {
        const t = byId.get(o.through);
        if (t) visit(t);
      }
    }
    state.set(o.id, 'done');
    ordered.push(o);
  };
  for (const o of scene.objects) if (isPointObject(o) || o.type === 'circle') visit(o);
  for (const o of scene.objects) if (!isPointObject(o) && o.type !== 'circle') ordered.push(o);
  return ordered;
}

/** 计算所有对象在给定参数下的位置。无法计算的对象标记为 undefined，不会抛出。 */
export function computeScene(scene: Scene, params: Record<string, number>, options: { traceSamples?: number } = {}): ComputeResult {
  const points: Record<string, Vec> = {};
  const objects = new Map<string, Computed>();
  const env: EvalEnv = { vars: params, points };
  const num = (e: Expr) => {
    const v = evalExpr(e, env);
    if (!Number.isFinite(v)) throw new Undefined('数值无效');
    return v;
  };
  const pt = (id: string) => {
    const p = points[id];
    if (!p) throw new Undefined(`点 ${id} 当前不存在`);
    return p;
  };
  const circles = new Map<string, { c: Vec; r: number }>();

  for (const o of orderObjects(scene)) {
    try {
      const computed = computeOne(o);
      objects.set(o.id, computed);
      if (computed.kind === 'point') points[o.id] = computed.p;
      if (computed.kind === 'circle') circles.set(o.id, { c: computed.c, r: computed.r });
    } catch (err) {
      if (err instanceof Undefined || err instanceof ExprError) {
        objects.set(o.id, { kind: 'undefined', reason: err.message });
      } else {
        throw err;
      }
    }
  }
  return { objects, points };

  function computeOne(o: SceneObject): Computed {
    switch (o.type) {
      case 'point':
        return { kind: 'point', p: { x: num(o.x), y: num(o.y) } };
      case 'midpoint': {
        const a = pt(o.of[0]);
        const b = pt(o.of[1]);
        return { kind: 'point', p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
      case 'onPath':
        return { kind: 'point', p: alongPath(o.path.map(pt), num(o.dist)) };
      case 'ratio': {
        const a = pt(o.from);
        const b = pt(o.to);
        return { kind: 'point', p: add(a, scale(sub(b, a), num(o.ratio))) };
      }
      case 'intersection': {
        const [[a, b], [c, d]] = o.lines;
        const p = lineIntersection(pt(a), pt(b), pt(c), pt(d));
        if (!p) throw new Undefined('两直线平行，没有交点');
        return { kind: 'point', p };
      }
      case 'lineCircle': {
        const circle = circles.get(o.circle);
        if (!circle) throw new Undefined(`圆 ${o.circle} 当前不存在`);
        const a = pt(o.line[0]);
        const b = pt(o.line[1]);
        const d = sub(b, a);
        const f = sub(a, circle.c);
        const A = dot(d, d);
        const B = 2 * dot(f, d);
        const C = dot(f, f) - circle.r * circle.r;
        const disc = B * B - 4 * A * C;
        if (A === 0 || disc < -1e-9) throw new Undefined('直线与圆没有交点');
        const s = Math.sqrt(Math.max(0, disc));
        const ts = [(-B - s) / (2 * A), (-B + s) / (2 * A)];
        return { kind: 'point', p: add(a, scale(d, ts[o.index]!)) };
      }
      case 'foot':
        return { kind: 'point', p: footOf(pt(o.from), pt(o.line[0]), pt(o.line[1])) };
      case 'rotate':
        return { kind: 'point', p: rotate(pt(o.of), pt(o.center), num(o.angle)) };
      case 'reflect': {
        const f = footOf(pt(o.of), pt(o.line[0]), pt(o.line[1]));
        const p = pt(o.of);
        return { kind: 'point', p: { x: 2 * f.x - p.x, y: 2 * f.y - p.y } };
      }
      case 'polar': {
        const from = pt(o.from);
        const angle = num(o.angle) * DEG;
        const length = num(o.length);
        return { kind: 'point', p: { x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle) } };
      }
      case 'segment':
        return { kind: 'segment', a: pt(o.from), b: pt(o.to) };
      case 'line':
        return { kind: 'line', a: pt(o.through[0]), b: pt(o.through[1]) };
      case 'ray':
        return { kind: 'ray', a: pt(o.from), b: pt(o.through) };
      case 'polygon':
        return { kind: 'polygon', pts: o.points.map(pt) };
      case 'circle': {
        const c = pt(o.center);
        const r = o.through ? len(sub(pt(o.through), c)) : num(o.radius ?? 0);
        if (!(r > 0)) throw new Undefined('半径不大于 0');
        return { kind: 'circle', c, r };
      }
      case 'angle':
        return { kind: 'angle', a: pt(o.points[0]), o: pt(o.points[1]), b: pt(o.points[2]) };
      case 'function': {
        const xmin = num(o.xmin ?? -10);
        const xmax = num(o.xmax ?? 10);
        return { kind: 'function', pts: sampleFunction(o.expr, xmin, xmax, params) };
      }
      case 'text': {
        if (typeof o.at === 'string') return { kind: 'text', at: pt(o.at) };
        return { kind: 'text', at: { x: num(o.at[0]), y: num(o.at[1]) } };
      }
      case 'trace':
        return { kind: 'trace', pts: traceOf(o.point, o.param) };
    }
  }

  function traceOf(pointId: string, paramName: string): Vec[][] {
    const param = scene.params?.find((p) => p.name === paramName);
    if (!param) throw new Undefined(`参数 ${paramName} 不存在`);
    const samples = options.traceSamples ?? 120;
    const runs: Vec[][] = [[]];
    // 轨迹计算不需要再算轨迹，避免递归
    const withoutTraces: Scene = { ...scene, objects: scene.objects.filter((x) => x.type !== 'trace') };
    for (let i = 0; i <= samples; i += 1) {
      const value = param.min + ((param.max - param.min) * i) / samples;
      const result = computeScene(withoutTraces, { ...params, [paramName]: value });
      const p = result.points[pointId];
      if (p) runs.at(-1)!.push(p);
      else if (runs.at(-1)!.length) runs.push([]);
    }
    return runs.filter((r) => r.length > 1);
  }
}

function sampleFunction(expr: string, xmin: number, xmax: number, params: Record<string, number>): Vec[][] {
  const runs: Vec[][] = [[]];
  const n = 240;
  for (let i = 0; i <= n; i += 1) {
    const x = xmin + ((xmax - xmin) * i) / n;
    let y: number;
    try {
      y = evalExpr(expr, { vars: { ...params, x }, points: {} });
    } catch {
      y = Number.NaN;
    }
    if (Number.isFinite(y) && Math.abs(y) < 1e6) runs.at(-1)!.push({ x, y });
    else if (runs.at(-1)!.length) runs.push([]);
  }
  return runs.filter((r) => r.length > 1);
}

/** 把文字里的 {表达式} 替换成数值，如 "PB = {dist(P,B)}" → "PB = 6"。 */
export function interpolate(text: string, scene: Scene, params: Record<string, number>, points: Record<string, Vec>): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, expr: string) => {
    try {
      return formatNumber(evalExpr(expr, { vars: params, points }));
    } catch {
      return whole;
    }
  });
}

/** 数值的友好显示：接近整数显示整数，否则保留两位小数；识别常见根号值。 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-6) return String(rounded);
  for (const k of [2, 3, 5, 6, 7]) {
    const coef = v / Math.sqrt(k);
    const r = Math.round(coef);
    if (r !== 0 && Math.abs(coef - r) < 1e-6) return `${r === 1 ? '' : r === -1 ? '-' : r}√${k}`;
  }
  return String(Math.round(v * 100) / 100);
}

/** 计算画面范围：包含所有点（在参数取值范围内采样），加上边距。 */
export function sceneBounds(scene: Scene, visible?: ReadonlySet<string>): { xmin: number; xmax: number; ymin: number; ymax: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  const base = defaultParams(scene);
  const samples: Record<string, number>[] = [base];
  for (const p of scene.params ?? []) {
    for (let i = 0; i <= 8; i += 1) samples.push({ ...base, [p.name]: p.min + ((p.max - p.min) * i) / 8 });
  }
  for (const values of samples) {
    const { objects } = computeScene(scene, values, { traceSamples: 0 });
    for (const [id, c] of objects) {
      if (visible && !visible.has(id)) continue;
      if (c.kind === 'segment' || c.kind === 'line' || c.kind === 'ray') {
        xs.push(c.a.x, c.b.x);
        ys.push(c.a.y, c.b.y);
      } else if (c.kind === 'polygon' || c.kind === 'angle') {
        for (const p of c.kind === 'polygon' ? c.pts : [c.a, c.o, c.b]) {
          xs.push(p.x);
          ys.push(p.y);
        }
      } else if (c.kind === 'point') {
        xs.push(c.p.x);
        ys.push(c.p.y);
      } else if (c.kind === 'circle') {
        xs.push(c.c.x - c.r, c.c.x + c.r);
        ys.push(c.c.y - c.r, c.c.y + c.r);
      } else if (c.kind === 'text') {
        xs.push(c.at.x);
        ys.push(c.at.y);
      } else if (c.kind === 'function' && values === base) {
        // 函数图象：横向取定义范围，纵向只取适中的部分，避免陡峭处把画面拉得过大
        for (const run of c.pts) {
          for (const p of run) {
            xs.push(p.x);
            if (Math.abs(p.y) <= 12) ys.push(p.y);
          }
        }
      }
    }
  }
  if (scene.axes) {
    xs.push(0);
    ys.push(0);
  }
  if (xs.length === 0) return { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
  let xmin = Math.min(...xs);
  let xmax = Math.max(...xs);
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  const w = Math.max(xmax - xmin, 1);
  const h = Math.max(ymax - ymin, 1);
  const pad = Math.max(w, h) * 0.12;
  xmin -= pad;
  xmax += pad;
  ymin -= pad;
  ymax += pad;
  return { xmin, xmax, ymin, ymax };
}
