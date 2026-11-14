import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../api.ts';
import { Logo } from './Logo.tsx';

export function LoginScreen({ initialized, onSuccess }: { initialized: boolean; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!initialized && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      if (initialized) await api.login(password);
      else await api.setup(password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen login-screen">
      <div className="login-figure" aria-hidden="true">
        <svg viewBox="0 0 400 300">
          <path d="M60 250 L200 40 L340 250 Z" />
          <path d="M200 40 L200 250" className="dashed" />
          <path d="M60 250 L270 145" className="dashed" />
          <circle cx="270" cy="145" r="5" className="pt" />
          <circle cx="200" cy="250" r="4" />
        </svg>
      </div>
      <form className="login-card" onSubmit={submit}>
        <Logo size={44} />
        <h1>Sz-Teacher</h1>
        <p className="muted">{initialized ? '初中数学一对一讲师' : '第一次使用，请设置访问密码（至少 6 位）'}</p>
        <input
          type="password"
          autoFocus
          autoComplete={initialized ? 'current-password' : 'new-password'}
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="密码"
        />
        {!initialized && (
          <input
            type="password"
            autoComplete="new-password"
            placeholder="再输入一次"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-label="确认密码"
          />
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary block" type="submit" disabled={busy || !password}>
          {busy ? '请稍候…' : initialized ? '登录' : '设置密码并进入'}
          {!busy && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
    </div>
  );
}
