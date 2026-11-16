import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, Shapes, Square, Volume2 } from 'lucide-react';
import { Logo } from './Logo.tsx';
import { renderMarkdown, toSpeechText } from '../markdown.ts';
import { speak, speechSupported } from '../speech.ts';
import { SceneSection } from '../scene/SceneSection.tsx';
import { usePreparedSpeech } from '../usePreparedSpeech.ts';
import { CopyButton } from './CopyButton.tsx';
import type { Message, PublicSettings, SceneRecord } from '../../../shared/types.ts';

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});

function SpeakButton({ text, settings }: { text: string; settings: PublicSettings | null }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const options = settings?.tts ?? { rate: 1, voice: '' };
  const spokenText = useMemo(() => toSpeechText(text), [text]);
  const prepared = usePreparedSpeech([spokenText], options);
  useEffect(() => { setPlaying(false); setError(''); return () => abortRef.current?.abort(); }, [prepared.key]);
  if (!speechSupported(settings?.tts)) return null;
  const toggle = async () => {
    if (playing) { abortRef.current?.abort(); setPlaying(false); return; }
    const abort = new AbortController(); abortRef.current = abort;
    setPlaying(true); setError('');
    try {
      const handle = await speak(spokenText, options, abort.signal, prepared.clips[0]);
      await handle.finished;
    } catch (err) { if (!abort.signal.aborted) setError((err as Error).message); }
    finally { if (abortRef.current === abort) setPlaying(false); }
  };
  return <>
    <button className="msg-action" disabled={!prepared.ready} title={prepared.preparing ? '正在准备完整音频，完成后即可朗读' : undefined} onClick={() => void toggle()}>
      {playing ? <Square size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      {playing ? '停止朗读' : prepared.preparing ? '语音准备中…' : '朗读'}
    </button>
    {(error || prepared.error) && <span className="error-text speech-error" role="alert">{error || prepared.error}<button className="link-btn" onClick={() => { setError(''); prepared.retry(); }}>重新准备语音</button></span>}
  </>;
}

/** 学生在动画讲解某一步点"这步没懂"时发出的追问。 */
export function stepQuestion(stepNo: number, stepText: string): string {
  const quoted = stepText.replace(/\s*\n\s*/g, ' ').trim();
  return `关于动画讲解的第 ${stepNo} 步：\n> ${quoted}\n\n这一步我没看懂，能换个方式再讲讲吗？`;
}

function MessageItem({
  message,
  settings,
  onScene,
  onAsk,
  sceneable,
  onRetry,
  busy,
}: {
  message: Message;
  settings: PublicSettings | null;
  onScene: (messageId: string, record: SceneRecord) => void;
  onAsk?: (text: string) => void;
  /** 是否提供"生成动画讲解"（首个完整解答或较长的回答）。 */
  sceneable: boolean;
  onRetry?: () => void;
  busy: boolean;
}) {
  const actions = <>
    <button className="msg-action" disabled={busy || !onRetry} onClick={onRetry} title="使用原问题和图片重新请求"><RotateCw size={14} aria-hidden="true" />重试请求</button>
    <CopyButton text={message.content} />
  </>;
  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          {message.images.length > 0 && (
            <div className="msg-images">
              {message.images.map((name) => (
                <a key={name} href={`/api/uploads/${name}`} target="_blank" rel="noreferrer">
                  <img src={`/api/uploads/${name}`} alt="题目图片" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {message.content &&
            (/[$>*]|\\[([]/.test(message.content) ? (
              <div className="user-text user-md">
                <Markdown text={message.content} />
              </div>
            ) : (
              <div className="user-text">{message.content}</div>
            ))}
          <div className="msg-actions">{actions}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`msg assistant ${message.status === 'error' ? 'is-error' : ''}`}>
      <div className="avatar"><Logo size={30} /></div>
      <div className="bubble">
        <Markdown text={message.content} />
        <div className="msg-actions">
          <SpeakButton text={message.content} settings={settings} />
          {actions}
        </div>
        {message.status === 'done' && (sceneable || message.scene) && (
          <SceneSection
            messageId={message.id}
            record={message.scene}
            settings={settings}
            onRecord={(record) => onScene(message.id, record)}
            onAsk={onAsk ? (no, text) => onAsk(stepQuestion(no, text)) : undefined}
          />
        )}
      </div>
    </div>
  );
}

export function ChatView(props: {
  messages: Message[];
  streaming: { id: string; text: string } | null;
  settings: PublicSettings | null;
  providerReady: boolean;
  onNeedSettings: () => void;
  onScene: (messageId: string, record: SceneRecord) => void;
  onAsk?: (text: string) => void;
  onRetry: (userMessageId: string) => void;
  onDemo: () => void;
  busy: boolean;
  onDraft: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [props.messages, props.streaming?.text]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (props.messages.length === 0 && !props.streaming) {
    return (
      <div className="chat-scroll" ref={scrollerRef}>
        <div className="welcome">
          <Logo size={48} />
          <h2>今天想弄懂哪道题？</h2>
          <p className="welcome-sub">输入题目，或者拍照上传。动点、几何、函数都可以问。</p>
          {!props.providerReady && (
            <p className="notice warn">
              还没有配置模型供应商，<button className="link-btn" onClick={props.onNeedSettings}>去设置</button>
            </p>
          )}
          <button className="link-btn demo-link" onClick={props.onDemo}>
            <Shapes size={15} aria-hidden="true" />
            先看看示例讲解
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll" ref={scrollerRef} onScroll={onScroll}>
      <div className="chat-inner">
        {props.messages.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            settings={props.settings}
            onScene={props.onScene}
            onAsk={props.busy ? undefined : props.onAsk}
            busy={props.busy}
            onRetry={props.messages.slice(0, i + 1).some((item) => item.role === 'user') ? () => props.onRetry(props.messages.slice(0, i + 1).findLast((item) => item.role === 'user')!.id) : undefined}
            sceneable={m.role === 'assistant' && (props.messages.findIndex((x) => x.role === 'assistant') === i || m.content.length > 600)}
          />
        ))}
        {!props.busy && props.messages.some((m) => m.role === 'assistant' && m.status === 'done') && (
          <div className="quick-questions" aria-label="快捷追问">
            <button className="btn" onClick={() => props.onAsk?.('请换一种更容易理解的方式讲解，重点说明关键步骤。')}>换种讲法</button>
            <button className="btn" onClick={() => props.onAsk?.('请只给我下一条提示，暂时不要公布完整答案，让我自己试试。')}>给我提示</button>
            <button className="btn" onClick={() => props.onDraft('请检查我的解法，指出有问题的步骤。我的解法是：\n')}>检查我的解法</button>
          </div>
        )}
        {props.streaming && (
          <div className="msg assistant streaming">
            <div className="avatar"><Logo size={30} /></div>
            <div className="bubble">
              {props.streaming.text ? (
                <Markdown text={props.streaming.text} />
              ) : (
                <div className="thinking">
                  <span />
                  <span />
                  <span />
                  <em>正在思考…</em>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
