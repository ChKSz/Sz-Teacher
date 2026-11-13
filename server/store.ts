import crypto from 'node:crypto';
import type { Db } from './db.ts';
import type { ConversationDetail, ConversationSummary, Message } from '../shared/types.ts';

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
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
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
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
    .prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
    .all() as unknown as ConversationRow[];
  return rows.map(toSummary);
}

export function getConversation(db: Db, id: string): ConversationDetail | null {
  const row = db.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?').get(id) as
    | ConversationRow
    | undefined;
  if (!row) return null;
  const messages = db
    .prepare(
      'SELECT id, role, content, images, status, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid',
    )
    .all(id) as unknown as MessageRow[];
  return { ...toSummary(row), messages: messages.map(toMessage) };
}

export function createConversation(db: Db, title: string, now = Date.now()): ConversationSummary {
  const id = newId();
  db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    title,
    now,
    now,
  );
  return { id, title, createdAt: now, updatedAt: now };
}

export function renameConversation(db: Db, id: string, title: string): boolean {
  const result = db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
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
