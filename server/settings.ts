import type { Db } from './db.ts';
import type { ServerConfig } from './config.ts';
import type { PublicSettings, ReasoningEffort, SettingsUpdate, TeachingStyle } from '../shared/types.ts';

/** 保存在数据库里的完整设置（包含密钥，只在服务器上使用）。 */
export interface Settings {
  provider: { baseUrl: string; apiKey: string };
  solveModel: string;
  sceneModel: string;
  reasoningEffort: ReasoningEffort;
  teachingStyle: TeachingStyle;
  tts: { rate: number; voice: string };
}

const KEY = 'app';

export function defaultSettings(config: ServerConfig): Settings {
  return {
    provider: {
      baseUrl: config.initialProvider.baseUrl.replace(/\/+$/, ''),
      apiKey: config.initialProvider.apiKey,
    },
    solveModel: config.initialProvider.model,
    sceneModel: config.initialProvider.model,
    reasoningEffort: '',
    teachingStyle: 'direct',
    tts: { rate: 1, voice: '' },
  };
}

export function loadSettings(db: Db, config: ServerConfig): Settings {
  const defaults = defaultSettings(config);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  if (!row) return defaults;
  const stored = JSON.parse(row.value) as Partial<Settings>;
  return {
    ...defaults,
    ...stored,
    provider: { ...defaults.provider, ...stored.provider },
    tts: { ...defaults.tts, ...stored.tts },
  };
}

function saveSettings(db: Db, settings: Settings): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(KEY, JSON.stringify(settings));
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export function toPublic(settings: Settings): PublicSettings {
  return {
    provider: {
      baseUrl: settings.provider.baseUrl,
      apiKeyMasked: maskKey(settings.provider.apiKey),
      hasApiKey: settings.provider.apiKey !== '',
    },
    solveModel: settings.solveModel,
    sceneModel: settings.sceneModel,
    reasoningEffort: settings.reasoningEffort,
    teachingStyle: settings.teachingStyle,
    tts: { ...settings.tts },
  };
}

const EFFORTS = new Set<string>(['', 'low', 'medium', 'high']);
const STYLES = new Set<string>(['direct', 'hint-first']);

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是文本`);
  return value.trim();
}

/** 校验并合并一次更新。字段为 undefined 表示不修改。出错时抛出带中文说明的 Error。 */
export function applyUpdate(current: Settings, update: SettingsUpdate): Settings {
  const next: Settings = structuredClone(current);
  if (update.provider) {
    if (update.provider.baseUrl !== undefined) {
      const url = text(update.provider.baseUrl, 'Base URL').replace(/\/+$/, '');
      if (url !== '') {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error('Base URL 格式不正确');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Base URL 必须以 http:// 或 https:// 开头');
        }
      }
      next.provider.baseUrl = url;
    }
    if (update.provider.apiKey !== undefined) next.provider.apiKey = text(update.provider.apiKey, 'API Key');
  }
  if (update.solveModel !== undefined) next.solveModel = text(update.solveModel, '解题模型');
  if (update.sceneModel !== undefined) next.sceneModel = text(update.sceneModel, '剧本模型');
  if (update.reasoningEffort !== undefined) {
    if (!EFFORTS.has(update.reasoningEffort)) throw new Error('思考强度取值无效');
    next.reasoningEffort = update.reasoningEffort;
  }
  if (update.teachingStyle !== undefined) {
    if (!STYLES.has(update.teachingStyle)) throw new Error('讲解风格取值无效');
    next.teachingStyle = update.teachingStyle;
  }
  if (update.tts) {
    if (update.tts.rate !== undefined) {
      const rate = Number(update.tts.rate);
      if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('语速必须在 0.5 到 2 之间');
      next.tts.rate = rate;
    }
    if (update.tts.voice !== undefined) next.tts.voice = text(update.tts.voice, '声音');
  }
  return next;
}

export function updateSettings(db: Db, config: ServerConfig, update: SettingsUpdate): Settings {
  const next = applyUpdate(loadSettings(db, config), update);
  saveSettings(db, next);
  return next;
}
