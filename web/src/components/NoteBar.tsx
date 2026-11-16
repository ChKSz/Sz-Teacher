import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { ConversationUpdate, ReviewStatus } from '../../../shared/types.ts';
import { Select } from './Select.tsx';

/** 错题笔记：显示在题目上方，可以记录错因和要点。 */
export function NoteBar(props: {
  note: string;
  editing: boolean;
  knowledgePoint: string;
  errorReason: string;
  reviewStatus: ReviewStatus;
  onEdit: () => void;
  onSave: (patch: ConversationUpdate) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.note);
  const [knowledgePoint, setKnowledgePoint] = useState(props.knowledgePoint);
  const [errorReason, setErrorReason] = useState(props.errorReason);
  const [reviewStatus, setReviewStatus] = useState(props.reviewStatus);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(props.note);
    setKnowledgePoint(props.knowledgePoint);
    setErrorReason(props.errorReason);
    setReviewStatus(props.reviewStatus);
  }, [props.editing, props.note, props.knowledgePoint, props.errorReason, props.reviewStatus]);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { await props.onSave({ note: draft.trim(), knowledgePoint: knowledgePoint.trim(), errorReason: errorReason.trim(), reviewStatus }); }
    finally { setSaving(false); }
  };
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
        <span className="note-label">
          <NotebookPen size={14} aria-hidden="true" />
          笔记
        </span>
        <span className="note-text">{props.note || '记录这道题的错因和要点'}</span>
        <span className="note-meta">{[props.knowledgePoint, props.errorReason, props.reviewStatus === 'mastered' ? '已掌握' : '待复习'].filter(Boolean).join(' · ')}</span>
      </div>
    );
  }
  return (
    <div className="note-bar editing">
      <div className="review-fields">
        <label>知识点<input value={knowledgePoint} maxLength={100} onChange={(e) => setKnowledgePoint(e.target.value)} placeholder="例如：等腰三角形" /></label>
        <label>错因<input value={errorReason} maxLength={100} onChange={(e) => setErrorReason(e.target.value)} placeholder="例如：漏掉分类讨论" /></label>
        <label>复习状态<Select label="复习状态" value={reviewStatus} onChange={(value) => setReviewStatus(value as ReviewStatus)} options={[{ value: 'pending', label: '待复习' }, { value: 'mastered', label: '已掌握' }]} /></label>
      </div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="记下错因和要点，比如：漏了 P 与 B 重合的情况；等腰要分三种情况讨论"
        rows={3}
        aria-label="错题笔记"
      />
      <div className="row">
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存笔记'}
        </button>
        <button className="btn" onClick={props.onCancel} disabled={saving}>
          取消
        </button>
        <span className="muted small">保存后会加入错题本；已掌握的题仍会保留</span>
      </div>
    </div>
  );
}
