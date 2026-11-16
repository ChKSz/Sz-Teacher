import { useEffect, useState } from 'react';
import type { PublicTts, SpeechOptions } from '../../shared/types.ts';
import { prepareSpeech, type PreparedSpeech } from './speech.ts';
const EMPTY_CLIPS: (PreparedSpeech | null)[] = [];

/** 换内容或音色才重新准备；调速不重新合成。过期请求不能覆盖当前音频。 */
export function usePreparedSpeech(texts: string[], options: SpeechOptions, enabled = true) {
  const tts = options as Partial<PublicTts>;
  const key = JSON.stringify([texts, tts.provider, tts.cacheVersion, tts.baseUrl, tts.model, tts.xiaomiVoice, tts.style]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; status: 'preparing' | 'ready' | 'error'; clips: (PreparedSpeech | null)[]; completed: number; total: number; error: string }>({ key: '', status: 'preparing', clips: [], completed: 0, total: 0, error: '' });
  const required = enabled && options.provider === 'xiaomi' && texts.some((text) => text.trim());
  useEffect(() => {
    if (!required) return;
    const abort = new AbortController();
    let prepared: (PreparedSpeech | null)[] = [];
    setState({ key, status: 'preparing', clips: [], completed: 0, total: texts.filter((text) => text.trim()).length, error: '' });
    void prepareSpeech(texts, abort.signal, (completed, total) => {
      if (!abort.signal.aborted) setState((value) => ({ ...value, completed, total }));
    }).then((clips) => {
      prepared = clips;
      if (abort.signal.aborted) { clips.forEach((clip) => clip?.dispose()); return; }
      setState((value) => ({ ...value, status: 'ready', clips }));
    }).catch((err: Error) => {
      if (!abort.signal.aborted) setState((value) => ({ ...value, status: 'error', error: err.message }));
    });
    return () => { abort.abort(); prepared.forEach((clip) => clip?.dispose()); };
    // key 包含所有影响合成的字段，刻意排除语速和 React 临时对象的身份。
  }, [key, required, attempt]);
  const current = state.key === key;
  return {
    key, clips: current ? state.clips : EMPTY_CLIPS,
    preparing: !!required && (!current || state.status === 'preparing'),
    ready: !required || (current && state.status === 'ready'),
    error: required && current ? state.error : '',
    completed: current ? state.completed : 0, total: current ? state.total : texts.length,
    retry: () => { setState((value) => ({ ...value, status: 'preparing', error: '' })); setAttempt((value) => value + 1); },
  };
}
