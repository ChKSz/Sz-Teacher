import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;

const SIGNATURES: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.toString('ascii', 0, 4) === 'GIF8' },
];

const NAME_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

export function mimeOf(name: string): string | null {
  if (!NAME_PATTERN.test(name)) return null;
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return SIGNATURES.find((s) => s.ext === ext)?.mime ?? null;
}

export class UploadStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'uploads');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** 解析 data URL，按文件头判断真实格式后保存，返回文件名。 */
  saveDataUrl(dataUrl: unknown): string {
    if (typeof dataUrl !== 'string') throw new Error('图片数据格式不正确');
    const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!match) throw new Error('图片数据格式不正确');
    const bytes = Buffer.from(match[1]!, 'base64');
    if (bytes.length === 0) throw new Error('图片是空的');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片太大（最大 8MB）');
    const kind = SIGNATURES.find((s) => s.test(bytes));
    if (!kind) throw new Error('只支持 PNG、JPEG、WebP、GIF 图片');
    const name = `${crypto.randomUUID()}.${kind.ext}`;
    fs.writeFileSync(path.join(this.dir, name), bytes);
    return name;
  }

  /** 返回文件的绝对路径；文件名不合法或文件不存在时返回 null。 */
  resolve(name: string): string | null {
    if (!mimeOf(name)) return null;
    const file = path.join(this.dir, name);
    return fs.existsSync(file) ? file : null;
  }

  toDataUrl(name: string): string | null {
    const file = this.resolve(name);
    const mime = mimeOf(name);
    if (!file || !mime) return null;
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  }

  remove(names: string[]): void {
    for (const name of names) {
      const file = this.resolve(name);
      if (file) fs.rmSync(file, { force: true });
    }
  }
}
