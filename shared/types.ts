// 前后端共用的接口数据类型。
import type { Scene } from './scene/types.ts';

export type ReasoningEffort = '' | 'low' | 'medium' | 'high';
export type TeachingStyle = 'direct' | 'hint-first';
export type ReviewStatus = 'pending' | 'mastered';
export interface ConversationUpdate {
  title?: string;
  starred?: boolean;
  note?: string;
  knowledgePoint?: string;
  errorReason?: string;
  reviewStatus?: ReviewStatus;
}

export interface SceneJob {
  status: 'working' | 'done' | 'error';
  message: string;
  startedAt: number;
  updatedAt: number;
}

export interface PublicSettings {
  provider: { baseUrl: string; apiKeyMasked: string; hasApiKey: boolean };
  solveModel: string;
  sceneModel: string;
  models: string[];
  reasoningEffort: ReasoningEffort;
  teachingStyle: TeachingStyle;
  tts: PublicTts;
}

export interface SpeechOptions { rate: number; voice: string; provider?: 'browser' | 'xiaomi' }
export interface PublicTts extends SpeechOptions {
  cacheVersion?: string;
  provider: 'browser' | 'xiaomi';
  baseUrl: string;
  model: string;
  xiaomiVoice: string;
  style: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
}

export interface SpeechJob {
  id: string;
  status: 'preparing' | 'ready' | 'error';
  completed: number;
  total: number;
  clips: (string | null)[];
  error?: string;
}
export interface TtsUpdate {
  rate?: number; voice?: string; provider?: 'browser' | 'xiaomi';
  baseUrl?: string; apiKey?: string; model?: string; xiaomiVoice?: string; style?: string;
}

export interface SettingsUpdate {
  provider?: { baseUrl?: string; apiKey?: string };
  solveModel?: string;
  sceneModel?: string;
  reasoningEffort?: ReasoningEffort;
  teachingStyle?: TeachingStyle;
  tts?: TtsUpdate;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 加入错题本。 */
  starred: boolean;
  /** 错题笔记：错因、要点。 */
  note: string;
  knowledgePoint: string;
  errorReason: string;
  reviewStatus: ReviewStatus;
  sceneStatus?: SceneJob['status'];
}

export interface SceneRecord {
  id: string;
  scene: Scene;
  verified: boolean;
  problems: string[];
  createdAt: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 图片文件名，通过 /api/uploads/<名字> 获取。 */
  images: string[];
  status: 'done' | 'error';
  createdAt: number;
  /** 这条回答对应的最新讲解剧本。 */
  scene?: SceneRecord;
  sceneJob?: SceneJob;
}

export interface ConversationDetail extends ConversationSummary {
  messages: Message[];
}

export interface AuthStatus {
  initialized: boolean;
  authenticated: boolean;
}

/** 发消息接口返回的 SSE 事件。 */
export type ChatEvent =
  | { type: 'start'; conversationId: string; userMessage: Message; assistantMessageId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: Message; title: string }
  | { type: 'error'; message: string };

/** 生成讲解剧本接口返回的 SSE 事件。 */
export type SceneEvent =
  | { type: 'progress'; message: string }
  | { type: 'done'; record: SceneRecord }
  | { type: 'error'; message: string };

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  models?: string[];
}
