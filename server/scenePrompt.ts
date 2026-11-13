// 生成讲解剧本的提示词。格式说明要足够精确，模型才能一次写对。
import { rectangleMovingPoint, pathArea } from '../shared/scene/examples.ts';

const FORMAT = `
你要把一道初中数学题的解答改写成"讲解剧本"（JSON），程序会根据剧本画出几何图形、播放动画、朗读讲解。

## 剧本结构
{
  "version": 1,
  "title": "简短标题",
  "params": [{"name": "t", "min": 0, "max": 4, "value": 0, "label": "运动时间 t（秒）"}],   // 动点题的参数；静态题可省略
  "axes": false,          // 函数题/坐标系题设为 true，画坐标轴
  "objects": [...],       // 图形对象
  "readouts": ["PB = {dist(P,B)}"],  // 画面角落实时显示的数值（可选，动点题强烈建议）
  "steps": [...],         // 讲解步骤
  "checks": [...]         // 验算条件（必须有）
}

## 坐标
- 使用数学坐标（y 轴向上）。自己选一个方便的坐标系，让题目里的已知长度、角度精确成立。
  例如矩形 AB=8、BC=6：A(0,0) B(8,0) C(8,6) D(0,6)。
- 题目没给具体数值时，选一组合理的数值，让图形看起来像题目里的图（不要画成特殊图形，除非题目要求）。
- 题目给了坐标系就用题目的坐标。

## 对象（每个都要有唯一 id；点的 id 就是点名，如 "A"、"P"、"E'"）
点：
- {"id":"A","type":"point","x":0,"y":0}                      x、y 可以是表达式，如 "m"、"-(m-1)^2+4"
- {"id":"M","type":"midpoint","of":["B","C"]}
- {"id":"P","type":"onPath","path":["A","B","C"],"dist":"2*t","moving":true}   从 path[0] 出发沿折线走 dist 的路程
- {"id":"K","type":"ratio","from":"A","to":"B","ratio":"t/4"}  K = A + ratio·(B-A)
- {"id":"E","type":"intersection","lines":[["A","C"],["B","D"]]}   两直线交点
- {"id":"F","type":"foot","from":"P","line":["A","B"]}            垂足
- {"id":"Q","type":"rotate","of":"P","center":"A","angle":60}      绕 center 逆时针旋转（度，可为表达式）
- {"id":"R","type":"reflect","of":"P","line":["A","B"]}            关于直线的对称点
- {"id":"C","type":"polar","from":"A","angle":60,"length":6}       从 from 沿方向角（度）走 length
- {"id":"X","type":"lineCircle","line":["A","B"],"circle":"c1","index":0}  直线与圆的交点（index 0/1）
所有点可加："label"（显示名，默认等于 id）、"moving": true（动点，醒目显示）、"color"、"hidden"。

线和图形：
- {"id":"AB","type":"segment","from":"A","to":"B","label":"2t","dashed":false}   label 可含 {表达式}
- {"id":"l1","type":"line","through":["A","B"]}        直线
- {"id":"r1","type":"ray","from":"A","through":"B"}    射线
- {"id":"tri","type":"polygon","points":["P","B","C"],"fill":true}   fill 为半透明填充，用来强调某个三角形/面积
- {"id":"c1","type":"circle","center":"O","radius":3}  或 "through":"A"
- {"id":"angB","type":"angle","points":["A","B","C"],"right":true,"label":"60°"}  角标记，points[1] 是顶点；right 为直角符号
- {"id":"f","type":"function","expr":"x^2-2*x","xmin":-1,"xmax":3,"label":"y=x²-2x"}  函数图象，自变量用 x，可用参数
- {"id":"txt","type":"text","at":"P","text":"S={area(A,P,D)}"}   at 为点名或 [x,y]
- {"id":"tr","type":"trace","point":"P","param":"t"}   动点轨迹

颜色只能用：blue red green orange purple gray black。动点用 red，辅助线用 dashed。

## 表达式
支持 + - * / ^ ( )，比较 == != < > <= >=（== 自动带误差容忍），&& ||，
函数 sqrt abs min max sin cos tan（角度制）asin acos atan round，
几何函数 dist(A,B) 距离、angle(A,B,C) 角度（B 为顶点，单位度）、area(A,B,C,...) 多边形面积、x(A) y(A) 坐标、slope(A,B) 斜率，常量 pi。
表达式里只能用参数名和点名，不能用未定义的变量。

## 步骤 steps
每一步：
{
  "say": "朗读稿",         // 口语化，像老师说话。不要出现 $ 和 LaTeX，公式写成读法："AP等于2t"、"8减2t"、"根号2"、"x的平方"
  "text": "屏幕文字",       // Markdown + LaTeX（$...$），简洁，是这一步的要点
  "actions": [...]
}
动作：
- {"do":"show","ids":["PC","tri"]}        显示对象（对象定义时 hidden:true，讲到时再 show，这样图会一步步画出来）
- {"do":"hide","ids":["PC"]}
- {"do":"highlight","ids":["PB","BC"]}    本步高亮（其余对象变淡），用来指出"这一步在说哪条线"
- {"do":"set","param":"t","value":1}      立刻把参数设为某值
- {"do":"animate","param":"t","to":1,"from":0,"duration":2}   参数平滑变化，duration 秒（from 可省略，从当前值开始）
set/animate 的值必须在参数的 min~max 范围内。

## 验算 checks（必须有，至少 1 条，最好覆盖每个结论）
{"expr":"dist(P,B) == dist(B,C)","at":{"t":1},"note":"t=1 时 PB=BC"}
程序会把参数设为 at，计算 expr，不成立就说明剧本或解答有错。把解答里的每个关键结论（求出的 t 值、长度、面积、角度、相等关系）都写成验算。

## 讲解要求
- 6~12 步。第一步介绍题目和图形（动点题先 animate 一遍，让学生看到点怎么动）。
- 动点题：每种情况都要 animate 到对应的参数值，并 highlight 相关线段，让学生"看到"为什么。被舍去的情况也要演示，说明为什么舍去。
- 辅助线：讲到时再 show，并在 say 里说明为什么这样作。
- 最后一步给出答案。
- 与给定的解答保持一致；如果你发现解答有错，按正确的来，并在对应步骤的 say 里说明。
`.trim();

export function sceneSystemPrompt(): string {
  const example = JSON.stringify(rectangleMovingPoint);
  const example2 = JSON.stringify(pathArea);
  return `${FORMAT}

## 示例 1（动点 + 分类讨论）
${example}

## 示例 2（沿折线运动 + 分段函数）
${example2}

只输出 JSON，不要输出任何其他文字。`;
}

export function sceneUserPrompt(question: string, solution: string): string {
  return `## 题目
${question || '（题目在图片中）'}

## 已有的解答
${solution}

请输出这道题的讲解剧本 JSON。`;
}

export function sceneFixPrompt(errors: string[]): string {
  return `你输出的剧本有以下问题，请修正后重新输出完整的 JSON（只输出 JSON）：
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

提示：如果是"验算失败"，先检查坐标是否让题目条件精确成立、参数值是否算对；如果确认解答的结论本身有误，按正确的结论修改讲解。`;
}

/** 从模型输出里取出 JSON（容忍 \`\`\`json 包裹和前后多余文字）。 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('输出不是合法的 JSON');
  }
}
