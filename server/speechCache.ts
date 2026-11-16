import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { synthesizeSpeech } from './tts.ts';
import type { Settings } from './settings.ts';
import type { SpeechJob } from '../shared/types.ts';

const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024 * 1024;
const ID = /^[a-f0-9]{64}$/;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 音频落盘缓存，语速由浏览器控制，不参与合成或缓存键。 */
export class SpeechCache {
  readonly dir: string;
  private jobs = new Map<string, SpeechJob>();
  private pending = new Map<string, Promise<string>>();
  private running = 0;
  private queue: (() => void)[] = [];
  private pruning: Promise<void> | undefined;

  constructor(dataDir: string) { this.dir = path.join(dataDir, 'speech-cache'); }

  private clipId(tts: Settings['tts'], text: string) {
    return hash(['语音缓存第二版', tts.baseUrl, tts.apiKey, tts.model, tts.xiaomiVoice, tts.style, text]);
  }

  private async limited<T>(run: () => Promise<T>): Promise<T> {
    if (this.running >= 3) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.running++;
    try { return await run(); }
    finally { const next = this.queue.shift(); if (next) next(); else this.running--; }
  }

  async read(id: string): Promise<Buffer | null> {
    if (!ID.test(id)) return null;
    const file = path.join(this.dir, `${id}.wav`);
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > MAX_AGE) return null;
      return await fs.readFile(file);
    } catch { return null; }
  }

  /** 同一音色与全文只合成一次。客户端离开页面后继续完成，供刷新或重播复用。 */
  ensure(tts: Settings['tts'], text: string): Promise<string> {
    const id = this.clipId(tts, text);
    const existing = this.pending.get(id);
    if (existing) return existing;
    const work = (async () => {
      if (await this.read(id)) return id;
      return this.limited(async () => {
        const audio = await synthesizeSpeech(tts, text);
        await fs.mkdir(this.dir, { recursive: true });
        const temporary = path.join(this.dir, `${id}.tmp`);
        await fs.writeFile(temporary, audio);
        await fs.rename(temporary, path.join(this.dir, `${id}.wav`));
        return id;
      });
    })().finally(() => {
      this.pending.delete(id);
      this.pruning ??= this.prune().catch(() => {}).finally(() => { this.pruning = undefined; });
    });
    this.pending.set(id, work);
    return work;
  }

  prepare(tts: Settings['tts'], texts: string[]): SpeechJob {
    const ids = texts.map((text) => text ? this.clipId(tts, text) : '');
    const id = hash(ids);
    const existing = this.jobs.get(id);
    if (existing?.status === 'preparing') return existing;
    const job: SpeechJob = { id, status: 'preparing', completed: 0, total: texts.filter(Boolean).length, clips: [] };
    this.jobs.set(id, job);
    // 清理已结束任务的内存元数据，落盘音频仍可命中缓存。
    if (this.jobs.size > 500) for (const [key, value] of this.jobs) {
      if (this.jobs.size <= 400) break;
      if (key !== id && value.status !== 'preparing') this.jobs.delete(key);
    }
    void Promise.allSettled(texts.map(async (text) => {
      if (!text) return null;
      const clip = await this.ensure(tts, text);
      job.completed++;
      return `/api/tts/audio/${clip}`;
    })).then((results) => {
      const failure = results.find((item) => item.status === 'rejected');
      if (failure?.status === 'rejected') {
        job.status = 'error'; job.error = failure.reason instanceof Error ? failure.reason.message : '语音准备失败，请重试';
      } else {
        job.clips = results.map((item) => item.status === 'fulfilled' ? item.value : null);
        job.status = 'ready';
      }
    });
    return job;
  }

  status(id: string): SpeechJob | undefined { return this.jobs.get(id); }

  private async prune() {
    const names = await fs.readdir(this.dir).catch(() => []);
    const entries = (await Promise.all(names.filter((name) => /^[a-f0-9]{64}\.wav$/.test(name)).map(async (name) => {
      const file = path.join(this.dir, name);
      const stat = await fs.stat(file).catch(() => null);
      return stat ? { file, name, size: stat.size, time: stat.mtimeMs } : null;
    }))).filter((item) => item !== null).sort((a, b) => b.time - a.time);
    let size = 0;
    for (const entry of entries) {
      size += entry.size;
      // 仅清理本缓存目录内符合哈希命名规则的音频文件。
      if (!this.pending.has(entry.name.slice(0, -4)) && (Date.now() - entry.time > MAX_AGE || size > MAX_BYTES)) await fs.unlink(entry.file).catch(() => {});
    }
  }
}
