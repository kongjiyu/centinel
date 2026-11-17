export type Theme = 'light' | 'dark' | 'system';

const KEY = 'centinel:theme';
let sessionTheme: Theme = 'system';

export function readTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch { return sessionTheme; }
  return 'system';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'system'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
}

export function saveTheme(theme: Theme) {
  sessionTheme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* Apply for this session. */ }
  applyTheme(theme);
}
