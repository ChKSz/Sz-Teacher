// 用真实模型生成一道题的讲解剧本，打印校验结果。
// 运行：node --env-file=.env scripts/try-scene.ts [题号]
import fs from 'node:fs';
import { chat } from '../server/llm.ts';
import { solveSystemPrompt } from '../server/prompts.ts';
import { generateScene } from '../server/sceneGen.ts';

const QUESTIONS = [
  '如图，在矩形ABCD中，AB=8，BC=6，点P从点A出发，沿AB以每秒2个单位的速度向点B运动，设运动时间为t秒（0≤t≤4）。当t为何值时，△PBC是等腰三角形？',
  '如图，在Rt△ABC中，∠C=90°，AC=6，BC=8。点P从点A出发沿AC向点C以每秒1个单位的速度运动，同时点Q从点C出发沿CB向点B以每秒2个单位的速度运动，当一个点到达终点时另一个点也停止运动。设运动时间为t秒。(1) 当t为何值时，△PCQ的面积为8？(2) 当t为何值时，PQ∥AB？',
  '如图，正方形ABCD的边长为4，E是BC的中点，连接AE，过点B作BF⊥AE于点F，求BF的长。',
  '已知抛物线y=x²-2x-3与x轴交于A、B两点（A在B左侧），与y轴交于点C。点P是直线BC下方抛物线上的一个动点，求△PBC面积的最大值及此时点P的坐标。',
];
const provider = { baseUrl: process.env.LLM_BASE_URL!, apiKey: process.env.LLM_API_KEY! };
const model = process.env.LLM_MODEL!;
const index = Number(process.argv[2] ?? 0);
const question = QUESTIONS[index]!;
let t0 = Date.now();
const solution = await chat(provider, { model, messages: [{ role: 'system', content: solveSystemPrompt('direct') }, { role: 'user', content: question }] });
console.log(`解答用时 ${Date.now() - t0} ms`);
t0 = Date.now();
const result = await generateScene({ provider, model, question, images: [], solution, onProgress: (m) => console.log('  ', m) });
console.log(`剧本用时 ${Date.now() - t0} ms，尝试 ${result.attempts} 次，验算${result.verified ? '通过' : '未通过'}`);
if (result.problems.length) console.log('问题：\n  ' + result.problems.join('\n  '));
if (result.warnings.length) console.log('提示：\n  ' + result.warnings.join('\n  '));
if (result.scene) {
  fs.mkdirSync('data/try', { recursive: true });
  fs.writeFileSync(`data/try/scene-${index}.json`, JSON.stringify(result.scene, null, 2));
  console.log(`步骤 ${result.scene.steps.length}，对象 ${result.scene.objects.length}，验算 ${result.scene.checks?.length ?? 0} 条 → data/try/scene-${index}.json`);
}
