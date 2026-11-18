import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCw, Shapes } from 'lucide-react';
import { api, generateScene } from '../api.ts';
import { ScenePlayer } from './ScenePlayer.tsx';
import type { PublicSettings, SceneRecord } from '../../../shared/types.ts';

/** 回答下方的"动画讲解"区域：没有剧本时显示生成按钮，有了就显示播放器。 */
export function SceneSection(props: {
  messageId: string;
  record: SceneRecord | undefined;
  settings: PublicSettings | null;
  onRecord: (record: SceneRecord) => void;
  onAsk?: (stepNo: number, stepText: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const onOpenChange = props.onOpenChange;
  const hasRecord = Boolean(props.record);
  useEffect(() => { onOpenChange?.(hasRecord && open); }, [onOpenChange, hasRecord, open]);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const justMade = useRef(false);
  const recordRef = useRef(props.record);
  const onRecordRef = useRef(props.onRecord);
  const startedRef = useRef(Date.now());
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  recordRef.current = props.record;
  onRecordRef.current = props.onRecord;

  const refresh = useCallback(async () => {
    const epoch = epochRef.current;
    const result = await api.sceneStatus(props.messageId);
    if (!mountedRef.current || epoch !== epochRef.current || abortRef.current) return;
    if (result.job) {
      setStatus(result.job.status === 'done' ? 'idle' : result.job.status);
      setProgress(result.job.message);
      setError(result.job.status === 'error' ? result.job.message : '');
      startedRef.current = result.job.startedAt;
    }
    if (result.record && result.record.id !== recordRef.current?.id) {
      recordRef.current = result.record;
      onRecordRef.current(result.record);
    }
  }, [props.messageId]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    // 刷新或切换题目后恢复服务器上的生成状态；同时兼容其他设备发起生成。
    const poll = () => {
      if (active && document.visibilityState !== 'hidden' && !abortRef.current) void refresh().catch(() => {});
    };
    poll();
    const timer = setInterval(poll, status === 'working' ? 3000 : 15000);
    window.addEventListener('focus', poll);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', poll); };
  }, [refresh, status]);

  useEffect(() => {
    if (props.record && justMade.current) {
      justMade.current = false;
      boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [props.record]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; abortRef.current?.abort(); };
  }, []);
  useEffect(() => {
    if (status !== 'working') return;
    const update = () => setElapsed(Math.max(0, Math.round((Date.now() - startedRef.current) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [status]);

  const run = async () => {
    if (abortRef.current || status === 'working') return;
    epochRef.current += 1;
    startedRef.current = Date.now();
    setStatus('working');
    setError('');
    setElapsed(0);
    setProgress('正在设计动画讲解…');
    const abort = new AbortController();
    abortRef.current = abort;
    let finished = false;
    try {
      await generateScene(
        props.messageId,
        (event) => {
          if (!mountedRef.current) return;
          if (event.type === 'progress') setProgress(event.message);
          if (event.type === 'error') {
            finished = true;
            setError(event.message);
            setStatus('error');
          }
          if (event.type === 'done') {
            finished = true;
            justMade.current = true;
            props.onRecord(event.record);
            setOpen(true);
            setStatus('idle');
          }
        },
        abort.signal,
      );
      if (!finished && !abort.signal.aborted) {
        setError('连接中断，正在尝试恢复生成进度');
        setStatus('error');
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    } finally {
      abortRef.current = null;
      if (mountedRef.current) void refresh().catch(() => {});
    }
  };

  const tts = props.settings?.tts ?? { rate: 1, voice: '' };

  return (
    <div className="scene-section" ref={boxRef}>
      {status === 'working' && (
        <div className="scene-working" role="status">
          <span className="spinner" />
          <span>{progress}<span className="muted small scene-wait-hint">已等待 {elapsed} 秒 · 可以先看其他题，完成后会自动保存</span></span>
        </div>
      )}
      {status === 'error' && (
        <div className="scene-error" role="alert">
          <p className="error-text small">{props.record ? '重新生成失败，已保留原来的动画。' : ''}{error}</p>
          <button className="btn" onClick={run}>重试生成</button>
        </div>
      )}
      {props.record ? <>
        <div className="scene-section-head">
          <button className="msg-action" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            {open ? '收起动画讲解' : '展开动画讲解'}
          </button>
          <button className="msg-action" onClick={run} disabled={status === 'working'} title="重新生成动画讲解">
            <RotateCw size={13} aria-hidden="true" />
            重新生成
          </button>
        </div>
        {open && <ScenePlayer scene={props.record.scene} tts={tts} verified={props.record.verified} onAsk={props.onAsk} />}
        {open && !props.record.verified && props.record.problems.length > 0 && (
          <details className="scene-problems">
            <summary>验算未通过的地方</summary>
            <ul>
              {props.record.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </details>
        )}
      </> : status === 'idle' && (
        <button className="btn scene-btn" onClick={run} aria-label="生成动画讲解">
          <Shapes size={16} aria-hidden="true" />
          生成动画讲解
        </button>
      )}
    </div>
  );
}
