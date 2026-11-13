import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.ts';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;
const PASSWORD_KEY = 'password_hash';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 6;

/** 格式：scrypt$N$r$p$salt(base64)$hash(base64) */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

export function validateNewPassword(password: unknown): string {
  if (typeof password !== 'string') throw new Error('密码必须是文本');
  if ([...password].length < MIN_PASSWORD_LENGTH) throw new Error(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  if (password.length > 200) throw new Error('密码太长');
  return password;
}

export function getPasswordHash(db: Db): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSWORD_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setPasswordHash(db: Db, hash: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(PASSWORD_KEY, hash);
}

/** 仅在尚未设置密码时写入；返回是否写入成功（防止并发的两次首次设置互相覆盖）。 */
export function setInitialPasswordHash(db: Db, hash: string): boolean {
  const result = db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
    .run(PASSWORD_KEY, hash);
  return Number(result.changes) === 1;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 新建会话，返回给浏览器的原始令牌。数据库只存令牌的哈希。 */
export function createSession(db: Db, userAgent: string, now = Date.now()): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    now,
    now + SESSION_TTL_MS,
    userAgent.slice(0, 300),
  );
  return token;
}

export function isValidSession(db: Db, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hashToken(token)) as
    | { expires_at: number }
    | undefined;
  return row !== undefined && row.expires_at > now;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteAllSessions(db: Db): void {
  db.prepare('DELETE FROM sessions').run();
}

export function purgeExpiredSessions(db: Db, now = Date.now()): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}

/** 按 IP 统计登录失败次数：窗口内失败达到上限后锁定一段时间。 */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;

  constructor(maxFailures = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
  }

  /** 返回剩余锁定毫秒数，0 表示可以尝试。 */
  lockedFor(ip: string, now = Date.now()): number {
    const entry = this.failures.get(ip);
    if (!entry) return 0;
    return Math.max(0, entry.lockedUntil - now);
  }

  recordFailure(ip: string, now = Date.now()): void {
    let entry = this.failures.get(ip);
    if (!entry || now - entry.firstAt > this.windowMs) {
      entry = { count: 0, firstAt: now, lockedUntil: 0 };
      this.failures.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count >= this.maxFailures) {
      entry.lockedUntil = now + this.lockMs;
      entry.count = 0;
      entry.firstAt = now;
    }
    if (this.failures.size > 10_000) this.prune(now);
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
  }

  private prune(now: number): void {
    for (const [ip, entry] of this.failures) {
      if (entry.lockedUntil <= now && now - entry.firstAt > this.windowMs) this.failures.delete(ip);
    }
    // 仍然太多时，丢弃最早的未锁定记录（Map 按插入顺序遍历）
    for (const [ip, entry] of this.failures) {
      if (this.failures.size <= 5_000) break;
      if (entry.lockedUntil <= now) this.failures.delete(ip);
    }
  }
}
