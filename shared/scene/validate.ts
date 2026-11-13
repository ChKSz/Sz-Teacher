// 剧本校验：结构是否完整、引用是否存在、表达式能否解析、验算条件是否成立。
// 返回中文错误列表，可直接交给模型修正。
import { parse, references, KNOWN_FUNCTIONS, ExprError, evalExpr } from './expr.ts';
import { computeScene, defaultParams, exprStrings, orderObjects, pointDependencies } from './engine.ts';
import type { Scene, SceneObject } from './types.ts';
import { isPointObject, POINT_TYPES } from './types.ts';

const DRAW_TYPES = new Set(['segment', 'line', 'ray', 'polygon', 'circle', 'angle', 'function', 'text', 'trace']);
const COLORS = new Set(['blue', 'red', 'green', 'orange', 'purple', 'gray', 'black']);
const ACTIONS = new Set(['show', 'hide', 'highlight', 'set', 'animate']);

export interface ValidationResult {
  ok: boolean;
  /** 结构错误：剧本无法使用。 */
  errors: string[];
  /** 验算失败：剧本能画，但结论与图形不符。 */
  checkFailures: string[];
  /** 不影响使用的提示。 */
  warnings: string[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isExpr(v: unknown): boolean {
  return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '');
}
function isStrArray(v: unknown, min = 0): v is string[] {
  return Array.isArray(v) && v.length >= min && v.every((x) => typeof x === 'string');
}

/** 检查 JSON 结构。通过后才能安全地把它当作 Scene 使用。 */
function checkStructure(raw: unknown, errors: string[]): raw is Scene {
  if (!isObj(raw)) {
    errors.push('剧本必须是一个 JSON 对象');
    return false;
  }
  if (typeof raw.title !== 'string') errors.push('缺少 title');
  if (!Array.isArray(raw.objects)) errors.push('缺少 objects 数组');
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) errors.push('steps 至少要有一步');
  if (raw.params !== undefined && !Array.isArray(raw.params)) errors.push('params 必须是数组');
  if (errors.length) return false;

  const ids = new Set<string>();
  for (const [i, p] of ((raw.params as unknown[]) ?? []).entries()) {
    if (!isObj(p) || typeof p.name !== 'string' || !/^[A-Za-z_]\w*$/.test(p.name)) {
      errors.push(`params[${i}] 的 name 必须是英文变量名`);
      continue;
    }
    if (typeof p.min !== 'number' || typeof p.max !== 'number' || !(p.max > p.min)) {
      errors.push(`参数 ${p.name} 的 min/max 必须是数字且 max > min`);
    }
    if (p.value !== undefined && typeof p.value !== 'number') errors.push(`参数 ${p.name} 的 value 必须是数字`);
  }

  for (const [i, o] of (raw.objects as unknown[]).entries()) {
    const where = `objects[${i}]`;
    if (!isObj(o)) {
      errors.push(`${where} 不是对象`);
      continue;
    }
    const id = o.id;
    if (typeof id !== 'string' || id === '') {
      errors.push(`${where} 缺少 id`);
      continue;
    }
    if (ids.has(id)) errors.push(`id "${id}" 重复`);
    ids.add(id);
    const type = o.type;
    if (typeof type !== 'string' || (!POINT_TYPES.has(type) && !DRAW_TYPES.has(type))) {
      errors.push(`${id} 的 type "${String(type)}" 不支持`);
      continue;
    }
    if (o.color !== undefined && !COLORS.has(o.color as string)) errors.push(`${id} 的 color 不支持`);
    const need = (field: string, ok: boolean, hint: string) => {
      if (!ok) errors.push(`${id}（${type}）的 ${field} ${hint}`);
    };
    const pair = (v: unknown) => isStrArray(v) && v.length === 2;
    switch (type) {
      case 'point':
        need('x', isExpr(o.x), '必须是数字或表达式');
        need('y', isExpr(o.y), '必须是数字或表达式');
        break;
      case 'midpoint':
        need('of', pair(o.of), '必须是两个点名');
        break;
      case 'onPath':
        need('path', isStrArray(o.path, 2), '至少要有两个点名');
        need('dist', isExpr(o.dist), '必须是数字或表达式');
        break;
      case 'ratio':
        need('from/to', typeof o.from === 'string' && typeof o.to === 'string', '必须是点名');
        need('ratio', isExpr(o.ratio), '必须是数字或表达式');
        break;
      case 'intersection':
        need('lines', Array.isArray(o.lines) && o.lines.length === 2 && o.lines.every(pair), '必须是两组点名，如 [["A","B"],["C","D"]]');
        break;
      case 'lineCircle':
        need('line', pair(o.line), '必须是两个点名');
        need('circle', typeof o.circle === 'string', '必须是圆的 id');
        need('index', o.index === 0 || o.index === 1, '必须是 0 或 1');
        break;
      case 'foot':
        need('from', typeof o.from === 'string', '必须是点名');
        need('line', pair(o.line), '必须是两个点名');
        break;
      case 'rotate':
        need('of/center', typeof o.of === 'string' && typeof o.center === 'string', '必须是点名');
        need('angle', isExpr(o.angle), '必须是数字或表达式');
        break;
      case 'reflect':
        need('of', typeof o.of === 'string', '必须是点名');
        need('line', pair(o.line), '必须是两个点名');
        break;
      case 'polar':
        need('from', typeof o.from === 'string', '必须是点名');
        need('angle/length', isExpr(o.angle) && isExpr(o.length), '必须是数字或表达式');
        break;
      case 'segment':
        need('from/to', typeof o.from === 'string' && typeof o.to === 'string', '必须是点名');
        break;
      case 'line':
        need('through', pair(o.through), '必须是两个点名');
        break;
      case 'ray':
        need('from/through', typeof o.from === 'string' && typeof o.through === 'string', '必须是点名');
        break;
      case 'polygon':
        need('points', isStrArray(o.points, 3), '至少要有三个点名');
        break;
      case 'circle':
        need('center', typeof o.center === 'string', '必须是点名');
        need('radius 或 through', isExpr(o.radius) !== (typeof o.through === 'string'), '必须二选一');
        break;
      case 'angle':
        need('points', isStrArray(o.points) && o.points.length === 3, '必须是三个点名 [A, 顶点, B]');
        break;
      case 'function':
        need('expr', typeof o.expr === 'string' && o.expr.trim() !== '', '必须是关于 x 的表达式');
        break;
      case 'text':
        need('text', typeof o.text === 'string', '必须是文字');
        need('at', typeof o.at === 'string' || (Array.isArray(o.at) && o.at.length === 2 && o.at.every(isExpr)), '必须是点名或 [x, y]');
        break;
      case 'trace':
        need('point/param', typeof o.point === 'string' && typeof o.param === 'string', '必须是点名和参数名');
        break;
    }
  }

  for (const [i, s] of (raw.steps as unknown[]).entries()) {
    if (!isObj(s) || typeof s.say !== 'string' || s.say.trim() === '') {
      errors.push(`steps[${i}] 缺少 say（朗读稿）`);
      continue;
    }
    if (s.text !== undefined && typeof s.text !== 'string') errors.push(`steps[${i}].text 必须是文字`);
    if (s.actions !== undefined && !Array.isArray(s.actions)) errors.push(`steps[${i}].actions 必须是数组`);
    for (const [j, a] of ((s.actions as unknown[]) ?? []).entries()) {
      const where = `steps[${i}].actions[${j}]`;
      if (!isObj(a) || !ACTIONS.has(a.do as string)) {
        errors.push(`${where} 的 do 必须是 show/hide/highlight/set/animate 之一`);
        continue;
      }
      if (['show', 'hide', 'highlight'].includes(a.do as string) && !isStrArray(a.ids, 1)) {
        errors.push(`${where} 需要 ids（对象 id 数组）`);
      }
      if (a.do === 'set' && (typeof a.param !== 'string' || typeof a.value !== 'number')) {
        errors.push(`${where} 需要 param 和数字 value`);
      }
      if (a.do === 'animate' && (typeof a.param !== 'string' || typeof a.to !== 'number')) {
        errors.push(`${where} 需要 param 和数字 to`);
      }
    }
  }

  if (raw.checks !== undefined) {
    if (!Array.isArray(raw.checks)) errors.push('checks 必须是数组');
    else {
      for (const [i, c] of raw.checks.entries()) {
        if (!isObj(c) || typeof c.expr !== 'string') errors.push(`checks[${i}] 缺少 expr`);
        else if (c.at !== undefined && (!isObj(c.at) || !Object.values(c.at).every((v) => typeof v === 'number'))) {
          errors.push(`checks[${i}].at 必须是 {参数名: 数字}`);
        }
      }
    }
  }
  if (raw.readouts !== undefined && !isStrArray(raw.readouts)) errors.push('readouts 必须是文字数组');
  return errors.length === 0;
}

/** 检查引用的点、参数、函数是否存在，表达式能否解析。 */
function checkReferences(scene: Scene, errors: string[], warnings: string[]): void {
  const ids = new Map(scene.objects.map((o) => [o.id, o]));
  const pointIds = new Set(scene.objects.filter(isPointObject).map((o) => o.id));
  const params = new Set((scene.params ?? []).map((p) => p.name));

  const checkExpr = (src: unknown, where: string, extraVars: string[] = []) => {
    if (typeof src !== 'string') return;
    try {
      const refs = references(parse(src));
      for (const v of refs.vars) {
        if (!params.has(v) && !extraVars.includes(v)) errors.push(`${where} 的表达式"${src}"用到了未定义的变量 ${v}`);
      }
      for (const p of refs.points) if (!pointIds.has(p)) errors.push(`${where} 的表达式"${src}"用到了不存在的点 ${p}`);
      for (const f of refs.functions) if (!KNOWN_FUNCTIONS.has(f)) errors.push(`${where} 的表达式"${src}"用到了不支持的函数 ${f}()`);
    } catch (err) {
      errors.push(`${where} 的表达式"${src}"有误：${(err as Error).message}`);
    }
  };
  const needPoint = (name: string, where: string) => {
    if (!pointIds.has(name)) errors.push(`${where} 引用了不存在的点 ${name}`);
  };

  for (const o of scene.objects) {
    if (isPointObject(o)) for (const d of pointDependencies(o)) needPoint(d, o.id);
    if (o.type === 'lineCircle') {
      const c = ids.get(o.circle);
      if (!c || c.type !== 'circle') errors.push(`${o.id} 引用的 ${o.circle} 不是圆`);
    }
    if (o.type === 'segment') [o.from, o.to].forEach((p) => needPoint(p, o.id));
    if (o.type === 'line') o.through.forEach((p) => needPoint(p, o.id));
    if (o.type === 'ray') [o.from, o.through].forEach((p) => needPoint(p, o.id));
    if (o.type === 'polygon') o.points.forEach((p) => needPoint(p, o.id));
    if (o.type === 'circle') {
      needPoint(o.center, o.id);
      if (o.through) needPoint(o.through, o.id);
    }
    if (o.type === 'angle') o.points.forEach((p) => needPoint(p, o.id));
    if (o.type === 'text' && typeof o.at === 'string') needPoint(o.at, o.id);
    if (o.type === 'trace') {
      needPoint(o.point, o.id);
      if (!params.has(o.param)) errors.push(`${o.id} 引用了不存在的参数 ${o.param}`);
    }
    for (const e of exprStrings(o)) checkExpr(e, o.id);
    if (o.type === 'function') checkExpr(o.expr, o.id, ['x']);
    for (const text of textTemplates(o)) {
      for (const m of text.matchAll(/\{([^{}]+)\}/g)) checkExpr(m[1], `${o.id} 的文字`);
    }
  }

  for (const r of scene.readouts ?? []) for (const m of r.matchAll(/\{([^{}]+)\}/g)) checkExpr(m[1], 'readouts');

  for (const [i, s] of scene.steps.entries()) {
    for (const a of s.actions ?? []) {
      if (a.do === 'show' || a.do === 'hide' || a.do === 'highlight') {
        for (const id of a.ids) if (!ids.has(id)) errors.push(`steps[${i}] 的 ${a.do} 引用了不存在的对象 ${id}`);
      } else {
        const p = scene.params?.find((x) => x.name === a.param);
        if (!p) errors.push(`steps[${i}] 的 ${a.do} 引用了不存在的参数 ${a.param}`);
        else {
          const value = a.do === 'set' ? a.value : a.to;
          if (value < p.min - 1e-9 || value > p.max + 1e-9) {
            errors.push(`steps[${i}] 把参数 ${a.param} 设为 ${value}，超出了范围 [${p.min}, ${p.max}]`);
          }
        }
      }
    }
    if (/\$/.test(s.say)) warnings.push(`steps[${i}] 的朗读稿里有 $ 公式符号，读出来会很奇怪`);
  }

  for (const [i, c] of (scene.checks ?? []).entries()) {
    checkExpr(c.expr, `checks[${i}]`);
    for (const name of Object.keys(c.at ?? {})) {
      if (!params.has(name)) errors.push(`checks[${i}].at 引用了不存在的参数 ${name}`);
    }
  }

  try {
    orderObjects(scene);
  } catch (err) {
    errors.push((err as Error).message);
  }
}

function textTemplates(o: SceneObject): string[] {
  if (o.type === 'text') return [o.text];
  if ((o.type === 'segment' || o.type === 'angle' || o.type === 'function') && o.label) return [o.label];
  return [];
}

/** 在参数范围内采样，检查图形能否画出来。 */
function checkDrawable(scene: Scene, errors: string[], warnings: string[]): void {
  const base = defaultParams(scene);
  const { objects } = computeScene(scene, base, { traceSamples: 0 });
  for (const o of scene.objects) {
    const c = objects.get(o.id);
    if (c?.kind === 'undefined' && !o.hidden) {
      const where = Object.keys(base).length
        ? `（参数 ${Object.entries(base).map(([k, v]) => `${k}=${v}`).join(', ')} 时）`
        : '';
      errors.push(`${o.id} 无法画出${where}：${c.reason}`);
    }
  }
  for (const p of scene.params ?? []) {
    let broken = 0;
    for (let i = 0; i <= 10; i += 1) {
      const values = { ...base, [p.name]: p.min + ((p.max - p.min) * i) / 10 };
      const result = computeScene(scene, values, { traceSamples: 0 });
      if ([...result.objects.values()].some((c) => c.kind === 'undefined')) broken += 1;
    }
    if (broken > 0) warnings.push(`参数 ${p.name} 在部分取值下有对象无法画出（${broken}/11 个采样点）`);
  }
}

function runChecks(scene: Scene, failures: string[]): void {
  const base = defaultParams(scene);
  for (const [i, c] of (scene.checks ?? []).entries()) {
    const values = { ...base, ...c.at };
    const label = c.note ? `"${c.note}"` : `checks[${i}]`;
    const at = Object.keys(c.at ?? {}).length
      ? `在 ${Object.entries(c.at!).map(([k, v]) => `${k}=${v}`).join(', ')} 时`
      : '';
    try {
      const { points } = computeScene(scene, values, { traceSamples: 0 });
      const ok = evalExpr(c.expr, { vars: values, points });
      if (!ok) failures.push(`验算失败：${label} ${at}不成立（${c.expr}）`);
    } catch (err) {
      const message = err instanceof ExprError ? err.message : String(err);
      failures.push(`验算失败：${label} ${at}无法计算（${message}）`);
    }
  }
}

export function validateScene(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checkFailures: string[] = [];
  if (checkStructure(raw, errors)) {
    checkReferences(raw, errors, warnings);
    if (errors.length === 0) checkDrawable(raw, errors, warnings);
    if (errors.length === 0) runChecks(raw, checkFailures);
  }
  return { ok: errors.length === 0 && checkFailures.length === 0, errors, checkFailures, warnings };
}
