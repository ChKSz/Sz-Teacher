// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareSpeech, speak, splitSentences } from '../web/src/speech.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fakeSpeech(ready: boolean) {
  const events = new EventTarget();
  const synth = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => ready ? [{ lang: 'zh-CN', name: '中文', voiceURI: '中文' }] : [],
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = ''; rate = 1; voice: unknown; onend: (() => void) | null = null; onerror: (() => void) | null = null;
  });
  return synth;
}

it('等待设备声音期间取消，不会在声音加载后突然朗读旧步骤', async () => {
  vi.useFakeTimers();
  const synth = fakeSpeech(false);
  const abort = new AbortController();
  const pending = speak('第一步。', { rate: 1, voice: '' }, abort.signal);
  abort.abort();
  await vi.advanceTimersByTimeAsync(1600);
  await (await pending).finished;
  expect(synth.speak).not.toHaveBeenCalled();
});

it('暂停朗读能结束等待，重复停止旧句柄不会打断新朗读', async () => {
  const synth = fakeSpeech(true);
  const handle = await speak('第一句。第二句。', { rate: 1, voice: '' });
  expect(synth.speak).toHaveBeenCalledTimes(1);
  handle.stop();
  await handle.finished;
  expect(synth.speak).toHaveBeenCalledTimes(1);
  const cancelCount = synth.cancel.mock.calls.length;
  handle.stop();
  expect(synth.cancel).toHaveBeenCalledTimes(cancelCount);
});

it('长句分段不会遗漏开头文字或破坏 Unicode 字符', () => {
  const text = '这是完整的讲解📐'.repeat(60) + '，接着验证结论。';
  expect(splitSentences(text).join('')).toBe(text);
});

it('开始新朗读会结束上一段，旧句柄不会再中断新的声音', async () => {
  const synth = fakeSpeech(true);
  const previous = await speak('旧的第一句。旧的第二句。', { rate: 1, voice: '' });
  const current = await speak('新的第一句。', { rate: 1, voice: '' });
  await previous.finished;
  expect(synth.speak).toHaveBeenCalledTimes(2);
  const before = synth.cancel.mock.calls.length;
  previous.stop();
  expect(synth.cancel).toHaveBeenCalledTimes(before);
  current.stop(); await current.finished;
});

it('小米倍速用媒体元素保留音调，停止旧句柄不会影响新朗读', async () => {
  const elements: FakeAudio[] = [];
  class FakeAudio extends EventTarget {
    src = ''; preload = ''; currentTime = 0; playbackRate = 1; preservesPitch = false; webkitPreservesPitch = false;
    pause = vi.fn(); play = vi.fn(async () => {});
    constructor() { super(); elements.push(this); }
  }
  vi.stubGlobal('Audio', FakeAudio);
  const clip = { url: 'blob:测试音频', dispose: vi.fn() };
  const handle = await speak('整段内容', { provider: 'xiaomi', rate: 1.8, voice: '' }, undefined, clip);
  const audio = elements[0]!;
  expect(audio.playbackRate).toBe(1.8);
  expect(audio.preservesPitch).toBe(true);
  expect(audio.webkitPreservesPitch).toBe(true);
  expect(audio.play).toHaveBeenCalledTimes(1);
  handle.stop(); await handle.finished;
  const current = await speak('重播', { provider: 'xiaomi', rate: 1, voice: '' }, undefined, clip);
  const count = audio.pause.mock.calls.length;
  handle.stop(); expect(audio.pause).toHaveBeenCalledTimes(count);
  audio.dispatchEvent(new Event('ended')); await current.finished;
});

it('准备时一次提交完整文本，取消等待不会触发播放', async () => {
  const text = '第一句。第二句。'.repeat(100);
  const fetcher = vi.fn(async () => Response.json({ id: '测试任务', status: 'preparing', completed: 0, total: 1, clips: [] }));
  vi.stubGlobal('fetch', fetcher);
  const abort = new AbortController();
  const pending = prepareSpeech([text], abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(call[1].body as string)).toEqual({ texts: [text] });
});
