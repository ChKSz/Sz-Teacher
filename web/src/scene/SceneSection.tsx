import { useEffect, useRef, useState } from 'react';
import { generateScene } from '../api.ts';
import { ScenePlayer } from './ScenePlayer.tsx';
import type { PublicSettings, SceneRecord } from '../../../shared/types.ts';

/** 回答下方的"动画讲解"区域：没有剧本时显示生成按钮，有了就显示播放器。 */
export function SceneSection(props: {
  messageId: string;
  record: SceneRecord | undefined;
  settings: PublicSettings | null;
  onRecord: (record: SceneRecord) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const justMade = useRef(false);

  useEffect(() => {
    if (props.record && justMade.current) {
      justMade.current = false;
      boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [props.record]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (status !== 'working') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const run = async () => {
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
        setError('连接中断。服务器会继续生成，稍后刷新页面查看');
        setStatus('error');
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  const tts = props.settings?.tts ?? { rate: 1, voice: '' };

  if (props.record && status !== 'working') {
    return (
      <div className="scene-section" ref={boxRef}>
        <div className="scene-section-head">
          <button className="msg-action" onClick={() => setOpen(!open)}>
            {open ? '▾ 收起动画讲解' : '▸ 展开动画讲解'}
          </button>
          <button className="msg-action" onClick={run} title="重新生成动画讲解">
            ↻ 重新生成
          </button>
        </div>
        {open && <ScenePlayer scene={props.record.scene} tts={tts} verified={props.record.verified} />}
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
      </div>
    );
  }

  return (
    <div className="scene-section">
      {status === 'working' ? (
        <div className="scene-working" role="status">
          <span className="spinner" />
          <span>
            {progress}（{elapsed} 秒，通常需要 30~90 秒）
          </span>
        </div>
      ) : (
        <button className="btn scene-btn" onClick={run}>
          🎬 生成动画讲解
        </button>
      )}
      {status === 'error' && <p className="error-text small">{error}</p>}
    </div>
  );
}
