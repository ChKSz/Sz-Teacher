import { useEffect, useState } from 'react';

/** 外观：浅色 / 深色 / 跟随系统。保存在本机（不同设备可以不同）。 */
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'sz-theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // 隐私模式等情况下读不到，按跟随系统处理
  }
  return 'system';
}

/** 显式选择时在 <html> 上标 data-theme；跟随系统时去掉，由 CSS 的 prefers-color-scheme 决定。 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1c1b19' : '#faf9f5');
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // 忽略
    }
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  return [theme, setTheme];
}

/** 当前实际是否为深色（考虑 data-theme 和系统设置），变化时自动更新。 */
export function useIsDark(): boolean {
  const compute = () => {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(compute);
  useEffect(() => {
    const update = () => setDark(compute());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);
  return dark;
}
