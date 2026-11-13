import { useState } from 'react';
import type { ConversationSummary } from '../../../shared/types.ts';

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, '0');
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function Sidebar(props: {
  conversations: ConversationSummary[];
  currentId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDemo: () => void;
  demoActive: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'starred'>('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = props.conversations.filter(
    (c) => (filter === 'all' || c.starred) && (!q || c.title.toLowerCase().includes(q) || c.note.toLowerCase().includes(q)),
  );
  const starredCount = props.conversations.filter((c) => c.starred).length;
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">📐 Sz-Teacher</span>
      </div>
      <button className="btn primary new-btn" onClick={props.onNew} disabled={props.disabled}>
        ＋ 新题目
      </button>
      <button className={`btn demo-btn ${props.demoActive ? 'active' : ''}`} onClick={props.onDemo} disabled={props.disabled}>
        🎬 示例讲解
      </button>
      <div className="conv-filter" role="tablist">
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')} role="tab" aria-selected={filter === 'all'}>
          全部
        </button>
        <button className={`chip ${filter === 'starred' ? 'active' : ''}`} onClick={() => setFilter('starred')} role="tab" aria-selected={filter === 'starred'}>
          ★ 错题本{starredCount ? ` ${starredCount}` : ''}
        </button>
      </div>
      {props.conversations.length > 6 && (
        <input className="conv-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索题目或笔记" aria-label="搜索题目" />
      )}
      <nav className="conv-list" aria-label="题目列表">
        {shown.length === 0 && (
          <p className="muted small pad">
            {filter === 'starred' ? '错题本是空的。做错或想复习的题，点题目右上角的 ☆ 收藏。' : q ? '没有找到' : '还没有记录'}
          </p>
        )}
        {shown.map((c) => (
          <div key={c.id} className={`conv-item ${c.id === props.currentId ? 'active' : ''}`}>
            <button className="conv-main" onClick={() => props.onSelect(c.id)} disabled={props.disabled}>
              <span className="conv-title">
                {c.starred && <span className="star-mark">★ </span>}
                {c.title}
              </span>
              <span className="conv-time">{formatTime(c.updatedAt)}</span>
            </button>
            <div className="conv-actions">
              <button
                className="icon-btn small"
                title="重命名"
                aria-label={`重命名 ${c.title}`}
                onClick={() => {
                  const title = prompt('新的标题', c.title)?.trim();
                  if (title) props.onRename(c.id, title);
                }}
              >
                ✎
              </button>
              <button
                className="icon-btn small"
                title="删除"
                aria-label={`删除 ${c.title}`}
                onClick={() => props.onDelete(c.id)}
                disabled={props.disabled}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
