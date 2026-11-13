// 讲解剧本（Scene）的数据格式。模型按这个格式生成，程序负责计算、绘制、验算。
// 坐标是数学坐标系（y 轴向上）。所有数值字段都可以写成表达式字符串，如 "2*t"、"dist(A,B)/2"。

export type Expr = number | string;

export type Color = 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'gray' | 'black';

export interface Param {
  /** 参数名，如 t。 */
  name: string;
  min: number;
  max: number;
  /** 初始值，默认等于 min。 */
  value?: number;
  /** 滑块旁的说明，如"运动时间（秒）"。 */
  label?: string;
}

interface Base {
  id: string;
  color?: Color;
  /** 初始隐藏，等某一步 show 时才出现。 */
  hidden?: boolean;
}

interface PointBase extends Base {
  /** 显示的名字，默认等于 id；写 "" 表示不显示名字。 */
  label?: string;
  /** 是否画成动点（空心、醒目）。 */
  moving?: boolean;
}

/** 坐标点。 */
export interface FreePoint extends PointBase {
  type: 'point';
  x: Expr;
  y: Expr;
}

/** 中点。 */
export interface Midpoint extends PointBase {
  type: 'midpoint';
  of: [string, string];
}

/** 沿折线运动的点：从 path[0] 出发，沿 path 走 dist 的路程（超出终点时停在终点）。 */
export interface PathPoint extends PointBase {
  type: 'onPath';
  path: string[];
  dist: Expr;
}

/** 线段/直线上按比例取点：from + ratio * (to - from)。 */
export interface RatioPoint extends PointBase {
  type: 'ratio';
  from: string;
  to: string;
  ratio: Expr;
}

/** 两直线（各由两点确定）的交点。 */
export interface IntersectionPoint extends PointBase {
  type: 'intersection';
  lines: [[string, string], [string, string]];
}

/** 直线与圆的交点；index 0/1 按从 line[0] 指向 line[1] 的方向排序。 */
export interface LineCircleIntersection extends PointBase {
  type: 'lineCircle';
  line: [string, string];
  circle: string;
  index: 0 | 1;
}

/** 从某点向直线作垂线的垂足。 */
export interface FootPoint extends PointBase {
  type: 'foot';
  from: string;
  line: [string, string];
}

/** 绕 center 逆时针旋转 angle 度。 */
export interface RotatedPoint extends PointBase {
  type: 'rotate';
  of: string;
  center: string;
  angle: Expr;
}

/** 关于直线（两点）的对称点。 */
export interface ReflectedPoint extends PointBase {
  type: 'reflect';
  of: string;
  line: [string, string];
}

/** 从 from 出发，沿方向角 angle（度，x 轴正方向为 0，逆时针）走 length。 */
export interface PolarPoint extends PointBase {
  type: 'polar';
  from: string;
  angle: Expr;
  length: Expr;
}

export type PointObject =
  | FreePoint
  | Midpoint
  | PathPoint
  | RatioPoint
  | IntersectionPoint
  | LineCircleIntersection
  | FootPoint
  | RotatedPoint
  | ReflectedPoint
  | PolarPoint;

export interface Segment extends Base {
  type: 'segment';
  from: string;
  to: string;
  dashed?: boolean;
  /** 线段旁的文字，可以含 {表达式}，如 "2t" 或 "{dist(A,P)}"。 */
  label?: string;
}

/** 过两点的直线（两端延长到画面边缘）。 */
export interface Line extends Base {
  type: 'line';
  through: [string, string];
  dashed?: boolean;
}

export interface Ray extends Base {
  type: 'ray';
  from: string;
  through: string;
  dashed?: boolean;
}

export interface Polygon extends Base {
  type: 'polygon';
  points: string[];
  /** 是否填充（半透明），用于强调面积。 */
  fill?: boolean;
  dashed?: boolean;
}

export interface Circle extends Base {
  type: 'circle';
  center: string;
  /** 半径，与 through 二选一。 */
  radius?: Expr;
  through?: string;
  dashed?: boolean;
}

/** 角的标记；right 为直角符号。points 为 [A, 顶点, B]。 */
export interface AngleMark extends Base {
  type: 'angle';
  points: [string, string, string];
  right?: boolean;
  label?: string;
}

/** 函数图象 y = f(x)，表达式里用 x 作为自变量，也可以使用参数。 */
export interface FunctionGraph extends Base {
  type: 'function';
  expr: string;
  xmin?: Expr;
  xmax?: Expr;
  label?: string;
}

/** 文字。at 可以是点名或 [x, y]。text 可以含 {表达式}。 */
export interface TextLabel extends Base {
  type: 'text';
  at: string | [Expr, Expr];
  text: string;
}

/** 动点的轨迹：参数 param 从 min 变到 max 时 point 经过的路径。 */
export interface Trace extends Base {
  type: 'trace';
  point: string;
  param: string;
}

export type DrawObject = Segment | Line | Ray | Polygon | Circle | AngleMark | FunctionGraph | TextLabel | Trace;

export type SceneObject = PointObject | DrawObject;

export type Action =
  | { do: 'show'; ids: string[] }
  | { do: 'hide'; ids: string[] }
  /** 本步内高亮（下一步自动取消）。 */
  | { do: 'highlight'; ids: string[] }
  /** 立即把参数设为某值。 */
  | { do: 'set'; param: string; value: number }
  /** 参数从当前值（或 from）平滑变到 to，duration 秒。 */
  | { do: 'animate'; param: string; to: number; from?: number; duration?: number };

export interface Step {
  /** 朗读稿：口语化，公式要写成读法（"AP 等于 2t"）。 */
  say: string;
  /** 屏幕上显示的文字，Markdown + LaTeX；省略时显示 say。 */
  text?: string;
  actions?: Action[];
}

/** 验算条件：把参数设为 at 后，expr 必须成立（非 0）。 */
export interface Check {
  expr: string;
  at?: Record<string, number>;
  /** 说明这条验算对应的结论，如"t=1 时 PB=BC"。 */
  note?: string;
}

export interface Scene {
  version: 1;
  title: string;
  params?: Param[];
  objects: SceneObject[];
  /** 画面角落实时显示的数值，如 "PB = {dist(P,B)}"。 */
  readouts?: string[];
  /** 是否显示坐标轴（函数题、坐标系题用）。 */
  axes?: boolean;
  steps: Step[];
  checks?: Check[];
}

// ---------- 计算结果 ----------

export interface Vec {
  x: number;
  y: number;
}

export type Computed =
  | { kind: 'point'; p: Vec }
  | { kind: 'segment'; a: Vec; b: Vec }
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'ray'; a: Vec; b: Vec }
  | { kind: 'polygon'; pts: Vec[] }
  | { kind: 'circle'; c: Vec; r: number }
  | { kind: 'angle'; a: Vec; o: Vec; b: Vec }
  | { kind: 'function'; pts: Vec[][] }
  | { kind: 'text'; at: Vec }
  | { kind: 'trace'; pts: Vec[][] }
  /** 当前参数下无法计算（如两直线平行没有交点）。 */
  | { kind: 'undefined'; reason: string };

export const POINT_TYPES = new Set([
  'point',
  'midpoint',
  'onPath',
  'ratio',
  'intersection',
  'lineCircle',
  'foot',
  'rotate',
  'reflect',
  'polar',
]);

export function isPointObject(o: SceneObject): o is PointObject {
  return POINT_TYPES.has(o.type);
}
