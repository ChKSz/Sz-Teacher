import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** 复制原始内容，保留 Markdown 和 LaTeX；兼容未提供剪贴板接口的页面。 */
export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch { /* 尝试兼容模式。 */ }
      if (!copied) {
        const previous = document.activeElement as HTMLElement | null;
        const field = document.createElement('textarea');
        field.value = text; field.readOnly = true;
        field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
        document.body.append(field);
        try { field.select(); copied = document.execCommand('copy'); }
        finally { field.remove(); previous?.focus({ preventScroll: true }); }
      }
      setStatus(copied ? 'copied' : 'error');
    } catch { setStatus('error'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2000);
  };
  return <>
    <button className="msg-action" disabled={!text} onClick={() => void copy()} title={text ? '复制原始文字和公式' : '这条消息没有可复制的文字'}>
      {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {status === 'copied' ? '已复制' : '复制内容'}
    </button>
    {status === 'error' && <span className="error-text small" role="status">复制失败，请长按或选中文字复制</span>}
  </>;
}
