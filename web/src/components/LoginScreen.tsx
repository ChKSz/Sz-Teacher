import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';

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
    <div className="center-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">📐</div>
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
        <button className="btn primary" type="submit" disabled={busy || !password}>
          {busy ? '请稍候…' : initialized ? '登录' : '设置密码并进入'}
        </button>
      </form>
    </div>
  );
}
