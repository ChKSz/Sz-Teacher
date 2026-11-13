import type {
  AuthStatus,
  ChatEvent,
  ConversationDetail,
  ConversationSummary,
  ProviderTestResult,
  PublicSettings,
  SceneEvent,
  SettingsUpdate,
} from '../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 收到 401 时通知应用回到登录页。 */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络');
  }
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // 保持默认提示
    }
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (password: string) => request('/api/auth/setup', { method: 'POST', json: { password } }),
  login: (password: string) => request('/api/auth/login', { method: 'POST', json: { password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => request('/api/auth/logout-all', { method: 'POST' }),
  changePassword: (current: string, next: string) =>
    request('/api/auth/password', { method: 'POST', json: { current, next } }),

  settings: () => request<PublicSettings>('/api/settings'),
  saveSettings: (update: SettingsUpdate) => request<PublicSettings>('/api/settings', { method: 'PUT', json: update }),
  testProvider: (input: { baseUrl?: string; apiKey?: string; model?: string }) =>
    request<ProviderTestResult>('/api/settings/test', { method: 'POST', json: input }),

  conversations: () => request<ConversationSummary[]>('/api/conversations'),
  conversation: (id: string) => request<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`),
  renameConversation: (id: string, title: string) =>
    request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', json: { title } }),
  deleteConversation: (id: string) =>
    request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** 读取 SSE 响应，逐个回调事件。 */
async function readSse<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        if (lines.some((line) => line.startsWith('event:'))) continue; // 心跳等非数据事件
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) onEvent(JSON.parse(data) as T);
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    throw new ApiError(0, '连接中断，回答可能不完整，刷新后可查看已保存的内容');
  }
}

async function postSse<T>(path: string, body: unknown, onEvent: (event: T) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    throw new ApiError(0, '网络连接失败，请检查网络');
  }
  if (!res.ok || !res.body) {
    let message = `请求失败（${res.status}）`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // 保持默认提示
    }
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, message);
  }
  await readSse(res, onEvent);
}

/** 为一条回答生成动画讲解。 */
export function generateScene(messageId: string, onEvent: (event: SceneEvent) => void, signal?: AbortSignal): Promise<void> {
  return postSse(`/api/messages/${encodeURIComponent(messageId)}/scene`, {}, onEvent, signal);
}

/** 发送消息，逐个回调 SSE 事件。 */
export function sendChat(
  input: { conversationId?: string; text: string; images: string[] },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postSse('/api/chat', input, onEvent, signal);
}

/** 压缩图片：长边不超过 maxSide，转成 JPEG data URL。题目照片这样处理后通常只有几百 KB。 */
export async function compressImage(file: File, maxSide = 2000, quality = 0.88): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
