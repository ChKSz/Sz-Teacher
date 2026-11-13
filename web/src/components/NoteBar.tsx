import { useState } from 'react';

/** 错题笔记：显示在题目上方，可以记录错因和要点。 */
export function NoteBar(props: {
  note: string;
  editing: boolean;
  onEdit: () => void;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.note);
  if (!props.editing) {
    return (
      <div
        className="note-bar"
        onClick={props.onEdit}
        onKeyDown={(e) => e.key === 'Enter' && props.onEdit()}
        role="button"
        tabIndex={0}
        title="点击编辑"
      >
        <span className="note-label">📝 笔记</span>
        <span className="note-text">{props.note}</span>
      </div>
    );
  }
  return (
    <div className="note-bar editing">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="记下错因和要点，比如：漏了 P 与 B 重合的情况；等腰要分三种情况讨论"
        rows={3}
        aria-label="错题笔记"
      />
      <div className="row">
        <button className="btn primary" onClick={() => props.onSave(draft.trim())}>
          保存笔记
        </button>
        <button className="btn" onClick={props.onCancel}>
          取消
        </button>
        <span className="muted small">保存非空笔记时会自动加入错题本</span>
      </div>
    </div>
  );
}
