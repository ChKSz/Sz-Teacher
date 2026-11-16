import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { ServerConfig } from './config.ts';
import type { Db } from './db.ts';
import * as auth from './auth.ts';
import * as store from './store.ts';
import { applyUpdate, loadSettings, saveProviderModels, toPublic, updateSettings } from './settings.ts';
import { SpeechCache } from './speechCache.ts';
import { chat, listModels, streamChat, LlmError, type ChatMessage, type ContentPart } from './llm.ts';
import { solveSystemPrompt } from './prompts.ts';
import { generateScene } from './sceneGen.ts';
import { UploadStore, mimeOf, MAX_IMAGES_PER_MESSAGE } from './uploads.ts';
import type { AuthStatus, ChatEvent, ConversationUpdate, Message, ProviderTestResult, SceneEvent, SettingsUpdate } from '../shared/types.ts';

export const SESSION_COOKIE = 'sz_session';
const MAX_TEXT_CHARS = 20_000;
/** 发给模型的历史消息上限，避免超长对话撑爆上下文。 */
const HISTORY_LIMIT = 30;

export interface AppDeps {
  config: ServerConfig;
  db: Db;
  uploads: UploadStore;
  limiter?: auth.LoginLimiter;
}

class HttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429;
  constructor(status: HttpError['status'], message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, '请求内容不是合法的 JSON');
  }
}

export function createApp({ config, db, uploads, limiter = new auth.LoginLimiter() }: AppDeps): Hono {
  const app = new Hono();
  const speechCache = new SpeechCache(config.dataDir);
  db.prepare("UPDATE scene_jobs SET status = 'error', message = '服务器重启，生成已中断，请重试', updated_at = ? WHERE status = 'working'").run(Date.now());

  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      // X-Real-IP 由 Nginx 用 $remote_addr 覆盖设置，客户端无法伪造；
      // X-Forwarded-For 的前面几项可以被客户端随意填写，只能信任最后一项（由反向代理追加）。
      const real = c.req.header('x-real-ip')?.trim();
      if (real) return real;
      const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const issueSession = (c: Context): void => {
    const token = auth.createSession(db, c.req.header('user-agent') ?? '');
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.secureCookies,
      path: '/',
      maxAge: Math.floor(auth.SESSION_TTL_MS / 1000),
    });
  };

  const isAuthed = (c: Context): boolean => auth.isValidSession(db, getCookie(c, SESSION_COOKIE));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: '服务器内部错误' }, 500);
  });

  // 拒绝跨站的写请求（Cookie 已设 SameSite=Lax，这里再加一层）。
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin) {
        const host = (config.trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host');
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          // 非法 Origin 视为跨站
        }
        if (!host || originHost !== host) return c.json({ error: '拒绝跨站请求' }, 403);
      }
    }
    await next();
  });

  // ---------- 登录 ----------

  app.get('/api/auth/status', (c) => {
    const status: AuthStatus = { initialized: auth.getPasswordHash(db) !== null, authenticated: isAuthed(c) };
    return c.json(status);
  });

  // 登录相关接口的请求体很小，限制大小防止未登录的大请求占用内存
  const smallBody = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: '请求太大' }, 413) });
  app.use('/api/auth/*', smallBody);

  app.post('/api/auth/setup', async (c) => {
    const body = await readJson<{ password?: unknown }>(c);
    let password: string;
    try {
      password = auth.validateNewPassword(body.password);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    if (auth.getPasswordHash(db) !== null) throw new HttpError(409, '密码已经设置过了，请直接登录');
    const hash = await auth.hashPassword(password);
    if (!auth.setInitialPasswordHash(db, hash)) throw new HttpError(409, '密码已经设置过了，请直接登录');
    issueSession(c);
    return c.json({ ok: true });
  });

  app.post('/api/auth/login', async (c) => {
    const ip = clientIp(c);
    const lockedMs = limiter.lockedFor(ip);
    if (lockedMs > 0) {
      throw new HttpError(429, `密码错误次数太多，请 ${Math.ceil(lockedMs / 60_000)} 分钟后再试`);
    }
    // 在任何 await 之前先记一次尝试：并发发送大量请求时，超过上限的请求会直接被锁定
    limiter.recordFailure(ip);
    const body = await readJson<{ password?: unknown }>(c);
    const stored = auth.getPasswordHash(db);
    if (stored === null) throw new HttpError(409, '还没有设置密码');
    const ok = typeof body.password === 'string' && (await auth.verifyPassword(body.password, stored));
    if (!ok) throw new HttpError(401, '密码不正确');
    limiter.recordSuccess(ip);
    auth.purgeExpiredSessions(db);
    issueSession(c);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) auth.deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // 以下接口都需要登录。
  app.use('/api/*', async (c, next) => {
    if (!isAuthed(c)) return c.json({ error: '请先登录' }, 401);
    await next();
  });

  app.post('/api/auth/password', async (c) => {
    const body = await readJson<{ current?: unknown; next?: unknown }>(c);
    const stored = auth.getPasswordHash(db);
    if (!stored || typeof body.current !== 'string' || !(await auth.verifyPassword(body.current, stored))) {
      throw new HttpError(400, '当前密码不正确');
    }
    let next: string;
    try {
      next = auth.validateNewPassword(body.next);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    auth.setPasswordHash(db, await auth.hashPassword(next));
    auth.deleteAllSessions(db);
    issueSession(c);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout-all', (c) => {
    auth.deleteAllSessions(db);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---------- 设置 ----------

  app.get('/api/settings', (c) => c.json(toPublic(loadSettings(db, config))));

  app.put('/api/settings', async (c) => {
    const update = await readJson<SettingsUpdate>(c);
    try {
      return c.json(toPublic(updateSettings(db, config, update)));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post('/api/settings/models', async (c) => {
    const body = await readJson<{ baseUrl?: string; apiKey?: string }>(c);
    const saved = loadSettings(db, config);
    let candidate;
    try {
      candidate = applyUpdate(saved, { provider: { baseUrl: body.baseUrl, ...(body.apiKey?.trim() ? { apiKey: body.apiKey } : {}) } });
    } catch (err) { throw new HttpError(400, (err as Error).message); }
    if (candidate.provider.baseUrl !== saved.provider.baseUrl && !body.apiKey?.trim()) throw new HttpError(400, '更换接口地址后，请同时填写密钥再获取模型列表');
    try {
      const models = [...new Set(await listModels(candidate.provider))].filter(Boolean).slice(0, 1000);
      if (!models.length) throw new Error('供应商未返回可用模型，请检查接口地址');
      // 请求期间可能修改了其他设置，只更新此供应商和模型列表。
      const latest = loadSettings(db, config);
      return c.json(toPublic(saveProviderModels(db, { ...latest, provider: candidate.provider }, models)));
    } catch (err) { throw new HttpError(400, (err as Error).message); }
  });

  app.post('/api/tts/prepare', bodyLimit({ maxSize: 512_000, onError: (c) => c.json({ error: '朗读内容过长' }, 413) }), async (c) => {
    const body = await readJson<{ texts?: unknown }>(c);
    if (!Array.isArray(body.texts) || !body.texts.length || body.texts.length > 80 || body.texts.some((text) => typeof text !== 'string' || text.length > 20_000)) throw new HttpError(400, '请提交 1～80 段讲解，每段最多 20000 字');
    const texts = (body.texts as string[]).map((text) => text.trim());
    if (!texts.some(Boolean) || texts.join('').length > 120_000) throw new HttpError(400, '朗读内容为空或过长');
    const settings = loadSettings(db, config);
    if (settings.tts.provider !== 'xiaomi') throw new HttpError(400, '请先在设置中选择小米语音');
    if (!settings.tts.apiKey) throw new HttpError(400, '请先在设置中填写小米语音密钥');
    return c.json(speechCache.prepare(settings.tts, texts));
  });

  app.get('/api/tts/jobs/:id', (c) => {
    const job = speechCache.status(c.req.param('id'));
    if (!job) throw new HttpError(404, '语音准备任务已过期，请重试');
    c.header('Cache-Control', 'no-store');
    return c.json(job);
  });

  app.get('/api/tts/audio/:id', async (c) => {
    const audio = await speechCache.read(c.req.param('id'));
    if (!audio) throw new HttpError(404, '语音缓存已过期，请重新准备');
    return c.body(new Uint8Array(audio), 200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store' });
  });

  app.post('/api/tts', bodyLimit({ maxSize: 100_000, onError: (c) => c.json({ error: '朗读内容过长' }, 413) }), async (c) => {
    const body = await readJson<{ text?: unknown }>(c);
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20_000) throw new HttpError(400, '每段朗读内容须为 1～20000 个字符');
    const settings = loadSettings(db, config);
    if (settings.tts.provider !== 'xiaomi') throw new HttpError(400, '请先在设置中选择小米语音');
    try {
      const id = await speechCache.ensure(settings.tts, body.text.trim());
      const audio = await speechCache.read(id);
      if (!audio) throw new Error('语音缓存写入失败，请重试');
      return c.body(new Uint8Array(audio), 200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
    } catch (err) { throw new HttpError(400, (err as Error).message); }
  });

  /** 测试连接：可以传入尚未保存的 baseUrl / apiKey；apiKey 留空则用已保存的。 */
  app.post('/api/settings/test', async (c) => {
    const body = await readJson<{ baseUrl?: string; apiKey?: string; model?: string }>(c);
    const saved = loadSettings(db, config);
    const baseUrl = (body.baseUrl ?? saved.provider.baseUrl).trim().replace(/\/+$/, '');
    const newKey = body.apiKey?.trim() ?? '';
    // 已保存的密钥只能发往已保存的地址，防止通过"测试连接"把密钥发到别处
    if (!newKey && baseUrl !== saved.provider.baseUrl) {
      return c.json({ ok: false, message: '更换了 Base URL，请同时填写 API Key 再测试' } satisfies ProviderTestResult);
    }
    const provider = { baseUrl, apiKey: newKey || saved.provider.apiKey };
    const model = body.model?.trim() || saved.solveModel;
    const result: ProviderTestResult = { ok: false, message: '' };
    try {
      result.models = await listModels(provider).catch(() => undefined);
      const startedAt = Date.now();
      const reply = await chat(provider, {
        model,
        messages: [{ role: 'user', content: '只回复两个字：你好' }],
        timeoutMs: 60_000,
      });
      result.ok = true;
      result.message = `连接成功：模型 ${model} 用时 ${Date.now() - startedAt} ms，回复"${reply.trim().slice(0, 20)}"`;
    } catch (err) {
      result.message = err instanceof LlmError ? err.message : `测试失败：${(err as Error).message}`;
    }
    return c.json(result);
  });

  // ---------- 会话 ----------

  app.get('/api/conversations', (c) => c.json(store.listConversations(db)));

  app.get('/api/conversations/:id', (c) => {
    const conversation = store.getConversation(db, c.req.param('id'));
    if (!conversation) throw new HttpError(404, '会话不存在');
    return c.json(conversation);
  });

  app.patch('/api/conversations/:id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c);
    const patch: ConversationUpdate = {};
    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
      if (!title) throw new HttpError(400, '标题不能为空');
      patch.title = title;
    }
    if (body.starred !== undefined) {
      if (typeof body.starred !== 'boolean') throw new HttpError(400, 'starred 必须是 true 或 false');
      patch.starred = body.starred;
    }
    if (body.note !== undefined) {
      if (typeof body.note !== 'string') throw new HttpError(400, '笔记必须是文字');
      patch.note = body.note.slice(0, 5000);
    }
    for (const key of ['knowledgePoint', 'errorReason'] as const) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string') throw new HttpError(400, '知识点和错因必须是文字');
        patch[key] = body[key].trim().slice(0, 100);
      }
    }
    if (body.reviewStatus !== undefined) {
      if (body.reviewStatus !== 'pending' && body.reviewStatus !== 'mastered') throw new HttpError(400, '复习状态不正确');
      patch.reviewStatus = body.reviewStatus;
    }
    if (!store.updateConversation(db, c.req.param('id'), patch)) throw new HttpError(404, '会话不存在');
    return c.json({ ok: true });
  });

  app.delete('/api/conversations/:id', (c) => {
    const images = store.deleteConversation(db, c.req.param('id'));
    if (images === null) throw new HttpError(404, '会话不存在');
    uploads.remove(images);
    return c.json({ ok: true });
  });

  app.get('/api/uploads/:name', (c) => {
    const name = c.req.param('name');
    const file = uploads.resolve(name);
    const mime = mimeOf(name);
    if (!file || !mime) throw new HttpError(404, '图片不存在');
    return c.body(fs.readFileSync(file), 200, {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  /**
   * 发送一条消息并流式返回回答。
   * 请求：{ conversationId?: string, text: string, images?: string[]（data URL） }
   * 响应：SSE，事件见 ChatEvent。
   */
  app.post(
    '/api/chat',
    bodyLimit({
      maxSize: 40 * 1024 * 1024,
      onError: (c) => c.json({ error: '请求太大（图片过多或过大）' }, 413),
    }),
    async (c) => {
      const body = await readJson<{ conversationId?: unknown; text?: unknown; images?: unknown; retryMessageId?: unknown }>(c);
      let text = typeof body.text === 'string' ? body.text.trim() : '';
      const rawImages = Array.isArray(body.images) ? body.images : [];
      const retryId = typeof body.retryMessageId === 'string' ? body.retryMessageId : '';
      if (!retryId && !text && rawImages.length === 0) throw new HttpError(400, '请输入题目或上传图片');
      if (text.length > MAX_TEXT_CHARS) throw new HttpError(400, '文字太长');
      if (rawImages.length > MAX_IMAGES_PER_MESSAGE) {
        throw new HttpError(400, `一次最多上传 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
      }

      let conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
      let title = '';
      let retryHistory: Message[] | undefined;
      let original: Message | undefined;
      if (conversationId) {
        const existing = store.getConversation(db, conversationId);
        if (!existing) throw new HttpError(404, '会话不存在');
        title = existing.title;
        if (retryId) {
          const index = existing.messages.findIndex((message) => message.id === retryId && message.role === 'user');
          if (index < 0) throw new HttpError(404, '找不到要重试的原问题');
          original = existing.messages[index]!;
          text = original.content;
          retryHistory = existing.messages.slice(0, index + 1);
          if (original.images.some((name) => !uploads.resolve(name))) throw new HttpError(400, '原题图片已丢失，请重新上传');
        }
      }
      if (retryId && !original) throw new HttpError(400, '重试时需要指定原会话');

      const savedImages: string[] = original ? [...original.images] : [];
      try {
        if (!original) for (const image of rawImages) savedImages.push(uploads.saveDataUrl(image));
      } catch (err) {
        uploads.remove(savedImages);
        throw new HttpError(400, (err as Error).message);
      }

      if (!conversationId) {
        title = store.titleFrom(text, savedImages.length > 0);
        conversationId = store.createConversation(db, title).id;
      }
      const userMessage = store.addMessage(db, conversationId, {
        role: 'user',
        content: text,
        images: savedImages,
        status: 'done',
      });

      const settings = loadSettings(db, config);
      // 重试按原问题当时的上下文重新请求，新结果追加保存，避免混入后续追问。
      const history = retryHistory ?? store.getConversation(db, conversationId)!.messages;
      const messages = buildModelMessages(history, settings.teachingStyle, uploads);
      const assistantMessageId = store.newId();
      const finalConversationId = conversationId;

      return streamSSE(c, async (stream) => {
        const send = (event: ChatEvent) => stream.writeSSE({ data: JSON.stringify(event) });
        const abort = new AbortController();
        stream.onAbort(() => abort.abort());

        await send({ type: 'start', conversationId: finalConversationId, userMessage, assistantMessageId });

        let answer = '';
        let failure = '';
        try {
          for await (const piece of streamChat(settings.provider, {
            model: settings.solveModel,
            messages,
            reasoningEffort: settings.reasoningEffort || undefined,
            signal: abort.signal,
          })) {
            answer += piece;
            if (!stream.aborted) await send({ type: 'delta', text: piece });
          }
          if (!answer.trim()) failure = '模型没有返回任何内容';
        } catch (err) {
          failure = err instanceof LlmError ? err.message : `生成失败：${(err as Error).message}`;
          if (!(err instanceof LlmError)) console.error(err);
        }

        // 学生中途关掉页面时，已经生成的部分仍然保存下来。
        if (stream.aborted && !failure) failure = '生成被中断';
        if (!failure && history[0]?.images.length && !history[0]?.content) {
          const generatedTitle = store.titleFromAnswer(answer);
          // 尊重用户手动改过的标题。
          if (generatedTitle && store.getConversation(db, finalConversationId)?.title === '图片题目') {
            store.updateConversation(db, finalConversationId, { title: generatedTitle });
            title = generatedTitle;
          }
        }
        const content = failure ? (answer ? `${answer}\n\n> ⚠️ ${failure}` : failure) : answer;
        let saved: Message;
        try {
          saved = store.addMessage(db, finalConversationId, {
            id: assistantMessageId,
            role: 'assistant',
            content,
            images: [],
            status: failure ? 'error' : 'done',
          });
        } catch (err) {
          // 生成过程中会话被删除了
          console.error(err);
          if (!stream.aborted) await send({ type: 'error', message: '保存回答失败：这道题可能已被删除' });
          return;
        }
        if (!stream.aborted) {
          if (failure) await send({ type: 'error', message: failure });
          await send({ type: 'done', message: saved, title });
        }
      });
    },
  );

  /**
   * 为某条回答生成动画讲解剧本。
   * 请求：POST /api/messages/:id/scene
   * 响应：SSE，事件见 SceneEvent。剧本生成通常需要 30~90 秒。
   */
  const generating = new Set<string>();
  app.get('/api/messages/:id/scene', (c) => {
    const message = store.getMessage(db, c.req.param('id'));
    if (!message || message.role !== 'assistant') throw new HttpError(404, '回答不存在');
    const detail = store.getConversation(db, message.conversationId)!;
    return c.json({ job: store.getSceneJob(db, message.id) ?? null, record: detail.messages.find((m) => m.id === message.id)?.scene ?? null });
  });
  app.post('/api/messages/:id/scene', async (c) => {
    const messageId = c.req.param('id');
    const message = store.getMessage(db, messageId);
    if (!message || message.role !== 'assistant') throw new HttpError(404, '回答不存在');
    if (message.status !== 'done') throw new HttpError(400, '这条回答没有成功生成，不能制作讲解');
    if (generating.has(messageId)) throw new HttpError(409, '这道题的讲解正在生成中');

    // 找到这条回答对应的提问（它之前最近的一条用户消息），以及最初的题目
    const history = store.getConversation(db, message.conversationId)!.messages;
    const index = history.findIndex((m) => m.id === messageId);
    const users = history.slice(0, index).filter((m) => m.role === 'user');
    const first = users[0];
    const question = [first?.content ?? '', users.length > 1 ? `（追问：${users.at(-1)!.content}）` : '']
      .filter(Boolean)
      .join('\n');
    const images = (first?.images ?? []).map((n) => uploads.toDataUrl(n)).filter((u): u is string => u !== null);
    const settings = loadSettings(db, config);

    generating.add(messageId);
    store.setSceneJob(db, messageId, 'working', '正在设计动画讲解…');
    return streamSSE(c, async (stream) => {
      const send = (event: SceneEvent) => stream.writeSSE({ data: JSON.stringify(event) });
      // 学生关掉页面也继续生成，生成好后保存，下次打开就能看
      const keepAlive = setInterval(() => {
        if (!stream.aborted) void stream.writeSSE({ event: 'ping', data: '' }).catch(() => {});
      }, 15_000);
      try {
        const result = await generateScene({
          provider: settings.provider,
          model: settings.sceneModel || settings.solveModel,
          reasoningEffort: settings.reasoningEffort || undefined,
          question,
          images,
          solution: message.content,
          onProgress: (text) => {
            if (store.getMessage(db, messageId)) store.setSceneJob(db, messageId, 'working', text);
            if (!stream.aborted) void send({ type: 'progress', message: text }).catch(() => {});
          },
        });
        if (!result.scene) {
          const reason = `这道题暂时做不出动画讲解（${result.problems.slice(0, 2).join('；') || '模型输出无法使用'}）`;
          if (store.getMessage(db, messageId)) store.setSceneJob(db, messageId, 'error', reason);
          if (!stream.aborted) {
            await send({ type: 'error', message: reason });
          }
          return;
        }
        const record = store.saveScene(db, messageId, result.scene, result.verified, result.problems);
        store.setSceneJob(db, messageId, 'done', '动画讲解已完成');
        if (!stream.aborted) await send({ type: 'done', record });
      } catch (err) {
        if (!(err instanceof LlmError)) console.error(err);
        const reason = err instanceof LlmError ? err.message : '生成讲解失败';
        if (store.getMessage(db, messageId)) store.setSceneJob(db, messageId, 'error', reason);
        if (!stream.aborted) await send({ type: 'error', message: reason });
      } finally {
        clearInterval(keepAlive);
        generating.delete(messageId);
      }
    });
  });

  app.all('/api/*', (c) => c.json({ error: '接口不存在' }, 404));

  // ---------- 前端页面 ----------

  if (fs.existsSync(config.webDir)) {
    const root = path.relative(process.cwd(), config.webDir) || '.';
    app.use('/*', serveStatic({ root }));
    const indexFile = path.join(config.webDir, 'index.html');
    app.get('*', (c) => {
      if (!fs.existsSync(indexFile)) return c.text('前端尚未构建', 404);
      return c.html(fs.readFileSync(indexFile, 'utf8'));
    });
  } else {
    app.get('/', (c) => c.text('前端尚未构建：请先运行 npm run build，开发时请访问 http://localhost:5173'));
  }

  return app;
}

/** 把数据库里的对话历史转换成发给模型的消息。 */
export function buildModelMessages(
  history: Message[],
  style: Parameters<typeof solveSystemPrompt>[0],
  uploads: UploadStore,
): ChatMessage[] {
  const recent = history.filter((m) => m.status === 'done' || m.role === 'user').slice(-HISTORY_LIMIT);
  const imageTitle = history[0]?.images.length && !history[0]?.content
    ? '\n请在第一次解答的开头用“### 题目：简短标题”概括图片中的题目，标题不超过24字，包含知识点或关键条件，随后正常讲解。'
    : '';
  const messages: ChatMessage[] = [{ role: 'system', content: solveSystemPrompt(style) + imageTitle }];
  for (const m of recent) {
    if (m.role === 'assistant') {
      messages.push({ role: 'assistant', content: m.content });
      continue;
    }
    const parts: ContentPart[] = [];
    for (const name of m.images) {
      const url = uploads.toDataUrl(name);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
    const text = m.content || (parts.length ? '请解答图片中的题目。' : '');
    if (parts.length === 0) {
      messages.push({ role: 'user', content: text });
    } else {
      messages.push({ role: 'user', content: [{ type: 'text', text }, ...parts] });
    }
  }
  return messages;
}
