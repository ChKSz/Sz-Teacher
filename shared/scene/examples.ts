// 手写的示例剧本：用来打磨格式和播放器，也作为给模型的参考范例。
import type { Scene } from './types.ts';

/** 例 1：矩形中的动点，等腰三角形分类讨论。 */
export const rectangleMovingPoint: Scene = {
  version: 1,
  title: '矩形中的动点：△PBC 何时是等腰三角形',
  params: [{ name: 't', min: 0, max: 4, value: 0, label: '运动时间 t（秒）' }],
  objects: [
    { id: 'A', type: 'point', x: 0, y: 0 },
    { id: 'B', type: 'point', x: 8, y: 0 },
    { id: 'C', type: 'point', x: 8, y: 6 },
    { id: 'D', type: 'point', x: 0, y: 6 },
    { id: 'rect', type: 'polygon', points: ['A', 'B', 'C', 'D'] },
    { id: 'P', type: 'onPath', path: ['A', 'B'], dist: '2*t', moving: true, color: 'red' },
    { id: 'AP', type: 'segment', from: 'A', to: 'P', color: 'red', label: '2t', hidden: true },
    { id: 'PB', type: 'segment', from: 'P', to: 'B', color: 'orange', label: '8-2t', hidden: true },
    { id: 'PC', type: 'segment', from: 'P', to: 'C', color: 'blue', dashed: true, hidden: true },
    { id: 'BC', type: 'segment', from: 'B', to: 'C', color: 'green', label: '6', hidden: true },
    { id: 'tri', type: 'polygon', points: ['P', 'B', 'C'], fill: true, color: 'blue', hidden: true },
    { id: 'rightB', type: 'angle', points: ['P', 'B', 'C'], right: true, hidden: true },
  ],
  readouts: ['t = {t}', 'PB = {dist(P,B)}', 'BC = {dist(B,C)}', 'PC = {dist(P,C)}'],
  steps: [
    {
      say: '先看题目。矩形ABCD中，AB等于8，BC等于6。点P从A出发，沿AB每秒走2个单位。',
      text: '矩形 $ABCD$ 中，$AB=8$，$BC=6$。点 $P$ 从 $A$ 出发，沿 $AB$ 以每秒 $2$ 个单位运动。',
      actions: [{ do: 'animate', param: 't', from: 0, to: 4, duration: 3 }],
    },
    {
      say: 't秒后，P走过的路程AP等于2t，所以PB等于8减2t。',
      text: '$t$ 秒后：$AP=2t$，$PB=8-2t$',
      actions: [
        { do: 'set', param: 't', value: 1.5 },
        { do: 'show', ids: ['AP', 'PB'] },
        { do: 'highlight', ids: ['AP', 'PB'] },
      ],
    },
    {
      say: '连接PC，得到三角形PBC。角B是直角，所以PC是斜边，PC的平方等于PB的平方加36。',
      text: '连接 $PC$。$\\angle B=90^\\circ$，所以 $PC^2=PB^2+BC^2=(8-2t)^2+36$',
      actions: [
        { do: 'show', ids: ['PC', 'BC', 'tri', 'rightB'] },
        { do: 'highlight', ids: ['PC'] },
      ],
    },
    {
      say: '第一种情况，PB等于BC。8减2t等于6，解得t等于1。拖动看看，t等于1时，PB和BC正好一样长。',
      text: '**情况①** $PB=BC$：$8-2t=6$，得 $t=1$ ✓',
      actions: [
        { do: 'animate', param: 't', to: 1, duration: 1.5 },
        { do: 'highlight', ids: ['PB', 'BC'] },
      ],
    },
    {
      say: '第二种情况，PB等于PC。可是PC是直角三角形的斜边，斜边总比直角边长，所以这种情况不可能。',
      text: '**情况②** $PB=PC$：$PC$ 是斜边，总有 $PC>PB$，不可能 ✗',
      actions: [
        { do: 'animate', param: 't', to: 2.5, duration: 1.5 },
        { do: 'highlight', ids: ['PB', 'PC'] },
      ],
    },
    {
      say: '第三种情况，BC等于PC。算出来t等于4，但这时P和B重合，三角形不存在了，所以要舍去。',
      text: '**情况③** $BC=PC$：得 $t=4$，此时 $P$ 与 $B$ 重合，不构成三角形，舍去 ✗',
      actions: [
        { do: 'animate', param: 't', to: 4, duration: 1.5 },
        { do: 'highlight', ids: ['BC', 'PC'] },
      ],
    },
    {
      say: '所以只有t等于1秒时，三角形PBC是等腰三角形。',
      text: '**答案：** $t=1$',
      actions: [
        { do: 'animate', param: 't', to: 1, duration: 1 },
        { do: 'highlight', ids: ['tri'] },
      ],
    },
  ],
  checks: [
    { expr: 'dist(P,B) == dist(B,C)', at: { t: 1 }, note: 't=1 时 PB=BC' },
    { expr: 'dist(P,C) > dist(P,B)', at: { t: 2 }, note: 'PC 始终大于 PB' },
    { expr: 'dist(P,C) == dist(B,C) && dist(P,B) == 0', at: { t: 4 }, note: 't=4 时 P 与 B 重合' },
  ],
};

/** 例 2：沿折线运动的点，分段面积。 */
export const pathArea: Scene = {
  version: 1,
  title: '沿正方形边运动的点：△APD 面积随时间变化',
  params: [{ name: 't', min: 0, max: 12, value: 0, label: '运动时间 t（秒）' }],
  objects: [
    { id: 'A', type: 'point', x: 0, y: 0 },
    { id: 'B', type: 'point', x: 4, y: 0 },
    { id: 'C', type: 'point', x: 4, y: 4 },
    { id: 'D', type: 'point', x: 0, y: 4 },
    { id: 'sq', type: 'polygon', points: ['A', 'B', 'C', 'D'] },
    { id: 'P', type: 'onPath', path: ['A', 'B', 'C', 'D'], dist: 't', moving: true, color: 'red' },
    { id: 'tri', type: 'polygon', points: ['A', 'P', 'D'], fill: true, color: 'orange' },
    { id: 'path', type: 'trace', point: 'P', param: 't', color: 'red', hidden: true },
  ],
  readouts: ['t = {t}', 'S△APD = {area(A,P,D)}'],
  steps: [
    {
      say: '正方形边长为4，点P从A出发，沿A到B到C到D运动，每秒1个单位。',
      text: '正方形边长 $4$，$P$ 沿 $A\\to B\\to C\\to D$ 运动，速度 $1$/秒',
      actions: [{ do: 'show', ids: ['path'] }, { do: 'animate', param: 't', from: 0, to: 12, duration: 4 }],
    },
    {
      say: '当P在AB上，也就是t在0到4之间时，三角形APD的底是AD等于4，高是AP等于t，面积是2t。',
      text: '$0\\le t\\le 4$：$S=\\frac12\\cdot 4\\cdot t=2t$',
      actions: [{ do: 'animate', param: 't', from: 0, to: 4, duration: 2 }],
    },
    {
      say: '当P在BC上，t在4到8之间时，P到AD的距离一直是4，所以面积不变，等于8。',
      text: '$4\\le t\\le 8$：$S=\\frac12\\cdot 4\\cdot 4=8$',
      actions: [{ do: 'animate', param: 't', to: 8, duration: 2 }],
    },
    {
      say: '当P在CD上，t在8到12之间时，高是PD等于12减t，面积是24减2t。',
      text: '$8\\le t\\le 12$：$S=\\frac12\\cdot 4\\cdot(12-t)=24-2t$',
      actions: [{ do: 'animate', param: 't', to: 12, duration: 2 }],
    },
  ],
  checks: [
    { expr: 'area(A,P,D) == 2*t', at: { t: 3 }, note: '0≤t≤4 时 S=2t' },
    { expr: 'area(A,P,D) == 8', at: { t: 6 }, note: '4≤t≤8 时 S=8' },
    { expr: 'area(A,P,D) == 24 - 2*t', at: { t: 10 }, note: '8≤t≤12 时 S=24-2t' },
  ],
};

/** 例 3：旋转与全等（手拉手模型）。 */
export const rotationCongruence: Scene = {
  version: 1,
  title: '旋转：等边三角形中的手拉手模型',
  params: [{ name: 'a', min: 0, max: 60, value: 0, label: '旋转角度（°）' }],
  objects: [
    { id: 'A', type: 'point', x: 0, y: 0 },
    { id: 'B', type: 'point', x: 6, y: 0 },
    { id: 'C', type: 'polar', from: 'A', angle: 60, length: 6 },
    { id: 'P', type: 'point', x: 3.2, y: 1.4, color: 'red' },
    { id: 'Q', type: 'rotate', of: 'P', center: 'A', angle: 'a', color: 'purple', moving: true },
    { id: 'abc', type: 'polygon', points: ['A', 'B', 'C'] },
    { id: 'APB', type: 'polygon', points: ['A', 'P', 'B'], fill: true, color: 'blue' },
    { id: 'AQC', type: 'polygon', points: ['A', 'Q', 'C'], fill: true, color: 'purple', hidden: true },
    { id: 'AP', type: 'segment', from: 'A', to: 'P', color: 'red' },
    { id: 'AQ', type: 'segment', from: 'A', to: 'Q', color: 'purple', hidden: true },
    { id: 'PQ', type: 'segment', from: 'P', to: 'Q', color: 'green', hidden: true },
    { id: 'rot', type: 'angle', points: ['P', 'A', 'Q'], label: '{a}°', hidden: true },
  ],
  readouts: ['旋转角 = {a}°', 'AP = {dist(A,P)}', 'AQ = {dist(A,Q)}', 'PQ = {dist(P,Q)}'],
  steps: [
    {
      say: '等边三角形ABC内有一点P。把三角形APB绕点A逆时针旋转，看看会发生什么。',
      text: '等边 $\\triangle ABC$ 内有一点 $P$，把 $\\triangle APB$ 绕 $A$ 旋转',
      actions: [{ do: 'set', param: 'a', value: 0 }],
    },
    {
      say: '旋转60度后，AB正好转到AC的位置，P转到了Q。',
      text: '旋转 $60^\\circ$：$AB\\to AC$，$P\\to Q$',
      actions: [
        { do: 'show', ids: ['AQ', 'AQC', 'rot'] },
        { do: 'animate', param: 'a', from: 0, to: 60, duration: 3 },
      ],
    },
    {
      say: '旋转不改变长度，所以AQ等于AP，而且角PAQ等于60度。',
      text: '$AQ=AP$，$\\angle PAQ=60^\\circ$',
      actions: [{ do: 'highlight', ids: ['AP', 'AQ', 'rot'] }],
    },
    {
      say: '有一个角是60度的等腰三角形是等边三角形，所以PQ等于AP。',
      text: '$\\triangle APQ$ 是等边三角形，$PQ=AP$',
      actions: [{ do: 'show', ids: ['PQ'] }, { do: 'highlight', ids: ['PQ', 'AP', 'AQ'] }],
    },
  ],
  checks: [
    { expr: 'dist(Q,C) == dist(P,B)', at: { a: 60 }, note: '旋转后 QC=PB' },
    { expr: 'dist(A,Q) == dist(A,P)', at: { a: 60 }, note: 'AQ=AP' },
    { expr: 'dist(P,Q) == dist(A,P)', at: { a: 60 }, note: '△APQ 为等边三角形' },
  ],
};

/** 例 4：二次函数与动点。 */
export const parabola: Scene = {
  version: 1,
  title: '抛物线上的动点',
  axes: true,
  params: [{ name: 'm', min: -1, max: 4, value: 0, label: '点 P 的横坐标 m' }],
  objects: [
    { id: 'f', type: 'function', expr: '-(x-1)^2+4', xmin: -1.5, xmax: 3.5, color: 'blue', label: 'y=-(x-1)²+4' },
    { id: 'O', type: 'point', x: 0, y: 0, label: 'O' },
    { id: 'A', type: 'point', x: -1, y: 0 },
    { id: 'B', type: 'point', x: 3, y: 0 },
    { id: 'P', type: 'point', x: 'm', y: '-(m-1)^2+4', moving: true, color: 'red' },
    { id: 'H', type: 'foot', from: 'P', line: ['A', 'B'], label: 'H' },
    { id: 'PH', type: 'segment', from: 'P', to: 'H', dashed: true, color: 'red' },
    { id: 'tri', type: 'polygon', points: ['A', 'B', 'P'], fill: true, color: 'orange', hidden: true },
  ],
  readouts: ['m = {m}', 'P 的纵坐标 = {y(P)}', 'S△ABP = {area(A,B,P)}'],
  steps: [
    {
      say: '抛物线y等于负的x减1的平方加4，与x轴交于A和B。点P在抛物线上运动。',
      text: '$y=-(x-1)^2+4$ 与 $x$ 轴交于 $A(-1,0)$、$B(3,0)$',
      actions: [{ do: 'animate', param: 'm', from: -1, to: 3, duration: 3 }],
    },
    {
      say: '三角形ABP的底AB等于4，高就是P的纵坐标。P越高，面积越大。',
      text: '$S_{\\triangle ABP}=\\frac12\\cdot AB\\cdot PH=2\\,|y_P|$',
      actions: [{ do: 'show', ids: ['tri'] }, { do: 'animate', param: 'm', from: 3, to: 0, duration: 2 }],
    },
    {
      say: 'P在顶点时最高，纵坐标是4，面积最大等于8。',
      text: '当 $P$ 在顶点 $(1,4)$ 时，面积最大为 $8$',
      actions: [{ do: 'animate', param: 'm', to: 1, duration: 1.5 }, { do: 'highlight', ids: ['tri'] }],
    },
  ],
  checks: [
    { expr: 'area(A,B,P) == 8', at: { m: 1 }, note: '顶点处面积为 8' },
    { expr: 'y(P) == 0', at: { m: 3 }, note: 'B 在抛物线上' },
  ],
};

export const EXAMPLES: Scene[] = [rectangleMovingPoint, pathArea, rotationCongruence, parabola];
