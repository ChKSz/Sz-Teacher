import type { Db } from './db.ts';
import { createHash } from 'node:crypto';
import type { ServerConfig } from './config.ts';
import type { PublicSettings, PublicTts, ReasoningEffort, SettingsUpdate, TeachingStyle } from '../shared/types.ts';

/** 保存在数据库里的完整设置（包含密钥，只在服务器上使用）。 */
export interface Settings {
  provider: { baseUrl: string; apiKey: string };
  solveModel: string;
  sceneModel: string;
  models: string[];
  reasoningEffort: ReasoningEffort;
  teachingStyle: TeachingStyle;
  tts: Omit<PublicTts, 'hasApiKey' | 'apiKeyMasked'> & { apiKey: string };
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
    models: [],
    reasoningEffort: '',
    teachingStyle: 'direct',
    tts: { rate: 1, voice: '', provider: config.initialTts?.apiKey ? 'xiaomi' : 'browser', apiKey: config.initialTts?.apiKey ?? '',
      baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-tts', xiaomiVoice: 'mimo_default', style: '用自然、耐心的普通话讲解数学，吐字清晰，在关键步骤之间稍作停顿。' },
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
  const { apiKey: ttsKey, ...tts } = settings.tts;
  return {
    provider: {
      baseUrl: settings.provider.baseUrl,
      apiKeyMasked: maskKey(settings.provider.apiKey),
      hasApiKey: settings.provider.apiKey !== '',
    },
    solveModel: settings.solveModel,
    sceneModel: settings.sceneModel,
    models: settings.models,
    reasoningEffort: settings.reasoningEffort,
    teachingStyle: settings.teachingStyle,
    tts: { ...tts, hasApiKey: !!ttsKey, apiKeyMasked: maskKey(ttsKey), cacheVersion: createHash('sha256').update(JSON.stringify([tts.baseUrl, ttsKey, tts.model, tts.xiaomiVoice, tts.style])).digest('hex').slice(0, 24) },
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
      if (url !== current.provider.baseUrl) next.models = [];
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
    if (update.tts.provider !== undefined) {
      if (!['browser', 'xiaomi'].includes(update.tts.provider)) throw new Error('朗读来源不正确');
      next.tts.provider = update.tts.provider;
    }
    for (const key of ['baseUrl', 'apiKey', 'model', 'xiaomiVoice', 'style'] as const) {
      if (update.tts[key] !== undefined) next.tts[key] = text(update.tts[key], '语音设置').slice(0, key === 'apiKey' ? 4096 : 1000);
    }
    next.tts.baseUrl = next.tts.baseUrl.replace(/\/+$/, '');
    let parsed: URL;
    try { parsed = new URL(next.tts.baseUrl); } catch { throw new Error('语音接口地址格式不正确'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('语音接口地址必须使用 http:// 或 https://');
    if (next.tts.baseUrl !== current.tts.baseUrl && current.tts.apiKey && !update.tts.apiKey?.trim()) throw new Error('更换语音接口地址时，请重新填写语音密钥');
    if (!next.tts.model || !next.tts.xiaomiVoice) throw new Error('请填写语音模型和音色');
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

/** 模型列表由服务器向供应商获取后保存，与对应供应商绑定。 */
export function saveProviderModels(db: Db, settings: Settings, models: string[]): Settings {
  const next = { ...settings, models };
  if (!models.includes(next.solveModel)) next.solveModel = models[0]!;
  if (!models.includes(next.sceneModel)) next.sceneModel = next.solveModel;
  saveSettings(db, next);
  return next;
}
