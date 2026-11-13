// 浏览器语音合成（Web Speech API）的简单封装。

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
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
    .flatMap((s) => (s.length > 180 ? s.match(/.{1,180}(?:[，,、]|$)/gu) ?? [s] : [s]));
}

export interface SpeakHandle {
  stop: () => void;
  finished: Promise<void>;
}

export async function speak(text: string, options: { rate: number; voice: string }): Promise<SpeakHandle> {
  if (!speechSupported()) throw new Error('这个浏览器不支持朗读');
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = chooseVoice(await chineseVoices(), options.voice);
  let stopped = false;
  const finished = (async () => {
    for (const sentence of splitSentences(text)) {
      if (stopped) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(sentence);
        u.lang = voice?.lang ?? 'zh-CN';
        if (voice) u.voice = voice;
        u.rate = options.rate;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        synth.speak(u);
      });
    }
  })();
  return {
    stop: () => {
      stopped = true;
      synth.cancel();
    },
    finished,
  };
}
