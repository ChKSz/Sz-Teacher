import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.ts';
import { LoginScreen } from './components/LoginScreen.tsx';
import { MainScreen } from './components/MainScreen.tsx';
import { useTheme } from './theme.ts';
import type { AuthStatus } from '../../shared/types.ts';

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useTheme();

  const refresh = useCallback(() => {
    api
      .authStatus()
      .then((s) => {
        setStatus(s);
        setError('');
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setStatus((s) => (s ? { ...s, authenticated: false } : s)));
  }, [refresh]);

  if (error) {
    return (
      <div className="center-screen">
        <p className="error-text">{error}</p>
        <button className="btn" onClick={refresh}>
          重试
        </button>
      </div>
    );
  }
  if (!status) return <div className="center-screen"><span className="spinner" aria-label="加载中" /></div>;
  if (!status.authenticated) {
    return <LoginScreen initialized={status.initialized} onSuccess={refresh} />;
  }
  return <MainScreen onLoggedOut={refresh} theme={theme} onTheme={setTheme} />;
}
