// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareSpeech, speak, splitSentences } from '../web/src/speech.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fakeSpeech(ready: boolean) {
  const events = new EventTarget();
  const synth = {
    cancel: vi.fn(),
    speak: vi.fn(),
    paused: false,
    pause: vi.fn(() => { synth.paused = true; }),
    resume: vi.fn(() => { synth.paused = false; }),
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

it('声音列表为空时也在点击内请求系统中文朗读，不等待 voiceschanged', async () => {
  const synth = fakeSpeech(false);
  const controller = new AbortController();
  const pending = speak('第一步。', { rate: 1, voice: '' }, controller.signal);
  expect(synth.speak).toHaveBeenCalledWith(expect.objectContaining({ lang: 'zh-CN' }));
  controller.abort();
  await (await pending).finished;
  expect(synth.speak).toHaveBeenCalledTimes(1);
});

it('浏览器拒绝朗读时报告失败，不当作朗读完成或继续读下一句', async () => {
  const synth = fakeSpeech(true);
  const handle = await speak('第一步。第二句。', { rate: 1, voice: '' });
  const utterance = synth.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
  const failed = expect(handle.finished).rejects.toThrow('浏览器阻止了朗读');
  utterance.onerror?.({ error: 'not-allowed' } as SpeechSynthesisErrorEvent);
  await failed;
  expect(synth.speak).toHaveBeenCalledTimes(1);
});

it('只有结束事件却没有开始事件时不算读完', async () => {
  const synth = fakeSpeech(false);
  const handle = await speak('第一步。第二句。', { rate: 1, voice: '' });
  const utterance = synth.speak.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
  const failed = expect(handle.finished).rejects.toThrow('未实际开始朗读');
  utterance.onend?.({} as SpeechSynthesisEvent);
  await failed;
  expect(synth.speak).toHaveBeenCalledTimes(1);
});

it('设备不返回开始事件时也会报错，不会无声跳至下一句', async () => {
  vi.useFakeTimers();
  const synth = fakeSpeech(false);
  const handle = await speak('第一步。第二句。', { rate: 1, voice: '' });
  const timedOut = expect(handle.finished).rejects.toThrow('未开始朗读');
  await vi.advanceTimersByTimeAsync(6100);
  await timedOut;
  expect(synth.speak).toHaveBeenCalledTimes(1);
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

const playbackEvent = {} as SpeechSynthesisEvent;
const currentUtterance = (synth: ReturnType<typeof fakeSpeech>) => synth.speak.mock.calls.at(-1)?.[0] as SpeechSynthesisUtterance;

it('浏览器暂停保留等待开始和朗读计时，恢复同步继续同一句', async () => {
  vi.useFakeTimers();
  const synth = fakeSpeech(true);
  const pending = speak('第一句。第二句。', { rate: 1, voice: '' });
  const utterance = currentUtterance(synth);
  const handle = await pending;
  await vi.advanceTimersByTimeAsync(5500);
  handle.pause();
  expect(synth.pause).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20_000);
  handle.resume();
  expect(synth.resume).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(400);
  utterance.onstart?.(playbackEvent);
  await vi.advanceTimersByTimeAsync(119_500);
  handle.pause();
  await vi.advanceTimersByTimeAsync(125_000);
  handle.resume();
  expect(synth.resume).toHaveBeenCalledTimes(2);
  expect(synth.speak).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(400);
  utterance.onend?.(playbackEvent);
  await vi.advanceTimersByTimeAsync(0);
  const next = currentUtterance(synth);
  expect(next).not.toBe(utterance);
  next.onstart?.(playbackEvent);
  next.onend?.(playbackEvent);
  await handle.finished;
});

it('在两句之间暂停不会开始下一句；恢复点击中同步加入下一句', async () => {
  const synth = fakeSpeech(true);
  const handle = await speak('第一句。第二句。', { rate: 1, voice: '' });
  const first = currentUtterance(synth);
  first.onstart?.(playbackEvent);
  first.onend?.(playbackEvent);
  handle.pause();
  await Promise.resolve();
  expect(synth.speak).toHaveBeenCalledTimes(1);
  handle.resume();
  expect(synth.speak).toHaveBeenCalledTimes(2);
  const second = currentUtterance(synth);
  second.onstart?.(playbackEvent);
  second.onend?.(playbackEvent);
  await handle.finished;
});

it('暂停后浏览器恢复失败会拒绝 finished', async () => {
  const synth = fakeSpeech(true);
  const handle = await speak('第一句。第二句。', { rate: 1, voice: '' });
  synth.resume.mockImplementationOnce(() => { throw new Error('synth failed'); });
  const rejected = expect(handle.finished).rejects.toThrow('无法继续浏览器朗读');
  handle.pause();
  handle.resume();
  await rejected;
  expect(synth.speak).toHaveBeenCalledTimes(1);
});

it('浏览器无声忽略恢复时也会报错，而不是一直等下去', async () => {
  vi.useFakeTimers();
  const synth = fakeSpeech(true);
  const handle = await speak('没恢复。', { rate: 1, voice: '' });
  currentUtterance(synth).onstart?.(playbackEvent);
  handle.pause();
  synth.resume.mockImplementationOnce(() => {});
  const rejected = expect(handle.finished).rejects.toThrow('无法继续浏览器朗读');
  handle.resume();
  await vi.advanceTimersByTimeAsync(4100);
  await rejected;
  expect(synth.speak).toHaveBeenCalledTimes(1);
});

it('结束或中止的浏览器句柄不会暂停或继续下一段', async () => {
  const synth = fakeSpeech(true);
  const old = await speak('结束。', { rate: 1, voice: '' });
  const first = currentUtterance(synth);
  first.onstart?.(playbackEvent);
  first.onend?.(playbackEvent);
  await old.finished;
  const signal = new AbortController();
  const paused = await speak('中止。', { rate: 1, voice: '' }, signal.signal);
  paused.pause();
  signal.abort();
  await paused.finished;
  expect(synth.paused).toBe(false);
  const current = await speak('新一段。', { rate: 1, voice: '' });
  const calls = [synth.pause.mock.calls.length, synth.resume.mock.calls.length, synth.cancel.mock.calls.length];
  for (const handle of [old, paused]) { handle.pause(); handle.resume(); handle.stop(); }
  expect([synth.pause.mock.calls.length, synth.resume.mock.calls.length, synth.cancel.mock.calls.length]).toEqual(calls);
  const alreadyAborted = await speak('没开始。', { rate: 1, voice: '' }, signal.signal);
  await alreadyAborted.finished;
  expect(synth.cancel).toHaveBeenCalledTimes(calls[2]!);
  current.stop();
  await current.finished;
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
  audio.currentTime = 2.3;
  const pauseCount = audio.pause.mock.calls.length;
  handle.pause();
  expect(audio.pause).toHaveBeenCalledTimes(pauseCount + 1);
  handle.resume();
  expect(audio.play).toHaveBeenCalledTimes(2);
  expect(audio.currentTime).toBe(2.3);
  expect(audio.src).toBe(clip.url);
  handle.stop(); await handle.finished;
  const current = await speak('重播', { provider: 'xiaomi', rate: 1, voice: '' }, undefined, clip);
  const count = audio.pause.mock.calls.length;
  handle.pause(); handle.resume(); handle.stop();
  expect(audio.pause).toHaveBeenCalledTimes(count);
  expect(audio.play).toHaveBeenCalledTimes(3);
  audio.dispatchEvent(new Event('ended')); await current.finished;
  current.pause(); current.resume();
  expect(audio.play).toHaveBeenCalledTimes(3);

  let rejectInitial!: (err: Error) => void;
  audio.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectInitial = reject; }));
  const race = await speak('待开始', { provider: 'xiaomi', rate: 1, voice: '' }, undefined, clip);
  race.pause();
  race.resume();
  rejectInitial(new Error('pause() interrupted play()'));
  await Promise.resolve();
  audio.dispatchEvent(new Event('ended')); await race.finished;

  const failed = await speak('恢复失败', { provider: 'xiaomi', rate: 1, voice: '' }, undefined, clip);
  const rejected = expect(failed.finished).rejects.toThrow('无法继续播放语音');
  failed.pause();
  audio.play.mockRejectedValueOnce(new Error('permission denied'));
  failed.resume();
  await rejected;
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
