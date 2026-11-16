import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Menu, NotebookPen, PanelLeftOpen, Settings, Star, X } from 'lucide-react';
import { api, sendChat } from '../api.ts';
import { Sidebar } from './Sidebar.tsx';
import { ChatView } from './ChatView.tsx';
import { Composer, type ComposerHandle } from './Composer.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { DemoGallery } from '../scene/DemoGallery.tsx';
import { NoteBar } from './NoteBar.tsx';
import { useConfirm } from './ConfirmDialog.tsx';
import type { ThemeChoice } from '../theme.ts';
import type { ConversationDetail, ConversationSummary, ConversationUpdate, Message, PublicSettings, SettingsUpdate } from '../../../shared/types.ts';

/** 当前会话 ID 保存在地址栏 #c=<id>，刷新和分享链接后仍能回到同一道题。 */
function readHashId(): string {
  return new URLSearchParams(location.hash.slice(1)).get('c') ?? '';
}
function writeHashId(id: string): void {
  const next = id ? `#c=${id}` : '';
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
}

export function MainScreen({
  onLoggedOut,
  theme,
  onTheme,
}: {
  onLoggedOut: () => void;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<ConversationDetail | null>(null);
  const [currentId, setCurrentId] = useState(readHashId);
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'learning' | 'advanced'>('learning');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sz-sidebar-collapsed') === 'true');
  const toggleSidebar = () => setSidebarCollapsed((value) => { localStorage.setItem('sz-sidebar-collapsed', String(!value)); return !value; });
  const [showDemo, setShowDemo] = useState(() => location.hash === '#demo');
  const [showNote, setShowNote] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [confirmDialog, askConfirm] = useConfirm();
  const mainRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 顶栏和输入框浮在内容上方（毛玻璃效果），内容区据此留出上下空白
  useLayoutEffect(() => {
    const main = mainRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!main || !top || !bottom) return;
    const update = () => {
      main.style.setProperty('--top-h', `${top.offsetHeight}px`);
      main.style.setProperty('--bottom-h', `${bottom.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(top);
    ro.observe(bottom);
    return () => ro.disconnect();
  }, []);

  const loadList = useCallback(() => {
    api.conversations().then(setConversations).catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    loadList();
    api.settings().then(setSettings).catch(() => {});
    const poll = () => { if (document.visibilityState !== 'hidden') loadList(); };
    const timer = setInterval(poll, 5000);
    window.addEventListener('focus', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); };
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
    if (abortRef.current) return;
    setError('');
    setCurrentId(id);
    setShowDemo(false);
    setShowNote(false);
    setSidebarOpen(false);
  };

  const send = async (text: string, images: string[], retryMessageId?: string) => {
    if (abortRef.current) throw new Error('上一条消息还在生成，请稍候');
    if (currentId && current?.id !== currentId) throw new Error('题目正在加载，请稍候');
    setError('');
    setSending(true);
    const abort = new AbortController();
    abortRef.current = abort;
    let conversationId = current?.id;
    try {
      await sendChat(
        { conversationId, text, images, retryMessageId },
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
                        knowledgePoint: '',
                        errorReason: '',
                        reviewStatus: 'pending',
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
      setSending(false);
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
    const title = conversations.find((c) => c.id === id)?.title;
    const ok = await askConfirm({
      title: '删除这道题？',
      body: <>「{title}」的全部对话、动画讲解和笔记都会被删除，无法恢复。</>,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteConversation(id);
      if (id === currentId) setCurrentId('');
      loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const patchConversation = async (id: string, patch: ConversationUpdate): Promise<boolean> => {
    try {
      await api.updateConversation(id, patch);
      setCurrent((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };
  const rename = (id: string, title: string) => patchConversation(id, { title });

  const changePreferences = async (patch: SettingsUpdate): Promise<boolean> => {
    if (styleBusy) return false;
    setStyleBusy(true);
    try { setSettings(await api.saveSettings(patch)); return true; }
    catch (err) { setError((err as Error).message); return false; }
    finally { setStyleBusy(false); }
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    onLoggedOut();
  };

  return (
    <div className={`layout ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        disabled={sending}
        onSelect={select}
        onNew={() => select('')}
        onDelete={remove}
        onRename={rename}
        onDemo={() => {
          setShowDemo(true);
          setSidebarOpen(false);
        }}
        demoActive={showDemo}
        onClose={() => setSidebarOpen(false)}
        onCollapse={toggleSidebar}
      />
      <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      <main className="main" ref={mainRef}>
        <div className="top-stack" ref={topRef}>
        <header className="topbar">
          {sidebarCollapsed && <button className="icon-btn desktop-only" onClick={toggleSidebar} aria-label="展开侧边栏" title="展开侧边栏"><PanelLeftOpen size={18} /></button>}
          <button className="icon-btn mobile-only" onClick={() => setSidebarOpen(true)} aria-label="打开题目列表">
            <Menu size={18} />
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
                <Star size={18} fill={current.starred ? 'currentColor' : 'none'} />
              </button>
              <button
                className={`icon-btn ${showNote ? 'active' : ''}`}
                onClick={() => setShowNote(!showNote)}
                aria-label="错题笔记"
                title="错题笔记"
              >
                <NotebookPen size={18} />
              </button>
            </>
          )}
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="设置" title="设置">
            <Settings size={18} />
          </button>
        </header>
        {!showDemo && current && (showNote || current.note || current.starred) && (
          <NoteBar
            key={current.id}
            note={current.note}
            knowledgePoint={current.knowledgePoint}
            errorReason={current.errorReason}
            reviewStatus={current.reviewStatus}
            editing={showNote}
            onEdit={() => setShowNote(true)}
            onSave={async (patch) => {
              const saved = await patchConversation(current.id, { ...patch, starred: true });
              if (saved) setShowNote(false);
              return saved;
            }}
            onCancel={() => setShowNote(false)}
          />
        )}
        </div>
        {showDemo ? (
          <DemoGallery tts={settings?.tts ?? { rate: 1, voice: '' }} onClose={() => setShowDemo(false)} />
        ) : (
          <ChatView
            messages={current?.messages ?? []}
            streaming={streaming}
            settings={settings}
            onNeedSettings={() => setShowSettings(true)}
            busy={sending}
            onRetry={(userMessageId) => { void send('', [], userMessageId).catch(() => {}); }}
            onDraft={(text) => composerRef.current?.insertText(text)}
            onAsk={(text) => {
              void send(text, []).catch(() => {});
            }}
            onScene={(messageId, record) =>
              setCurrent((prev) =>
                prev ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, scene: record } : m)) } : prev,
              )
            }
            onDemo={() => setShowDemo(true)}
            providerReady={settings ? settings.provider.hasApiKey && settings.provider.baseUrl !== '' : true}
          />
        )}
        <div className="bottom-stack" ref={bottomRef}>
        {error && (
          <div className="error-bar" role="alert">
            <span>{error}</span>
            <button className="icon-btn small" onClick={() => setError('')} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        )}
        {!showDemo && <Composer ref={composerRef} busy={sending} onSend={send} onStop={stop} isFollowUp={!!current} settings={settings} onPreferences={changePreferences} onSettings={() => { setSettingsTab('advanced'); setShowSettings(true); }} styleBusy={styleBusy || !settings} />}
        </div>
      </main>
      {showSettings && (
        <SettingsPanel
          initialTab={settingsTab}
          onClose={() => { setShowSettings(false); setSettingsTab('learning'); }}
          onSaved={setSettings}
          onLogout={logout}
          theme={theme}
          onTheme={onTheme}
          askConfirm={askConfirm}
        />
      )}
      {confirmDialog}
    </div>
  );
}
