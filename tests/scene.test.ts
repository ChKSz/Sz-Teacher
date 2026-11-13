import { describe, expect, it } from 'vitest';
import { parse, evaluate, evalExpr, ExprError } from '../shared/scene/expr.ts';
import { alongPath, computeScene, formatNumber, interpolate, lineIntersection, sceneBounds } from '../shared/scene/engine.ts';
import { validateScene } from '../shared/scene/validate.ts';
import { EXAMPLES, rectangleMovingPoint } from '../shared/scene/examples.ts';
import type { Scene } from '../shared/scene/types.ts';

const env = (vars: Record<string, number> = {}, points = {}) => ({ vars, points });

describe('表达式', () => {
  it('四则运算、乘方、优先级', () => {
    expect(evalExpr('1+2*3', env())).toBe(7);
    expect(evalExpr('(1+2)*3', env())).toBe(9);
    expect(evalExpr('2^3^2', env())).toBe(512);
    expect(evalExpr('-2^2', env())).toBe(-4);
    expect(evalExpr('8-2*t', env({ t: 1.5 }))).toBe(5);
  });

  it('隐式乘法与全角符号', () => {
    expect(evalExpr('2t', env({ t: 3 }))).toBe(6);
    expect(evalExpr('2(t+1)', env({ t: 3 }))).toBe(8);
    expect(evalExpr('3×2÷4', env())).toBe(1.5);
    expect(evalExpr('（1＋2）'.replace('＋', '+'), env())).toBe(3);
    expect(evalExpr('√(16)', env())).toBe(4);
  });

  it('比较带容差，逻辑运算', () => {
    expect(evalExpr('sqrt(2)^2 == 2', env())).toBe(1);
    expect(evalExpr('0.1+0.2 = 0.3', env())).toBe(1);
    expect(evalExpr('1 < 2 && 3 >= 3', env())).toBe(1);
    expect(evalExpr('1 > 2 || 0', env())).toBe(0);
  });

  it('三角函数用角度制', () => {
    expect(evalExpr('sin(30)', env())).toBeCloseTo(0.5);
    expect(evalExpr('acos(0.5)', env())).toBeCloseTo(60);
  });

  it('几何函数', () => {
    const points = { A: { x: 0, y: 0 }, B: { x: 3, y: 0 }, C: { x: 0, y: 4 } };
    expect(evalExpr('dist(B,C)', env({}, points))).toBe(5);
    expect(evalExpr('angle(B,A,C)', env({}, points))).toBeCloseTo(90);
    expect(evalExpr('area(A,B,C)', env({}, points))).toBe(6);
    expect(evalExpr('x(B)+y(C)', env({}, points))).toBe(7);
  });

  it('错误输入给出中文提示，且不能执行任意代码', () => {
    expect(() => parse('1+')).toThrow(ExprError);
    expect(() => parse('2 $ 3')).toThrow('无法识别');
    expect(() => evaluate(parse('constructor(1)'), env())).toThrow('未知的函数');
    expect(() => evaluate(parse('q+1'), env())).toThrow('未知的变量');
    expect(() => evaluate(parse('dist(A,Z)'), env({}, { A: { x: 0, y: 0 } }))).toThrow('未知的点');
  });
});

describe('几何计算', () => {
  it('沿折线运动', () => {
    const path = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }];
    expect(alongPath(path, 2)).toEqual({ x: 2, y: 0 });
    expect(alongPath(path, 6)).toEqual({ x: 4, y: 2 });
    expect(alongPath(path, 100)).toEqual({ x: 4, y: 4 });
    expect(alongPath(path, -1)).toEqual({ x: 0, y: 0 });
  });

  it('直线交点与平行', () => {
    expect(lineIntersection({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toEqual({ x: 1, y: 1 });
    expect(lineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('各种构造点', () => {
    const scene: Scene = {
      version: 1,
      title: 'x',
      objects: [
        { id: 'A', type: 'point', x: 0, y: 0 },
        { id: 'B', type: 'point', x: 4, y: 0 },
        { id: 'C', type: 'point', x: 0, y: 4 },
        { id: 'M', type: 'midpoint', of: ['B', 'C'] },
        { id: 'F', type: 'foot', from: 'A', line: ['B', 'C'] },
        { id: 'R', type: 'reflect', of: 'A', line: ['B', 'C'] },
        { id: 'Q', type: 'rotate', of: 'B', center: 'A', angle: 90 },
        { id: 'K', type: 'ratio', from: 'A', to: 'B', ratio: 0.25 },
        { id: 'circ', type: 'circle', center: 'A', radius: 2 },
        { id: 'X0', type: 'lineCircle', line: ['A', 'B'], circle: 'circ', index: 0 },
        { id: 'X1', type: 'lineCircle', line: ['A', 'B'], circle: 'circ', index: 1 },
        { id: 'far', type: 'circle', center: 'C', radius: 1 },
        { id: 'none', type: 'lineCircle', line: ['A', 'B'], circle: 'far', index: 0 },
      ],
      steps: [{ say: 'x' }],
    };
    const { points, objects } = computeScene(scene, {});
    expect(points.M).toEqual({ x: 2, y: 2 });
    expect(points.F).toEqual({ x: 2, y: 2 });
    expect(points.R).toEqual({ x: 4, y: 4 });
    expect(points.Q!.x).toBeCloseTo(0);
    expect(points.Q!.y).toBeCloseTo(4);
    expect(points.K).toEqual({ x: 1, y: 0 });
    expect(points.X0).toEqual({ x: -2, y: 0 });
    expect(points.X1).toEqual({ x: 2, y: 0 });
    expect(objects.get('none')!.kind).toBe('undefined');
  });

  it('依赖顺序与对象声明顺序无关', () => {
    const scene: Scene = {
      version: 1,
      title: 'x',
      objects: [
        { id: 'M', type: 'midpoint', of: ['A', 'B'] },
        { id: 'A', type: 'point', x: 0, y: 0 },
        { id: 'B', type: 'point', x: 2, y: 0 },
      ],
      steps: [{ say: 'x' }],
    };
    expect(computeScene(scene, {}).points.M).toEqual({ x: 1, y: 0 });
  });

  it('文字插值与数值格式', () => {
    const { points } = computeScene(rectangleMovingPoint, { t: 1 });
    expect(interpolate('PB = {dist(P,B)}，PC = {dist(P,C)}', rectangleMovingPoint, { t: 1 }, points)).toBe('PB = 6，PC = 6√2');
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(1 / 3)).toBe('0.33');
    expect(formatNumber(2 * Math.sqrt(3))).toBe('2√3');
  });

  it('画面范围包含动点的整个运动范围', () => {
    const b = sceneBounds(rectangleMovingPoint);
    expect(b.xmin).toBeLessThan(0);
    expect(b.xmax).toBeGreaterThan(8);
    expect(b.ymax).toBeGreaterThan(6);
  });
});

describe('剧本校验', () => {
  it('所有示例剧本都通过校验和验算', () => {
    for (const scene of EXAMPLES) {
      const result = validateScene(scene);
      expect({ title: scene.title, ...result }).toMatchObject({ title: scene.title, ok: true, errors: [], checkFailures: [] });
    }
  });

  it('发现结构错误', () => {
    expect(validateScene(null).errors[0]).toContain('JSON 对象');
    const r = validateScene({ title: 'x', objects: [{ id: 'A', type: 'blob' }], steps: [] });
    expect(r.errors.join()).toContain('steps 至少要有一步');
  });

  it('发现引用错误和表达式错误', () => {
    const scene = {
      version: 1,
      title: 'x',
      params: [{ name: 't', min: 0, max: 4 }],
      objects: [
        { id: 'A', type: 'point', x: 0, y: 0 },
        { id: 'P', type: 'onPath', path: ['A', 'Z'], dist: '2*s' },
        { id: 's1', type: 'segment', from: 'A', to: 'P' },
      ],
      steps: [{ say: 'x', actions: [{ do: 'animate', param: 't', to: 9 }, { do: 'show', ids: ['nope'] }] }],
      checks: [{ expr: 'dist(A,Q) == 1' }],
    };
    const errors = validateScene(scene).errors.join('\n');
    expect(errors).toContain('不存在的点 Z');
    expect(errors).toContain('未定义的变量 s');
    expect(errors).toContain('超出了范围');
    expect(errors).toContain('不存在的对象 nope');
    expect(errors).toContain('不存在的点 Q');
  });

  it('验算不成立时报告', () => {
    const wrong = structuredClone(rectangleMovingPoint);
    wrong.checks = [{ expr: 'dist(P,B) == dist(B,C)', at: { t: 2 }, note: 't=2 时 PB=BC' }];
    const r = validateScene(wrong);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.checkFailures[0]).toContain('t=2 时 PB=BC');
  });

  it('发现循环依赖', () => {
    const scene = {
      version: 1,
      title: 'x',
      objects: [
        { id: 'A', type: 'midpoint', of: ['B', 'C'] },
        { id: 'B', type: 'midpoint', of: ['A', 'C'] },
        { id: 'C', type: 'point', x: 0, y: 0 },
      ],
      steps: [{ say: 'x' }],
    };
    expect(validateScene(scene).errors.join()).toContain('循环依赖');
  });

  it('朗读稿里有公式符号时给出提示', () => {
    const s = structuredClone(rectangleMovingPoint);
    s.steps[0]!.say = '设 $t$ 秒';
    expect(validateScene(s).warnings.join()).toContain('朗读稿');
  });
});
