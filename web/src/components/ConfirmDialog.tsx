import { useCallback, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
}

/** 代替浏览器自带的 confirm()：样式统一，手机上也好点。 */
export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const ask = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = state ? (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div
        className="modal confirm-dialog"
        role="alertdialog"
        aria-label={state.opts.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close(false);
          }
        }}
      >
        <h2>{state.opts.title}</h2>
        {state.opts.body && <div className="confirm-body">{state.opts.body}</div>}
        <div className="confirm-actions">
          <button className="btn" onClick={() => close(false)}>
            取消
          </button>
          <button className={`btn ${state.opts.danger ? 'danger-solid' : 'primary'}`} onClick={() => close(true)} autoFocus>
            {state.opts.confirmText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return [dialog, ask];
}
