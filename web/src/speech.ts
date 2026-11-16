// 正文、动画与试听共用的朗读入口，支持小米 MiMo 和浏览器声音。
import type { SpeechOptions, SpeechJob } from '../../shared/types.ts';

export function speechSupported(options?: Pick<SpeechOptions, 'provider'>): boolean {
  return typeof window !== 'undefined' && (options?.provider === 'xiaomi' ? 'Audio' in window : 'speechSynthesis' in window);
}

/** 返回中文声音列表；部分浏览器需要等 voiceschanged 事件后才有数据。 */
export function chineseVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const pick = () => window.speechSynthesis.getVoices().filter((v) => /^zh/i.test(v.lang));
  const now = pick();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(pick());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** 优先选用更自然的声音（Edge 的 Online/Natural 声音）。 */
function chooseVoice(voices: SpeechSynthesisVoice[], preferred: string): SpeechSynthesisVoice | undefined {
  if (preferred) {
    const exact = voices.find((v) => v.voiceURI === preferred || v.name === preferred);
    if (exact) return exact;
  }
  const mainland = voices.filter((v) => /zh[-_]CN/i.test(v.lang));
  const pool = mainland.length ? mainland : voices;
  return pool.find((v) => /Natural|Online/i.test(v.name)) ?? pool[0];
}

/** 把长文本切成句子，避免部分浏览器朗读长文本时中途停止。 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => s.match(/[\s\S]{1,180}/gu) ?? []);
}

export interface SpeakHandle {
  stop: () => void;
  finished: Promise<void>;
}

let activeSpeech: AbortController | undefined;

/** 全应用同时只保留一段朗读，切换来源也会结束旧朗读和等待。 */
export async function speak(text: string, options: SpeechOptions, signal?: AbortSignal, clip?: PreparedSpeech | null): Promise<SpeakHandle> {
  activeSpeech?.abort();
  const abort = new AbortController();
  activeSpeech = abort;
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const clear = () => { if (activeSpeech === abort) activeSpeech = undefined; };
  try {
    const handle = options.provider === 'xiaomi' ? playPreparedSpeech(clip, options.rate, combined) : await speakBrowser(text, options, combined);
    return { stop: () => abort.abort(), finished: handle.finished.finally(clear) };
  } catch (err) { clear(); throw err; }
}

async function speakBrowser(text: string, options: SpeechOptions, signal?: AbortSignal): Promise<SpeakHandle> {
  if (!speechSupported()) throw new Error('这个浏览器不支持朗读');
  if (signal?.aborted) return { stop: () => {}, finished: Promise.resolve() };
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = chooseVoice(await chineseVoices(), options.voice);
  // 等待设备加载声音时也可能暂停或切换了步骤，此时不能开始旧朗读。
  if (signal?.aborted) return { stop: () => {}, finished: Promise.resolve() };
  let stopped = false;
  let finishSentence: (() => void) | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    synth.cancel();
    finishSentence?.();
  };
  signal?.addEventListener('abort', stop, { once: true });
  const finished = (async () => {
    for (const sentence of splitSentences(text)) {
      if (stopped) return;
      await new Promise<void>((resolve) => {
        finishSentence = resolve;
        const u = new SpeechSynthesisUtterance(sentence);
        u.lang = voice?.lang ?? 'zh-CN';
        if (voice) u.voice = voice;
        u.rate = options.rate;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        synth.speak(u);
      });
    }
  })().finally(() => { stopped = true; signal?.removeEventListener('abort', stop); });
  return {
    stop,
    finished,
  };
}

export interface PreparedSpeech { url: string; dispose: () => void }

async function jsonResponse<T>(url: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '语音准备失败，请重试');
  return data as T;
}

/** 一次提交全文或所有步骤，服务端全部备好后下载完整音频，播放时不再调用合成接口。 */
export async function prepareSpeech(texts: string[], signal?: AbortSignal, onProgress?: (completed: number, total: number) => void): Promise<(PreparedSpeech | null)[]> {
  let job = await jsonResponse<SpeechJob>('/api/tts/prepare', signal, { texts });
  const deadline = Date.now() + 20 * 60 * 1000;
  while (job.status === 'preparing') {
    onProgress?.(job.completed, job.total);
    if (Date.now() > deadline) throw new Error('语音准备时间较长，请稍后重试，已生成的部分会保留');
    await new Promise<void>((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, 600);
      if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
    });
    job = await jsonResponse<SpeechJob>('/api/tts/jobs/' + job.id, signal);
  }
  if (job.status === 'error') throw new Error(job.error || '语音准备失败，请重试');
  const clips: (PreparedSpeech | null)[] = [];
  try {
    // 下载并发由浏览器管理；等待所有结果后再开放播放，失败时统一释放对象地址。
    const results = await Promise.allSettled(job.clips.map(async (url, index) => {
      if (!url) { clips[index] = null; return; }
      const res = await fetch(url, { credentials: 'same-origin', signal });
      if (!res.ok) throw new Error('音频缓存不可用，请重试');
      const blob = await res.blob();
      if (!blob.size) throw new Error('返回的音频为空，请重试');
      const objectUrl = URL.createObjectURL(blob);
      clips[index] = { url: objectUrl, dispose: () => URL.revokeObjectURL(objectUrl) };
    }));
    const failed = results.find((item) => item.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    onProgress?.(job.total, job.total);
    return clips;
  } catch (err) { clips.forEach((clip) => clip?.dispose()); throw err; }
}

let player: HTMLAudioElement | undefined;
function getPlayer(): HTMLAudioElement {
  player ??= new Audio();
  player.preload = 'auto';
  player.preservesPitch = true;
  // 兼容旧版 Safari，与试听 HTML 的媒体播放路径一致。
  (player as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  return player;
}

/** 在直接点击时解锁同一个媒体元素，后续自动切换步骤也能继续播放。 */
export function unlockSpeech() {
  if (!speechSupported({ provider: 'xiaomi' }) || activeSpeech) return;
  const audio = getPlayer();
  const bytes = new Uint8Array(204);
  const data = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => { [...value].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); }); };
  write(0, 'RIFF'); data.setUint32(4, 196, true); write(8, 'WAVEfmt '); data.setUint32(16, 16, true);
  data.setUint16(20, 1, true); data.setUint16(22, 1, true); data.setUint32(24, 8000, true); data.setUint32(28, 16000, true);
  data.setUint16(32, 2, true); data.setUint16(34, 16, true); write(36, 'data'); data.setUint32(40, 160, true);
  audio.src = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...bytes));
  void audio.play().catch(() => {});
}

/** HTMLAudio 的保音调倍速不会像 AudioBufferSource 一样把声音拉尖。 */
function playPreparedSpeech(clip: PreparedSpeech | null | undefined, rate: number, signal: AbortSignal): SpeakHandle {
  if (!clip) throw new Error('音频尚未准备好，请稍等');
  if (signal.aborted) return { stop: () => {}, finished: Promise.resolve() };
  const audio = getPlayer();
  audio.pause();
  audio.src = clip.url;
  audio.currentTime = 0;
  audio.playbackRate = Math.max(0.5, Math.min(2, rate));
  let settled = false;
  let resolveFinished!: () => void;
  let rejectFinished!: (err: Error) => void;
  const finished = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
  const finish = (err?: Error) => {
    if (settled) return;
    settled = true;
    audio.pause();
    audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); signal.removeEventListener('abort', stop);
    if (err) rejectFinished(err); else resolveFinished();
  };
  const ended = () => finish();
  const failed = () => finish(new Error('音频播放失败，请重新准备语音'));
  const stop = () => finish();
  audio.addEventListener('ended', ended); audio.addEventListener('error', failed); signal.addEventListener('abort', stop, { once: true });
  void audio.play().catch(() => { if (!signal.aborted) finish(new Error('浏览器暂未允许播放，请再次点击播放')); });
  return { stop, finished };
}
