export type Theme = 'dark' | 'light';
export function getTheme(): Theme { try { return (localStorage.getItem('eum3d.theme') as Theme) || 'dark'; } catch { return 'dark'; } }
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('eum3d.theme', t); } catch { /* 저장 불가 환경 */ }
}
