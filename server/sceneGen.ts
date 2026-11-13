// 生成讲解剧本：模型写剧本 → 程序校验验算 → 有错就把错误发回去修正，最多重试几轮。
import { chat, LlmError, type ChatMessage, type ContentPart, type ProviderConfig } from './llm.ts';
import { extractJson, sceneFixPrompt, sceneSystemPrompt, sceneUserPrompt } from './scenePrompt.ts';
import { validateScene } from '../shared/scene/validate.ts';
import type { Scene } from '../shared/scene/types.ts';

export const MAX_ATTEMPTS = 3;

export interface SceneGenInput {
  provider: ProviderConfig;
  model: string;
  reasoningEffort?: string;
  question: string;
  /** 题目图片（data URL）。 */
  images: string[];
  solution: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface SceneGenResult {
  scene: Scene | null;
  /** 验算是否全部通过。 */
  verified: boolean;
  attempts: number;
  /** 最后一轮仍存在的问题。 */
  problems: string[];
  warnings: string[];
}

export async function generateScene(input: SceneGenInput): Promise<SceneGenResult> {
  const userContent: ContentPart[] = [{ type: 'text', text: sceneUserPrompt(input.question, input.solution) }];
  for (const url of input.images) userContent.push({ type: 'image_url', image_url: { url } });
  const messages: ChatMessage[] = [
    { role: 'system', content: sceneSystemPrompt() },
    { role: 'user', content: input.images.length ? userContent : sceneUserPrompt(input.question, input.solution) },
  ];

  /** 最好的候选：结构正确但验算未通过的剧本也可以先用。 */
  let fallback: { scene: Scene; problems: string[]; warnings: string[] } | null = null;
  let lastProblems: string[] = [];
  /** 供应商不支持 response_format 时，之后的每一轮都不再发送。 */
  let useJsonFormat = true;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    input.onProgress?.(attempt === 1 ? '正在设计动画讲解…' : `正在修正（第 ${attempt - 1} 次）…`);
    let reply: string;
    try {
      reply = await chat(input.provider, {
        model: input.model,
        messages,
        reasoningEffort: input.reasoningEffort || undefined,
        responseFormat: useJsonFormat ? { type: 'json_object' } : undefined,
        signal: input.signal,
        timeoutMs: 420_000,
      });
    } catch (err) {
      if (err instanceof LlmError && err.status === 400 && useJsonFormat) {
        // 个别模型不支持 response_format，去掉再试
        useJsonFormat = false;
        reply = await chat(input.provider, {
          model: input.model,
          messages,
          reasoningEffort: input.reasoningEffort || undefined,
          signal: input.signal,
          timeoutMs: 420_000,
        });
      } else {
        throw err;
      }
    }
    messages.push({ role: 'assistant', content: reply });

    let raw: unknown;
    try {
      raw = extractJson(reply);
    } catch (err) {
      lastProblems = [(err as Error).message];
      messages.push({ role: 'user', content: sceneFixPrompt(lastProblems) });
      continue;
    }
    const result = validateScene(raw);
    if (result.ok) {
      return { scene: raw as Scene, verified: true, attempts: attempt, problems: [], warnings: result.warnings };
    }
    if (result.errors.length === 0) {
      fallback = { scene: raw as Scene, problems: result.checkFailures, warnings: result.warnings };
    }
    lastProblems = [...result.errors, ...result.checkFailures];
    messages.push({ role: 'user', content: sceneFixPrompt(lastProblems.slice(0, 15)) });
  }

  if (fallback) {
    return { scene: fallback.scene, verified: false, attempts: MAX_ATTEMPTS, problems: fallback.problems, warnings: fallback.warnings };
  }
  return { scene: null, verified: false, attempts: MAX_ATTEMPTS, problems: lastProblems, warnings: [] };
}
