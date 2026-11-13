import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown, toSpeechText } from '../markdown.ts';
import { speak, speechSupported, type SpeakHandle } from '../speech.ts';
import { SceneSection } from '../scene/SceneSection.tsx';
import type { Message, PublicSettings, SceneRecord } from '../../../shared/types.ts';

const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
});

function SpeakButton({ text, settings }: { text: string; settings: PublicSettings | null }) {
  const [handle, setHandle] = useState<SpeakHandle | null>(null);
  useEffect(() => () => handle?.stop(), [handle]);
  if (!speechSupported()) return null;
  const toggle = async () => {
    if (handle) {
      handle.stop();
      setHandle(null);
      return;
    }
    try {
      const h = await speak(toSpeechText(text), settings?.tts ?? { rate: 1, voice: '' });
      setHandle(h);
      h.finished.then(() => setHandle((cur) => (cur === h ? null : cur)));
    } catch (err) {
      alert((err as Error).message);
    }
  };
  return (
    <button className="msg-action" onClick={toggle}>
      {handle ? '⏹ 停止朗读' : '🔊 朗读'}
    </button>
  );
}

function MessageItem({
  message,
  settings,
  onScene,
}: {
  message: Message;
  settings: PublicSettings | null;
  onScene: (messageId: string, record: SceneRecord) => void;
}) {
  const [copied, setCopied] = useState(false);
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
          {message.content && <div className="user-text">{message.content}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className={`msg assistant ${message.status === 'error' ? 'is-error' : ''}`}>
      <div className="avatar">📐</div>
      <div className="bubble">
        <Markdown text={message.content} />
        <div className="msg-actions">
          <SpeakButton text={message.content} settings={settings} />
          <button
            className="msg-action"
            onClick={() => {
              navigator.clipboard?.writeText(message.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? '✓ 已复制' : '📋 复制'}
          </button>
        </div>
        {message.status === 'done' && (
          <SceneSection
            messageId={message.id}
            record={message.scene}
            settings={settings}
            onRecord={(record) => onScene(message.id, record)}
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
          <div className="welcome-icon">📐</div>
          <h2>今天想弄懂哪道题？</h2>
          <p className="muted">输入题目，或者拍照上传。动点、几何、函数都可以问。</p>
          {!props.providerReady && (
            <p className="warn-text">
              还没有配置模型供应商，<button className="link-btn" onClick={props.onNeedSettings}>去设置</button>
            </p>
          )}
          <ul className="tips">
            <li>📷 拍题时尽量对准、拍清楚，一次拍一道题</li>
            <li>🧩 看不懂某一步，可以直接追问"第 3 步为什么这样作辅助线"</li>
            <li>🔊 每个回答下面都可以点"朗读"</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll" ref={scrollerRef} onScroll={onScroll}>
      <div className="chat-inner">
        {props.messages.map((m) => (
          <MessageItem key={m.id} message={m} settings={props.settings} onScene={props.onScene} />
        ))}
        {props.streaming && (
          <div className="msg assistant streaming">
            <div className="avatar">📐</div>
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
