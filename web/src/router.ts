import { useEffect, useState } from 'react';
export const navigate = (to: string) => { history.pushState(null, '', to); window.dispatchEvent(new Event('popstate')); };
export function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const f = () => setP(location.pathname); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []);
  return p;
}
