import crypto from 'node:crypto';
import type { Db } from './db.ts';
import type { ConversationDetail, ConversationSummary, Message, SceneRecord } from '../shared/types.ts';
import type { Scene } from '../shared/scene/types.ts';

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  starred: number;
  note: string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images: string;
  status: 'done' | 'error';
  created_at: number;
}

export function newId(): string {
  return crypto.randomUUID();
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    starred: row.starred === 1,
    note: row.note,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    images: JSON.parse(row.images) as string[],
    status: row.status,
    createdAt: row.created_at,
  };
}

export function listConversations(db: Db): ConversationSummary[] {
  const rows = db
    .prepare('SELECT id, title, created_at, updated_at, starred, note FROM conversations ORDER BY updated_at DESC')
    .all() as unknown as ConversationRow[];
  return rows.map(toSummary);
}

export function getConversation(db: Db, id: string): ConversationDetail | null {
  const row = db.prepare('SELECT id, title, created_at, updated_at, starred, note FROM conversations WHERE id = ?').get(id) as
    | ConversationRow
    | undefined;
  if (!row) return null;
  const messages = db
    .prepare(
      'SELECT id, role, content, images, status, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid',
    )
    .all(id) as unknown as MessageRow[];
  const result = messages.map(toMessage);
  const scenes = latestScenes(db, id);
  for (const m of result) {
    const scene = scenes.get(m.id);
    if (scene) m.scene = scene;
  }
  return { ...toSummary(row), messages: result };
}

interface SceneRow {
  id: string;
  message_id: string;
  scene: string;
  verified: number;
  problems: string;
  created_at: number;
}

function toSceneRecord(row: SceneRow): SceneRecord {
  return {
    id: row.id,
    scene: JSON.parse(row.scene) as Scene,
    verified: row.verified === 1,
    problems: JSON.parse(row.problems) as string[],
    createdAt: row.created_at,
  };
}

/** 每条消息最新的剧本。 */
function latestScenes(db: Db, conversationId: string): Map<string, SceneRecord> {
  const rows = db
    .prepare(
      `SELECT s.id, s.message_id, s.scene, s.verified, s.problems, s.created_at
       FROM scenes s JOIN messages m ON m.id = s.message_id
       WHERE m.conversation_id = ?
       ORDER BY s.created_at, s.rowid`,
    )
    .all(conversationId) as unknown as SceneRow[];
  const map = new Map<string, SceneRecord>();
  for (const row of rows) map.set(row.message_id, toSceneRecord(row));
  return map;
}

export function getMessage(db: Db, id: string): (Message & { conversationId: string }) | null {
  const row = db
    .prepare('SELECT id, role, content, images, status, created_at, conversation_id FROM messages WHERE id = ?')
    .get(id) as (MessageRow & { conversation_id: string }) | undefined;
  return row ? { ...toMessage(row), conversationId: row.conversation_id } : null;
}

export function saveScene(
  db: Db,
  messageId: string,
  scene: Scene,
  verified: boolean,
  problems: string[],
  now = Date.now(),
): SceneRecord {
  const record: SceneRecord = { id: newId(), scene, verified, problems, createdAt: now };
  db.prepare('INSERT INTO scenes (id, message_id, scene, verified, problems, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    record.id,
    messageId,
    JSON.stringify(scene),
    verified ? 1 : 0,
    JSON.stringify(problems),
    now,
  );
  return record;
}

export function createConversation(db: Db, title: string, now = Date.now()): ConversationSummary {
  const id = newId();
  db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    title,
    now,
    now,
  );
  return { id, title, createdAt: now, updatedAt: now, starred: false, note: '' };
}

export function updateConversation(
  db: Db,
  id: string,
  patch: { title?: string; starred?: boolean; note?: string },
): boolean {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.starred !== undefined) {
    fields.push('starred = ?');
    values.push(patch.starred ? 1 : 0);
  }
  if (patch.note !== undefined) {
    fields.push('note = ?');
    values.push(patch.note);
  }
  if (fields.length === 0) return getConversation(db, id) !== null;
  const result = db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return Number(result.changes) === 1;
}

/** 删除会话，返回其中引用的图片文件名，供调用方删除文件。 */
export function deleteConversation(db: Db, id: string): string[] | null {
  const rows = db.prepare('SELECT images FROM messages WHERE conversation_id = ?').all(id) as unknown as {
    images: string;
  }[];
  const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  if (Number(result.changes) === 0) return null;
  return rows.flatMap((row) => JSON.parse(row.images) as string[]);
}

export function addMessage(
  db: Db,
  conversationId: string,
  message: Omit<Message, 'id' | 'createdAt'> & { id?: string },
  now = Date.now(),
): Message {
  const saved: Message = { ...message, id: message.id ?? newId(), createdAt: now };
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, images, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    saved.id,
    conversationId,
    saved.role,
    saved.content,
    JSON.stringify(saved.images),
    saved.status,
    saved.createdAt,
  );
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
  return saved;
}

/** 用第一个问题生成会话标题。 */
export function titleFrom(text: string, hasImage: boolean): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return hasImage ? '图片题目' : '新的题目';
  const chars = [...clean];
  return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : clean;
}
