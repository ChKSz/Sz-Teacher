// 正文、动画与试听共用的朗读入口，支持小米 MiMo 和浏览器声音。
import type { SpeechOptions, SpeechJob } from '../../shared/types.ts';

export function speechSupported(options?: Pick<SpeechOptions, 'provider'>): boolean {
  return typeof window !== 'undefined' && (options?.provider === 'xiaomi' ? typeof window.Audio === 'function' : !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function');
}

/** 返回中文声音列表；部分浏览器需要等 voiceschanged 事件后才有数据。 */
export function chineseVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([]);
  const pick = () => window.speechSynthesis.getVoices().filter((v) => /^zh/i.test(v.lang));
  const now = pick();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(pick());
    };
    const timer = setTimeout(done, 1500);
    window.speechSynthesis.addEventListener('voiceschanged', done);
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
  /** Synchronous controls: call resume directly from a click on mobile. */
  pause: () => void;
  resume: () => void;
  finished: Promise<void>;
}

type SpeechPlayback = Omit<SpeakHandle, 'stop'>;
let activeSpeech: AbortController | undefined;
const endedSpeech = (): SpeakHandle => ({ stop() {}, pause() {}, resume() {}, finished: Promise.resolve() });

/** 全应用同时只保留一段朗读，切换来源也会结束旧朗读和等待。 */
export async function speak(text: string, options: SpeechOptions, signal?: AbortSignal, clip?: PreparedSpeech | null): Promise<SpeakHandle> {
  if (signal?.aborted) return endedSpeech();
  activeSpeech?.abort();
  const abort = new AbortController();
  activeSpeech = abort;
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  const current = () => activeSpeech === abort && !combined.aborted;
  const clear = () => { if (activeSpeech === abort) activeSpeech = undefined; };
  let requestedStop = false;
  try {
    const handle = options.provider === 'xiaomi' ? playPreparedSpeech(clip, options.rate, combined) : speakBrowser(text, options, combined);
    return {
      stop: () => { if (current()) { requestedStop = true; abort.abort(); } },
      pause: () => { if (current()) handle.pause(); },
      resume: () => { if (current()) handle.resume(); },
      finished: handle.finished.then(() => {
        if (signal && abort.signal.aborted && !requestedStop && !signal.aborted) throw new Error('朗读被另一段语音打断');
      }).finally(clear),
    };
  } catch (err) { clear(); throw err; }
}

function speakBrowser(text: string, options: SpeechOptions, signal: AbortSignal): SpeechPlayback {
  if (!speechSupported()) throw new Error('这个浏览器不支持朗读');
  const synth = window.speechSynthesis;
  synth.cancel();
  // Do not await voices here: Android may require speak() in the direct user click.
  // With no enumerated Chinese voice yet, let the OS choose by utterance language.
  const voice = chooseVoice(synth.getVoices().filter(v => /^zh/i.test(v.lang)), options.voice);
  const sentences = splitSentences(text);
  let nextIndex = 0;
  let paused = false;
  let nativePaused = false;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let current: { suspend: () => void; arm: () => void; dispose: () => void } | undefined;
  let resolveFinished!: () => void;
  let rejectFinished!: (err: Error) => void;
  const finished = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
  const clearResumeTimer = () => { clearTimeout(resumeTimer); resumeTimer = undefined; };

  function finish(error?: Error, cancel = false) {
    if (settled) return;
    settled = true;
    clearResumeTimer();
    current?.dispose();
    current = undefined;
    signal.removeEventListener('abort', stop);
    if (cancel) { try { synth.cancel(); } catch { /* already settling */ } }
    // Pausing belongs to the shared synth queue, not just this utterance. Clear
    // our pause while this handle still owns the queue so a new one can start.
    if (nativePaused) { try { if (synth.paused) synth.resume(); } catch { /* already settling */ } }
    if (error) rejectFinished(error); else resolveFinished();
  }
  function stop() { finish(undefined, true); }

  function next() {
    if (settled || paused || current) return;
    const sentence = sentences[nextIndex++];
    if (sentence === undefined) { finish(); return; }
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = voice?.lang ?? 'zh-CN';
    if (voice) u.voice = voice;
    u.rate = options.rate;
    let began = false;
    let remaining = 6000;
    let deadline = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const suspend = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, deadline - Date.now());
    };
    const arm = () => {
      if (paused || settled || current !== controls || timer !== undefined) return;
      deadline = Date.now() + remaining;
      timer = setTimeout(() => finish(new Error(began ? '浏览器朗读没有正常结束，请重试' : '浏览器未开始朗读，请确认系统已安装中文语音'), true), remaining);
    };
    const dispose = () => {
      suspend();
      u.onstart = u.onend = u.onerror = null;
    };
    const controls = { suspend, arm, dispose };
    current = controls;
    u.onstart = () => {
      if (current !== controls) return;
      began = true;
      clearResumeTimer();
      suspend();
      remaining = 120_000;
      arm();
    };
    u.onend = () => {
      if (current !== controls) return;
      clearResumeTimer();
      if (!began) { finish(new Error('设备未实际开始朗读，请检查系统语音')); return; }
      dispose();
      current = undefined;
      if (nextIndex >= sentences.length) finish();
      else queueMicrotask(advance); // pause can gate the next sentence without replaying this one
    };
    u.onerror = (event) => {
      if (current !== controls) return;
      finish(new Error(
        event.error === 'not-allowed' ? '浏览器阻止了朗读，请再次点击开始讲解'
          : event.error === 'language-unavailable' || event.error === 'voice-unavailable' ? '设备没有可用的中文语音，请安装中文语音或切换语音服务'
            : '浏览器朗读失败，请检查系统中文语音或切换语音服务',
      ));
    };
    arm();
    try { synth.speak(u); } catch { finish(new Error('无法启动浏览器朗读')); }
  }

  function advance() {
    try { next(); } catch { finish(new Error('无法启动浏览器朗读'), true); }
  }
  signal.addEventListener('abort', stop, { once: true });
  advance();
  return {
    pause() {
      if (settled || paused) return;
      paused = true;
      clearResumeTimer();
      current?.suspend();
      if (!current) return;
      try { nativePaused = true; synth.pause(); }
      catch { finish(new Error('无法暂停浏览器朗读'), true); }
    },
    resume() {
      if (settled || !paused) return;
      paused = false;
      try {
        if (nativePaused) {
          synth.resume();
          if (current && synth.paused) {
            resumeTimer = setTimeout(() => {
              if (synth.paused) finish(new Error('无法继续浏览器朗读，请重试'), true);
              else nativePaused = false;
            }, 4000);
          } else nativePaused = false;
        }
        if (current) current.arm(); else next();
      } catch { finish(new Error('无法继续浏览器朗读，请重试'), true); }
    },
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
function playPreparedSpeech(clip: PreparedSpeech | null | undefined, rate: number, signal: AbortSignal): SpeechPlayback {
  if (!clip) throw new Error('音频尚未准备好，请稍等');
  const audio = getPlayer();
  audio.pause();
  audio.src = clip.url;
  audio.currentTime = 0;
  audio.playbackRate = Math.max(0.5, Math.min(2, rate));
  let settled = false;
  let paused = false;
  let playAttempt = 0;
  let resolveFinished!: () => void;
  let rejectFinished!: (err: Error) => void;
  const finished = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
  const finish = (err?: Error) => {
    if (settled) return;
    settled = true;
    audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); signal.removeEventListener('abort', stop);
    audio.pause();
    if (err) rejectFinished(err); else resolveFinished();
  };
  const ended = () => finish();
  const failed = () => finish(new Error('音频播放失败，请重新准备语音'));
  const stop = () => finish();
  const play = (error: string) => {
    const attempt = ++playAttempt;
    const failed = () => {
      // A deliberate pause may reject the pending play(). Ignore that old
      // attempt, including when the same audio element is already playing again.
      if (!settled && !paused && !signal.aborted && attempt === playAttempt) finish(new Error(error));
    };
    try { void audio.play().catch(failed); } catch { failed(); }
  };
  audio.addEventListener('ended', ended); audio.addEventListener('error', failed); signal.addEventListener('abort', stop, { once: true });
  play('浏览器暂未允许播放，请再次点击播放');
  return {
    pause() {
      if (settled || paused) return;
      if (audio.ended) { finish(); return; }
      paused = true;
      audio.pause();
    },
    resume() {
      if (settled || !paused) return;
      if (audio.ended) { finish(); return; }
      paused = false;
      play('无法继续播放语音，请重试');
    },
    finished,
  };
}
