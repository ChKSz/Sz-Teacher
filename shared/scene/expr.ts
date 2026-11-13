// 安全的数学表达式解析与求值（不使用 eval）。
//
// 支持：数字、变量（参数名，如 t）、点名作为函数参数、+ - * / ^、括号、一元负号、
// 比较 == != < > <= >=（结果为 1 或 0，== 带容差）、&& ||、
// 函数 sqrt abs min max sin cos tan（角度制）asin acos atan（返回角度）round floor ceil
// 以及几何函数 dist(A,B) x(A) y(A) angle(A,B,C) area(A,B,C,...) slope(A,B)。
// 常量：pi。

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '-' | '+' | '!'; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

export class ExprError extends Error {}

type Token = { type: 'num'; value: number } | { type: 'id'; value: string } | { type: 'op'; value: string };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '^', '(', ')', ',', '<', '>', '!', '='];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  // 兼容模型常用的全角符号与 × ÷ ·
  const text = src
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[，]/g, ',')
    .replace(/[×·⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt');
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) {
      tokens.push({ type: 'num', value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_']*/.exec(text.slice(i));
    if (id) {
      tokens.push({ type: 'id', value: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (op) {
      tokens.push({ type: 'op', value: op === '=' ? '==' : op });
      i += op.length;
      continue;
    }
    throw new ExprError(`无法识别的字符"${ch}"`);
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '^': 8,
};

export function parse(src: string): Node {
  if (typeof src !== 'string' || src.trim() === '') throw new ExprError('表达式为空');
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const expectOp = (value: string) => {
    const t = tokens[pos];
    if (!t || t.type !== 'op' || t.value !== value) throw new ExprError(`缺少"${value}"`);
    pos += 1;
  };

  const primary = (): Node => {
    const t = tokens[pos];
    if (!t) throw new ExprError('表达式不完整');
    pos += 1;
    if (t.type === 'num') return implicitMul({ kind: 'num', value: t.value });
    if (t.type === 'id') {
      const next = peek();
      if (next && next.type === 'op' && next.value === '(') {
        pos += 1;
        const args: Node[] = [];
        if (!(peek()?.type === 'op' && peek()?.value === ')')) {
          for (;;) {
            args.push(expression(0));
            const sep = peek();
            if (sep?.type === 'op' && sep.value === ',') {
              pos += 1;
              continue;
            }
            break;
          }
        }
        expectOp(')');
        return implicitMul({ kind: 'call', name: t.value, args });
      }
      return implicitMul({ kind: 'var', name: t.value });
    }
    if (t.value === '(') {
      const inner = expression(0);
      expectOp(')');
      return implicitMul(inner);
    }
    if (t.value === '-' || t.value === '+' || t.value === '!') {
      // 一元运算优先级高于乘除、低于乘方：-2^2 = -4
      return { kind: 'unary', op: t.value, arg: expression(7) };
    }
    throw new ExprError(`意外的"${t.value}"`);
  };

  /** 隐式乘法：2t、2(t+1)、(a)(b)。 */
  const implicitMul = (left: Node): Node => {
    const next = peek();
    if (!next) return left;
    const startsOperand =
      next.type === 'num' || next.type === 'id' || (next.type === 'op' && next.value === '(');
    if (!startsOperand) return left;
    // 只在左侧是数字、或左侧以括号结束时允许，避免把 "t x" 这类拼写错误吞掉
    if (left.kind === 'var' && next.type !== 'op') return left;
    const right = parsePower();
    return { kind: 'binary', op: '*', left, right };
  };

  const parsePower = (): Node => {
    let left = primary();
    const next = peek();
    if (next?.type === 'op' && next.value === '^') {
      pos += 1;
      left = { kind: 'binary', op: '^', left, right: expression(7) };
    }
    return left;
  };

  const expression = (minPrec: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op') break;
      const prec = PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      pos += 1;
      // ^ 右结合
      const right = expression(t.value === '^' ? prec : prec + 1);
      left = { kind: 'binary', op: t.value, left, right };
    }
    return left;
  };

  const tree = expression(0);
  if (pos < tokens.length) {
    const t = tokens[pos]!;
    throw new ExprError(`多余的"${t.type === 'num' ? t.value : t.value}"`);
  }
  return tree;
}

export type Vec = { x: number; y: number };

export interface EvalEnv {
  /** 参数（如 t）。 */
  vars: Record<string, number>;
  /** 已计算出的点坐标。 */
  points: Record<string, Vec>;
}

const EPS = 1e-6;
const DEG = Math.PI / 180;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

function pointArg(node: Node | undefined, env: EvalEnv, fn: string): Vec {
  if (!node || node.kind !== 'var') throw new ExprError(`${fn}() 的参数必须是点名`);
  const p = Object.hasOwn(env.points, node.name) ? env.points[node.name] : undefined;
  if (!p) throw new ExprError(`未知的点 ${node.name}`);
  return p;
}

function polygonArea(points: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

const NUMERIC: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  sin: (d) => Math.sin(d * DEG),
  cos: (d) => Math.cos(d * DEG),
  tan: (d) => Math.tan(d * DEG),
  asin: (v) => Math.asin(v) / DEG,
  acos: (v) => Math.acos(v) / DEG,
  atan: (v) => Math.atan(v) / DEG,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const GEOMETRIC = new Set(['dist', 'x', 'y', 'angle', 'area', 'slope']);

export const KNOWN_FUNCTIONS = new Set([...Object.keys(NUMERIC), ...GEOMETRIC]);

export function evaluate(node: Node, env: EvalEnv): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      if (node.name === 'pi') return Math.PI;
      const v = Object.hasOwn(env.vars, node.name) ? env.vars[node.name] : undefined;
      if (typeof v !== "number") throw new ExprError(`未知的变量 ${node.name}`);
      return v;
    }
    case 'unary': {
      const v = evaluate(node.arg, env);
      if (node.op === '-') return -v;
      if (node.op === '!') return v ? 0 : 1;
      return v;
    }
    case 'binary': {
      if (node.op === '&&') return evaluate(node.left, env) && evaluate(node.right, env) ? 1 : 0;
      if (node.op === '||') return evaluate(node.left, env) || evaluate(node.right, env) ? 1 : 0;
      const a = evaluate(node.left, env);
      const b = evaluate(node.right, env);
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return a ** b;
        case '==':
          return approxEqual(a, b) ? 1 : 0;
        case '!=':
          return approxEqual(a, b) ? 0 : 1;
        case '<':
          return a < b && !approxEqual(a, b) ? 1 : 0;
        case '>':
          return a > b && !approxEqual(a, b) ? 1 : 0;
        case '<=':
          return a < b || approxEqual(a, b) ? 1 : 0;
        case '>=':
          return a > b || approxEqual(a, b) ? 1 : 0;
      }
      throw new ExprError(`未知运算符 ${node.op}`);
    }
    case 'call': {
      const { name, args } = node;
      if (GEOMETRIC.has(name)) {
        switch (name) {
          case 'dist': {
            if (args.length !== 2) throw new ExprError('dist() 需要两个点');
            const a = pointArg(args[0], env, name);
            const b = pointArg(args[1], env, name);
            return Math.hypot(a.x - b.x, a.y - b.y);
          }
          case 'x':
          case 'y': {
            if (args.length !== 1) throw new ExprError(`${name}() 需要一个点`);
            const p = pointArg(args[0], env, name);
            return name === 'x' ? p.x : p.y;
          }
          case 'slope': {
            if (args.length !== 2) throw new ExprError('slope() 需要两个点');
            const a = pointArg(args[0], env, name);
            const b = pointArg(args[1], env, name);
            return (b.y - a.y) / (b.x - a.x);
          }
          case 'angle': {
            if (args.length !== 3) throw new ExprError('angle() 需要三个点，第二个是顶点');
            const a = pointArg(args[0], env, name);
            const o = pointArg(args[1], env, name);
            const b = pointArg(args[2], env, name);
            const v1 = { x: a.x - o.x, y: a.y - o.y };
            const v2 = { x: b.x - o.x, y: b.y - o.y };
            const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
            return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
          }
          case 'area': {
            if (args.length < 3) throw new ExprError('area() 至少需要三个点');
            return polygonArea(args.map((a) => pointArg(a, env, name)));
          }
        }
      }
      const fn = Object.hasOwn(NUMERIC, name) ? NUMERIC[name] : undefined;
      if (!fn) throw new ExprError(`未知的函数 ${name}()`);
      return fn(...args.map((a) => evaluate(a, env)));
    }
  }
}

/** 收集表达式里引用的变量名和点名（函数参数里的名字视为点名）。 */
export function references(node: Node): { vars: Set<string>; points: Set<string>; functions: Set<string> } {
  const vars = new Set<string>();
  const points = new Set<string>();
  const functions = new Set<string>();
  const walk = (n: Node, inGeometric: boolean) => {
    switch (n.kind) {
      case 'var':
        if (n.name === 'pi') return;
        (inGeometric ? points : vars).add(n.name);
        return;
      case 'unary':
        walk(n.arg, false);
        return;
      case 'binary':
        walk(n.left, false);
        walk(n.right, false);
        return;
      case 'call':
        functions.add(n.name);
        for (const a of n.args) walk(a, GEOMETRIC.has(n.name));
        return;
      case 'num':
        return;
    }
  };
  walk(node, false);
  return { vars, points, functions };
}

/** 带缓存的解析。 */
const cache = new Map<string, Node>();
export function parseCached(src: string): Node {
  let node = cache.get(src);
  if (!node) {
    node = parse(src);
    if (cache.size > 5000) cache.clear();
    cache.set(src, node);
  }
  return node;
}

export function evalExpr(src: string | number, env: EvalEnv): number {
  if (typeof src === 'number') return src;
  return evaluate(parseCached(src), env);
}
