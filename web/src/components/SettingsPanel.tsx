import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import type { ThemeChoice } from '../theme.ts';
import { api } from '../api.ts';
import { chineseVoices, prepareSpeech, speak, speechSupported, unlockSpeech, type PreparedSpeech } from '../speech.ts';
import type { ProviderTestResult, PublicSettings, SettingsUpdate } from '../../../shared/types.ts';
import { Select } from './Select.tsx';
import { Range } from './Range.tsx';
import { EFFORT_OPTIONS, STYLE_OPTIONS, MIMO_VOICES } from '../../../shared/preferences.ts';

export function SettingsPanel(props: {
  onClose: () => void;
  initialTab?: 'learning' | 'advanced';
  onSaved: (settings: PublicSettings) => void;
  onLogout: () => void;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  askConfirm: (opts: { title: string; body?: ReactNode; confirmText?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<'learning' | 'advanced'>(props.initialTab ?? 'learning');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [solveModel, setSolveModel] = useState('');
  const [sceneModel, setSceneModel] = useState('');
  const [effort, setEffort] = useState<PublicSettings['reasoningEffort']>('');
  const [style, setStyle] = useState<PublicSettings['teachingStyle']>('direct');
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState('');
  const [tts, setTts] = useState<PublicSettings['tts'] | null>(null);
  const [ttsKey, setTtsKey] = useState('');
  const [fetching, setFetching] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewAbort = useRef<AbortController | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<ProviderTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        if (!s.provider.hasApiKey || !s.provider.baseUrl) setTab('advanced');
        setBaseUrl(s.provider.baseUrl);
        setSolveModel(s.solveModel);
        setSceneModel(s.sceneModel);
        setEffort(s.reasoningEffort);
        setStyle(s.teachingStyle);
        setRate(s.tts.rate);
        setVoice(s.tts.voice);
        setTts(s.tts);
        setModels(s.models);
      })
      .catch((err: Error) => setError(err.message));
    chineseVoices().then(setVoices);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !document.querySelector(':popover-open') && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  useEffect(() => () => previewAbort.current?.abort(), []);
  const fetchModels = async () => {
    setFetching(true); setError(''); setMessage(''); setTest(null);
    try {
      const saved = await api.fetchModels({ baseUrl, apiKey: apiKey.trim() || undefined });
      setSettings(saved); setModels(saved.models); setSolveModel(saved.solveModel); setSceneModel(saved.sceneModel);
      setBaseUrl(saved.provider.baseUrl); setApiKey(''); props.onSaved(saved);
      setMessage(`已获取 ${saved.models.length} 个模型，供应商与列表已保存到服务器`);
    } catch (err) { setError((err as Error).message); }
    finally { setFetching(false); }
  };

  const save = async (): Promise<PublicSettings | undefined> => {
    setSaving(true);
    setError('');
    setMessage('');
    const update: SettingsUpdate = {
      provider: { baseUrl, ...(apiKey.trim() ? { apiKey } : {}) },
      solveModel,
      sceneModel,
      reasoningEffort: effort,
      teachingStyle: style,
      tts: tts ? { provider: tts.provider, baseUrl: tts.baseUrl, model: tts.model, xiaomiVoice: tts.xiaomiVoice, style: tts.style, rate, voice, ...(ttsKey.trim() ? { apiKey: ttsKey } : {}) } : { rate, voice },
    };
    try {
      const saved = await api.saveSettings(update);
      setSettings(saved);
      setApiKey('');
      setTtsKey(''); setTts(saved.tts); setModels(saved.models);
      props.onSaved(saved);
      setMessage('已保存');
      return saved;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (previewing) { previewAbort.current?.abort(); setPreviewing(false); return; }
    const abort = new AbortController(); previewAbort.current = abort;
    setPreviewing(true); setError('');
    let clips: (PreparedSpeech | null)[] = [];
    try {
      // 点击时先解锁音频；保存成功后按服务器上的同一配置试听。
      if (tts?.provider === 'xiaomi') unlockSpeech();
      const saved = await save();
      if (!saved || abort.signal.aborted) return;
      const text = '我们来看这道题。点P从点A出发，每秒移动两个单位。';
      if (saved.tts.provider === 'xiaomi') clips = await prepareSpeech([text], abort.signal);
      if (abort.signal.aborted) return;
      const handle = await speak(text, saved.tts, abort.signal, clips[0]);
      await handle.finished;
    } catch (err) { if (!abort.signal.aborted) setError((err as Error).message); }
    finally { clips.forEach((clip) => clip?.dispose()); if (previewAbort.current === abort) setPreviewing(false); }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const result = await api.testProvider({ baseUrl, apiKey: apiKey.trim() || undefined, model: solveModel });
      setTest(result);
    } catch (err) {
      setTest({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const changePassword = async () => {
    setError('');
    setMessage('');
    if (pw.next !== pw.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setMessage('密码已修改，其他设备需要重新登录');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const logoutAll = async () => {
    const ok = await props.askConfirm({
      title: '退出所有设备？',
      body: '包括当前设备在内，所有已登录的设备都需要重新输入密码。',
      confirmText: '全部退出',
      danger: true,
    });
    if (!ok) return;
    await api.logoutAll().catch(() => {});
    props.onLogout();
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-label="设置" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>设置</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="关闭设置">
            <X size={18} />
          </button>
        </header>
        <div className="segmented settings-tabs" role="tablist" aria-label="设置分类">
          <button role="tab" aria-selected={tab === 'learning'} className={tab === 'learning' ? 'active' : ''} onClick={() => setTab('learning')}>学习设置</button>
          <button role="tab" aria-selected={tab === 'advanced'} className={tab === 'advanced' ? 'active' : ''} onClick={() => setTab('advanced')}>高级配置</button>
        </div>
        {!settings ? (
          <div className="modal-body muted">{error || '加载中…'}</div>
        ) : (
          <div className="modal-body">
            <section hidden={tab !== 'learning'}>
              <h3>外观</h3>
              <div className="segmented theme-switch" role="radiogroup" aria-label="外观">
                {(
                  [
                    ['light', '浅色', <Sun key="i" size={15} aria-hidden="true" />],
                    ['dark', '深色', <Moon key="i" size={15} aria-hidden="true" />],
                    ['system', '跟随系统', <Monitor key="i" size={15} aria-hidden="true" />],
                  ] as const
                ).map(([value, label, icon]) => (
                  <button
                    key={value}
                    className={props.theme === value ? 'active' : ''}
                    onClick={() => props.onTheme(value)}
                    role="radio"
                    aria-checked={props.theme === value}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
              <p className="hint">只保存在这台设备上，立即生效。</p>
            </section>

            <section hidden={tab !== 'advanced'}>
              <h3>模型供应商</h3>
              <p className="hint">填写地址与密钥后获取模型。日常可在输入框中切换模型、思考强度和讲解方式。</p>
              <label>
                接口地址（Base URL）
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
              </label>
              <label>
                接口密钥（API Key）
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.provider.hasApiKey ? `已保存 ${settings.provider.apiKeyMasked}，留空不修改` : '未设置'}
                  autoComplete="off"
                />
              </label>
              <button className="btn" onClick={fetchModels} disabled={fetching || saving || !baseUrl.trim()}>{fetching ? '获取中…' : '获取模型列表'}</button>
              <p className="hint">获取成功后，地址、密钥和模型列表会保存到服务器。</p>
              <label>解题模型<Select label="解题模型" value={solveModel} options={[...new Set([solveModel, ...models].filter(Boolean))].map((m) => ({ value: m, label: m }))} onChange={setSolveModel} placeholder="请先获取模型列表" /></label>
              <label>
                <span>
                  讲解剧本模型 <span className="muted">· 生成动画讲解用</span>
                </span>
                <Select label="讲解剧本模型" value={sceneModel} options={[...new Set([sceneModel, ...models].filter(Boolean))].map((m) => ({ value: m, label: m }))} onChange={setSceneModel} placeholder="请先获取模型列表" />
              </label>
              <label>
                思考强度
                <Select label="思考强度" value={effort} options={EFFORT_OPTIONS} onChange={(value) => setEffort(value as typeof effort)} />
              </label>
              <div className="row">
                <button className="btn" onClick={runTest} disabled={testing}>
                  {testing ? '测试中…' : '测试连接'}
                </button>
                {test && <span className={test.ok ? 'ok-text' : 'error-text'}>{test.message}</span>}
              </div>
            </section>

            <section hidden={tab !== 'learning'}>
              <h3>讲解</h3>
              <label>
                讲解风格
                <Select label="讲解风格" value={style} options={STYLE_OPTIONS} onChange={(value) => setStyle(value as typeof style)} />
              </label>
            </section>

            <section hidden={tab !== 'learning'}>
              <h3>朗读</h3>
              {tts && <label>朗读来源<Select label="朗读来源" value={tts.provider} options={[{ value: 'browser', label: '浏览器语音', description: '使用当前设备的声音' }, { value: 'xiaomi', label: '小米 MiMo', description: '使用小米语音模型，需要填写密钥' }]} onChange={(value) => { previewAbort.current?.abort(); setPreviewing(false); setTts({ ...tts, provider: value as 'browser' | 'xiaomi' }); }} /></label>}
              {tts?.provider === 'xiaomi' && <div className="tts-config">
                <label>小米语音接口地址<input value={tts.baseUrl} onChange={(e) => setTts({ ...tts, baseUrl: e.target.value })} /></label>
                <label>小米语音密钥<input type="password" autoComplete="off" value={ttsKey} onChange={(e) => setTtsKey(e.target.value)} placeholder={tts.hasApiKey ? `已保存 ${tts.apiKeyMasked}，留空不修改` : '填写小米开放平台 API Key'} /></label>
                <label>语音模型<input value={tts.model} onChange={(e) => setTts({ ...tts, model: e.target.value })} /></label>
                <label>小米音色<Select label="小米音色" value={tts.xiaomiVoice} options={MIMO_VOICES} onChange={(value) => setTts({ ...tts, xiaomiVoice: value })} /></label>
                <label>声音风格<textarea rows={2} value={tts.style} onChange={(e) => setTts({ ...tts, style: e.target.value })} /></label>
                <p className="hint">密钥只保存在服务器。正文朗读、动画讲解和试听共用此配置。</p>
              </div>}
              {!speechSupported(tts ?? undefined) ? (
                <p className="muted">这个浏览器不支持朗读。</p>
              ) : (
                <>
                  <label>
                    语速：{rate.toFixed(1)}
                    <Range
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                    />
                  </label>
                  {tts?.provider !== 'xiaomi' && <label>
                    声音
                    <Select label="声音" value={voice} options={[{ value: '', label: '自动选择' }, ...voices.map((v) => ({ value: v.voiceURI, label: v.name }))]} onChange={setVoice} />
                  </label>}
                  <button
                    className="btn"
                    onClick={() => void preview()} disabled={saving || fetching}
                  >
                    {previewing ? '停止试听' : '保存并试听'}
                  </button>
                  {tts?.provider !== 'xiaomi' && <p className="hint">每台设备可用的声音不同；找不到已选声音时会自动选择。</p>}
                </>
              )}
            </section>

            <div className="row sticky-save">
              <button className="btn primary" onClick={() => void save()} disabled={saving || fetching}>
                {saving ? '保存中…' : '保存设置'}
              </button>
              {message && <span className="ok-text">{message}</span>}
              {error && <span className="error-text">{error}</span>}
            </div>

            <section hidden={tab !== 'advanced'}>
              <h3>账号</h3>
              <label>
                当前密码
                <input
                  type="password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                  autoComplete="current-password"
                />
              </label>
              <label>
                新密码
                <input
                  type="password"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                  autoComplete="new-password"
                />
              </label>
              <label>
                再输入一次新密码
                <input
                  type="password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  autoComplete="new-password"
                />
              </label>
              <div className="row">
                <button className="btn" onClick={changePassword} disabled={!pw.current || !pw.next}>
                  修改密码
                </button>
                <button className="btn" onClick={props.onLogout}>
                  退出登录
                </button>
                <button className="btn danger" onClick={logoutAll}>
                  退出所有设备
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
