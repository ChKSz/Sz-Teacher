import { useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import type { ThemeChoice } from '../theme.ts';
import { api } from '../api.ts';
import { chineseVoices, speak, speechSupported } from '../speech.ts';
import type { ProviderTestResult, PublicSettings, SettingsUpdate } from '../../../shared/types.ts';

export function SettingsPanel(props: {
  onClose: () => void;
  onSaved: (settings: PublicSettings) => void;
  onLogout: () => void;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  askConfirm: (opts: { title: string; body?: ReactNode; confirmText?: string; danger?: boolean }) => Promise<boolean>;
}) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [solveModel, setSolveModel] = useState('');
  const [sceneModel, setSceneModel] = useState('');
  const [effort, setEffort] = useState<PublicSettings['reasoningEffort']>('');
  const [style, setStyle] = useState<PublicSettings['teachingStyle']>('direct');
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState('');
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
        setBaseUrl(s.provider.baseUrl);
        setSolveModel(s.solveModel);
        setSceneModel(s.sceneModel);
        setEffort(s.reasoningEffort);
        setStyle(s.teachingStyle);
        setRate(s.tts.rate);
        setVoice(s.tts.voice);
      })
      .catch((err: Error) => setError(err.message));
    chineseVoices().then(setVoices);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    const update: SettingsUpdate = {
      provider: { baseUrl, ...(apiKey.trim() ? { apiKey } : {}) },
      solveModel,
      sceneModel,
      reasoningEffort: effort,
      teachingStyle: style,
      tts: { rate, voice },
    };
    try {
      const saved = await api.saveSettings(update);
      setSettings(saved);
      setApiKey('');
      props.onSaved(saved);
      setMessage('已保存');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const result = await api.testProvider({ baseUrl, apiKey: apiKey.trim() || undefined, model: solveModel });
      setTest(result);
      if (result.models?.length) setModels(result.models);
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
        {!settings ? (
          <div className="modal-body muted">{error || '加载中…'}</div>
        ) : (
          <div className="modal-body">
            <section>
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

            <section>
              <h3>模型供应商</h3>
              <label>
                Base URL
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.provider.hasApiKey ? `已保存 ${settings.provider.apiKeyMasked}，留空不修改` : '未设置'}
                  autoComplete="off"
                />
              </label>
              <label>
                解题模型
                <input value={solveModel} onChange={(e) => setSolveModel(e.target.value)} list="model-options" />
              </label>
              <label>
                <span>
                  讲解剧本模型 <span className="muted">· 生成动画讲解用</span>
                </span>
                <input value={sceneModel} onChange={(e) => setSceneModel(e.target.value)} list="model-options" />
              </label>
              <datalist id="model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <label>
                思考强度
                <select value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)}>
                  <option value="">默认（不指定）</option>
                  <option value="low">低（更快）</option>
                  <option value="medium">中</option>
                  <option value="high">高（更准，更慢）</option>
                </select>
              </label>
              <div className="row">
                <button className="btn" onClick={runTest} disabled={testing}>
                  {testing ? '测试中…' : '测试连接'}
                </button>
                {test && <span className={test.ok ? 'ok-text' : 'error-text'}>{test.message}</span>}
              </div>
            </section>

            <section>
              <h3>讲解</h3>
              <label>
                讲解风格
                <select value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
                  <option value="direct">直接讲解完整过程</option>
                  <option value="hint-first">先给提示，让我自己想</option>
                </select>
              </label>
            </section>

            <section>
              <h3>朗读</h3>
              {!speechSupported() ? (
                <p className="muted">这个浏览器不支持朗读。</p>
              ) : (
                <>
                  <label>
                    语速：{rate.toFixed(1)}
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    声音
                    <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                      <option value="">自动选择</option>
                      {voices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn"
                    onClick={() => speak('我们来看这道题。点P从点A出发，每秒移动两个单位。', { rate, voice })}
                  >
                    试听
                  </button>
                  <p className="hint">声音保存在服务器上，但每台设备可用的声音不同；找不到时会自动选择。</p>
                </>
              )}
            </section>

            <div className="row sticky-save">
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? '保存中…' : '保存设置'}
              </button>
              {message && <span className="ok-text">{message}</span>}
              {error && <span className="error-text">{error}</span>}
            </div>

            <section>
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
