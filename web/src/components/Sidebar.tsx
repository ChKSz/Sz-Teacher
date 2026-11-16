import { useState } from 'react';
import { Check, PanelLeftClose, Pencil, Plus, Search, Shapes, Star, Trash2, X } from 'lucide-react';
import { Select } from './Select.tsx';
import { Logo } from './Logo.tsx';
import type { ConversationSummary } from '../../../shared/types.ts';

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, '0');
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 按时间分组：今天 / 最近 7 天 / 更早。 */
function groupOf(ms: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) return '今天';
  if (ms >= startOfToday - 6 * 86400_000) return '最近 7 天';
  return '更早';
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
  onClose: () => void;
  onCollapse: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'starred'>('all');
  const [query, setQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [knowledgeFilter, setKnowledgeFilter] = useState('');
  const knowledgePoints = [...new Set(props.conversations.filter((c) => c.starred).map((c) => c.knowledgePoint).filter(Boolean))];
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const q = query.trim().toLowerCase();
  const shown = props.conversations.filter(
    (c) => (filter === 'all' || (c.starred && (reviewFilter === 'all' || c.reviewStatus === reviewFilter) && (!knowledgeFilter || c.knowledgePoint === knowledgeFilter)))
      && (!q || [c.title, c.note, c.knowledgePoint, c.errorReason].some((value) => value.toLowerCase().includes(q))),
  );
  const starredCount = props.conversations.filter((c) => c.starred).length;

  const commitRename = () => {
    if (!editing) return;
    const title = editing.title.trim();
    const original = props.conversations.find((c) => c.id === editing.id)?.title;
    if (title && title !== original) props.onRename(editing.id, title);
    setEditing(null);
  };

  let lastGroup = '';
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Logo size={26} />
        <span className="brand">Sz-Teacher</span>
        <button className="icon-btn desktop-only" onClick={props.onCollapse} aria-label="收起侧边栏" title="收起侧边栏"><PanelLeftClose size={17} /></button>
        <button className="icon-btn mobile-only" onClick={props.onClose} aria-label="关闭题目列表">
          <X size={18} />
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="btn primary block new-btn" onClick={props.onNew} disabled={props.disabled}>
          <Plus size={16} aria-hidden="true" />
          新题目
        </button>
        <button className={`nav-btn ${props.demoActive ? 'active' : ''}`} onClick={props.onDemo} disabled={props.disabled}>
          <Shapes size={16} aria-hidden="true" />
          示例讲解
        </button>
      </div>

      <div className="segmented conv-filter" role="tablist">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} role="tab" aria-selected={filter === 'all'}>
          全部
        </button>
        <button className={filter === 'starred' ? 'active' : ''} onClick={() => setFilter('starred')} role="tab" aria-selected={filter === 'starred'}>
          错题本
          {starredCount > 0 && <span className="count">{starredCount}</span>}
        </button>
      </div>

      {props.conversations.length > 0 && (
        <label className="conv-search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索题目、知识点或错因" aria-label="搜索题目" />
        </label>
      )}
      {filter === 'starred' && starredCount > 0 && (
        <div className="review-filters">
          <Select label="筛选复习状态" value={reviewFilter} onChange={setReviewFilter} options={[{ value: 'all', label: '全部状态' }, { value: 'pending', label: '待复习' }, { value: 'mastered', label: '已掌握' }]} />
          <Select label="筛选知识点" value={knowledgeFilter} onChange={setKnowledgeFilter} options={[{ value: '', label: '全部知识点' }, ...knowledgePoints.map((value) => ({ value, label: value }))]} />
        </div>
      )}

      <nav className="conv-list" aria-label="题目列表">
        {shown.length === 0 && (
          <p className="conv-empty">
            {q || (filter === 'starred' && (reviewFilter !== 'all' || knowledgeFilter)) ? '没有符合条件的题目，请调整搜索或筛选条件。' : filter === 'starred'
              ? '错题本是空的。做错或想复习的题，点题目右上角的星标收藏。'
              : '还没有记录'}
          </p>
        )}
        {shown.map((c) => {
          const group = filter === 'all' && !q ? groupOf(c.updatedAt) : '';
          const header = group && group !== lastGroup ? group : '';
          lastGroup = group;
          const isEditing = editing?.id === c.id;
          return (
            <div key={c.id}>
              {header && <div className="conv-group">{header}</div>}
              <div className={`conv-item ${c.id === props.currentId ? 'active' : ''}`}>
                {isEditing ? (
                  <form
                    className="conv-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commitRename();
                    }}
                  >
                    <input
                      autoFocus
                      value={editing.title}
                      onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                      onBlur={commitRename}
                      aria-label="新的标题"
                      maxLength={100}
                    />
                    <button className="icon-btn small" type="submit" aria-label="保存标题" onMouseDown={(e) => e.preventDefault()}>
                      <Check size={14} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button className="conv-main" onClick={() => props.onSelect(c.id)} disabled={props.disabled}>
                      <span className="conv-title">
                        {c.starred && <Star size={12} className="star-mark" aria-label="已收藏" />}
                        {c.title}
                      </span>
                      <span className="conv-time">{formatTime(c.updatedAt)}</span>
                      {c.sceneStatus && <span className={`conv-scene-status ${c.sceneStatus}`}>{c.sceneStatus === 'working' ? '动画生成中…' : c.sceneStatus === 'done' ? '动画已完成' : '动画生成失败'}</span>}
                      {filter === 'starred' && <span className="conv-review-status">{c.reviewStatus === 'mastered' ? '已掌握' : '待复习'}{c.knowledgePoint ? ` · ${c.knowledgePoint}` : ''}</span>}
                    </button>
                    <div className="conv-actions">
                      <button
                        className="icon-btn small"
                        title="重命名"
                        aria-label={`重命名 ${c.title}`}
                        onClick={() => setEditing({ id: c.id, title: c.title })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-btn small danger-hover"
                        title="删除"
                        aria-label={`删除 ${c.title}`}
                        onClick={() => props.onDelete(c.id)}
                        disabled={props.disabled}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
