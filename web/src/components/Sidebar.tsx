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
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">📐 Sz-Teacher</span>
      </div>
      <button className="btn primary new-btn" onClick={props.onNew} disabled={props.disabled}>
        ＋ 新题目
      </button>
      <nav className="conv-list" aria-label="题目列表">
        {props.conversations.length === 0 && <p className="muted small pad">还没有记录</p>}
        {props.conversations.map((c) => (
          <div key={c.id} className={`conv-item ${c.id === props.currentId ? 'active' : ''}`}>
            <button className="conv-main" onClick={() => props.onSelect(c.id)} disabled={props.disabled}>
              <span className="conv-title">{c.title}</span>
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
