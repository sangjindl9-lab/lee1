import { useState } from 'react';
import { applyTheme, getTheme } from '../theme';
export default function ThemeToggle() {
  const [t, setT] = useState(getTheme());
  return (
    <button className="btn btn-ghost" title="다크/라이트 모드" onClick={() => { const n = t === 'dark' ? 'light' : 'dark'; applyTheme(n); setT(n); }}>
      {t === 'dark' ? '☾' : '☀'}
    </button>
  );
}
