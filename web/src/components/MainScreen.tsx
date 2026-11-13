import { useCallback, useEffect, useRef, useState } from 'react';
import { api, sendChat } from '../api.ts';
import { Sidebar } from './Sidebar.tsx';
import { ChatView } from './ChatView.tsx';
import { Composer } from './Composer.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { DemoGallery } from '../scene/DemoGallery.tsx';
import { NoteBar } from './NoteBar.tsx';
import type { ConversationDetail, ConversationSummary, Message, PublicSettings } from '../../../shared/types.ts';

/** 当前会话 ID 保存在地址栏 #c=<id>，刷新和分享链接后仍能回到同一道题。 */
function readHashId(): string {
  return new URLSearchParams(location.hash.slice(1)).get('c') ?? '';
}
function writeHashId(id: string): void {
  const next = id ? `#c=${id}` : '';
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
}

export function MainScreen({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<ConversationDetail | null>(null);
  const [currentId, setCurrentId] = useState(readHashId);
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showDemo, setShowDemo] = useState(() => location.hash === '#demo');
  const [showNote, setShowNote] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadList = useCallback(() => {
    api.conversations().then(setConversations).catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    loadList();
    api.settings().then(setSettings).catch(() => {});
  }, [loadList]);

  useEffect(() => {
    if (showDemo) {
      if (location.hash !== '#demo') history.replaceState(null, '', '#demo');
      return;
    }
    writeHashId(currentId);
    if (!currentId) {
      setCurrent(null);
      return;
    }
    if (current?.id === currentId) return;
    let cancelled = false;
    api
      .conversation(currentId)
      .then((c) => !cancelled && setCurrent(c))
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setCurrentId('');
      });
    return () => {
      cancelled = true;
    };
    // 只在切换会话时加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, showDemo]);

  const select = (id: string) => {
    if (streaming) return;
    setError('');
    setCurrentId(id);
    setShowDemo(false);
    setShowNote(false);
    setSidebarOpen(false);
  };

  const send = async (text: string, images: string[]) => {
    setError('');
    const abort = new AbortController();
    abortRef.current = abort;
    let conversationId = current?.id;
    try {
      await sendChat(
        { conversationId, text, images },
        (event) => {
          switch (event.type) {
            case 'start': {
              conversationId = event.conversationId;
              setStreaming({ id: event.assistantMessageId, text: '' });
              setCurrent((prev) => {
                const base: ConversationDetail =
                  prev && prev.id === event.conversationId
                    ? prev
                    : {
                        id: event.conversationId,
                        title: '',
                        createdAt: event.userMessage.createdAt,
                        updatedAt: event.userMessage.createdAt,
                        starred: false,
                        note: '',
                        messages: [],
                      };
                return { ...base, messages: [...base.messages, event.userMessage] };
              });
              setCurrentId(event.conversationId);
              break;
            }
            case 'delta':
              setStreaming((s) => (s ? { ...s, text: s.text + event.text } : s));
              break;
            case 'error':
              setError(event.message);
              break;
            case 'done': {
              const message: Message = event.message;
              setCurrent((prev) =>
                prev ? { ...prev, title: event.title, messages: [...prev.messages, message] } : prev,
              );
              setStreaming(null);
              break;
            }
          }
        },
        abort.signal,
      );
    } catch (err) {
      setError((err as Error).message);
      // 服务器已保存的内容以数据库为准
      if (conversationId) api.conversation(conversationId).then(setCurrent).catch(() => {});
      throw err;
    } finally {
      setStreaming(null);
      abortRef.current = null;
      loadList();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    const id = current?.id;
    // 服务器会保存已生成的部分，稍后重新加载
    setTimeout(() => {
      if (id) api.conversation(id).then(setCurrent).catch(() => {});
    }, 800);
  };

  const remove = async (id: string) => {
    if (!confirm('确定删除这道题的全部记录吗？')) return;
    try {
      await api.deleteConversation(id);
      if (id === currentId) setCurrentId('');
      loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const patchConversation = async (id: string, patch: { title?: string; starred?: boolean; note?: string }) => {
    try {
      await api.updateConversation(id, patch);
      setCurrent((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const rename = (id: string, title: string) => patchConversation(id, { title });

  const logout = async () => {
    await api.logout().catch(() => {});
    onLoggedOut();
  };

  return (
    <div className={`layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        disabled={streaming !== null}
        onSelect={select}
        onNew={() => select('')}
        onDelete={remove}
        onRename={rename}
        onDemo={() => {
          setShowDemo(true);
          setSidebarOpen(false);
        }}
        demoActive={showDemo}
      />
      <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      <main className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setSidebarOpen(true)} aria-label="打开题目列表">
            ☰
          </button>
          <div className="topbar-title">{showDemo ? '示例讲解' : current?.title || '新的题目'}</div>
          {!showDemo && current && (
            <>
              <button
                className={`icon-btn star-btn ${current.starred ? 'on' : ''}`}
                onClick={() => void patchConversation(current.id, { starred: !current.starred })}
                aria-label={current.starred ? '移出错题本' : '加入错题本'}
                title={current.starred ? '移出错题本' : '加入错题本'}
              >
                {current.starred ? '★' : '☆'}
              </button>
              <button
                className={`icon-btn ${showNote ? 'active' : ''}`}
                onClick={() => setShowNote(!showNote)}
                aria-label="错题笔记"
                title="错题笔记"
              >
                📝
              </button>
            </>
          )}
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="设置" title="设置">
            ⚙
          </button>
        </header>
        {!showDemo && current && (showNote || current.note) && (
          <NoteBar
            key={current.id}
            note={current.note}
            editing={showNote}
            onEdit={() => setShowNote(true)}
            onSave={(note) => {
              void patchConversation(current.id, { note, ...(note && !current.starred ? { starred: true } : {}) });
              setShowNote(false);
            }}
            onCancel={() => setShowNote(false)}
          />
        )}
        {showDemo ? (
          <DemoGallery tts={settings?.tts ?? { rate: 1, voice: '' }} onClose={() => setShowDemo(false)} />
        ) : (
          <ChatView
            messages={current?.messages ?? []}
            streaming={streaming}
            settings={settings}
            onNeedSettings={() => setShowSettings(true)}
            onAsk={(text) => {
              void send(text, []).catch(() => {});
            }}
            onScene={(messageId, record) =>
              setCurrent((prev) =>
                prev ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, scene: record } : m)) } : prev,
              )
            }
            providerReady={settings ? settings.provider.hasApiKey && settings.provider.baseUrl !== '' : true}
            />
        )}
        {error && (
          <div className="error-bar" role="alert">
            <span>{error}</span>
            <button className="icon-btn" onClick={() => setError('')} aria-label="关闭">
              ×
            </button>
          </div>
        )}
        {!showDemo && <Composer busy={streaming !== null} onSend={send} onStop={stop} isFollowUp={!!current} />}
      </main>
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onSaved={setSettings}
          onLogout={logout}
        />
      )}
    </div>
  );
}
