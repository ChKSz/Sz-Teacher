// OpenAI 兼容接口的最小客户端：对话（流式 / 非流式）与模型列表。

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  reasoningEffort?: string;
  responseFormat?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class LlmError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

function endpoint(provider: ProviderConfig, path: string): string {
  if (!provider.baseUrl) throw new LlmError('还没有配置供应商 Base URL，请到设置里填写');
  if (!provider.apiKey) throw new LlmError('还没有配置 API Key，请到设置里填写');
  return provider.baseUrl.replace(/\/+$/, '') + path;
}

function headers(provider: ProviderConfig): Record<string, string> {
  return { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** 把供应商的错误响应整理成一句中文说明，并去掉可能回显的密钥。 */
async function describeFailure(res: Response, provider: ProviderConfig): Promise<LlmError> {
  let detail = '';
  try {
    const raw = await res.text();
    try {
      const json = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
      const err = json.error;
      detail = (typeof err === 'string' ? err : err?.message) ?? json.message ?? raw;
    } catch {
      detail = raw;
    }
  } catch {
    // 忽略读取失败
  }
  if (provider.apiKey) detail = detail.split(provider.apiKey).join('***');
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  const prefix =
    res.status === 401 || res.status === 403
      ? 'API Key 无效或没有权限'
      : res.status === 404
        ? '接口或模型不存在'
        : res.status === 429
          ? '请求太频繁或额度不足'
          : res.status >= 500
            ? '供应商服务器出错'
            : '请求被拒绝';
  return new LlmError(`${prefix}（HTTP ${res.status}）${detail ? `：${detail}` : ''}`, res.status);
}

function networkError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.name === 'TimeoutError') return new LlmError('供应商响应超时');
  if (e.name === 'AbortError') return new LlmError('请求已取消');
  const cause = e.cause?.code ?? e.cause?.message ?? e.message ?? String(err);
  return new LlmError(`连接供应商失败：${cause}`);
}

/** 连接阶段失败（还没发出请求）时重试，供应商线路偶尔不稳定。 */
const RETRYABLE = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET']);

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 1; ; i += 1) {
    try {
      return await fetch(url, init);
    } catch (err) {
      const code = (err as { cause?: { code?: string } }).cause?.code;
      const aborted = init.signal?.aborted;
      if (i >= attempts || aborted || !code || !RETRYABLE.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 800 * i));
    }
  }
}

function requestBody(options: ChatOptions, stream: boolean): string {
  return JSON.stringify({
    model: options.model,
    messages: options.messages,
    stream,
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
  });
}

/** 非流式对话，返回回复文本。 */
export async function chat(provider: ProviderConfig, options: ChatOptions): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithRetry(endpoint(provider, '/chat/completions'), {
      method: 'POST',
      headers: headers(provider),
      body: requestBody(options, false),
      signal: combineSignals(options.signal, options.timeoutMs ?? 300_000),
    });
  } catch (err) {
    throw networkError(err);
  }
  if (!res.ok) throw await describeFailure(res, provider);
  let json: { choices?: { message?: { content?: unknown } }[] };
  try {
    json = (await res.json()) as typeof json;
  } catch (err) {
    throw networkError(err);
  }
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new LlmError('供应商返回的内容格式无法识别');
  return content;
}

/** 流式对话，逐段产出正文文本。 */
export async function* streamChat(provider: ProviderConfig, options: ChatOptions): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetchWithRetry(endpoint(provider, '/chat/completions'), {
      method: 'POST',
      headers: headers(provider),
      body: requestBody(options, true),
      signal: combineSignals(options.signal, options.timeoutMs ?? 600_000),
    });
  } catch (err) {
    throw networkError(err);
  }
  if (!res.ok) throw await describeFailure(res, provider);
  if (!res.body) throw new LlmError('供应商没有返回内容');

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // 有的供应商会忽略 stream 参数，直接返回完整结果。
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content) yield content;
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const text = parseSseLine(rawLine);
        if (text === DONE) return;
        if (text) yield text;
      }
    }
    const tail = parseSseLine(buffer + decoder.decode());
    if (tail && tail !== DONE) yield tail;
  } catch (err) {
    throw networkError(err);
  }
}

const DONE = Symbol('done');

/** 解析一行 SSE。返回正文片段、DONE 或 null（无内容）。供应商的错误事件会抛出。 */
export function parseSseLine(rawLine: string): string | typeof DONE | null {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return DONE;
  let json: { choices?: { delta?: { content?: unknown } }[]; error?: { message?: string } | string };
  try {
    json = JSON.parse(data) as typeof json;
  } catch {
    return null;
  }
  if (json.error) {
    const message = typeof json.error === 'string' ? json.error : (json.error.message ?? '未知错误');
    throw new LlmError(`供应商在生成过程中出错：${message}`);
  }
  const content = json.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content !== '' ? content : null;
}

export async function listModels(provider: ProviderConfig): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchWithRetry(endpoint(provider, '/models'), {
      headers: headers(provider),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw networkError(err);
  }
  if (!res.ok) throw await describeFailure(res, provider);
  const json = (await res.json()) as { data?: { id?: unknown }[] };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string')
    .sort();
}
