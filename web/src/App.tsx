import { lazy, Suspense, useEffect, useState } from 'react';
import { usePath, navigate } from './router';
import { api } from './api';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';

const Workspace = lazy(() => import('./pages/Workspace'));
const SharePage = lazy(() => import('./pages/Share'));
const RenderPage = lazy(() => import('./pages/Render'));

export interface Me { user: { id: string; email: string; name: string; role: string }; company: { id: string; name: string; brand: any } }

export default function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const isPublic = path.startsWith('/s/') || path === '/render';
  useEffect(() => { if (!isPublic) api<Me>('/auth/me').then(setMe).catch(() => setMe(null)); }, [isPublic, path === '/login']);

  const fallback = <div className="grid h-full place-items-center text-sm text-mute">불러오는 중…</div>;
  if (path === '/render') return <Suspense fallback={null}><RenderPage /></Suspense>;
  if (path.startsWith('/s/')) return <Suspense fallback={fallback}><SharePage token={path.slice(3)} /></Suspense>;
  if (me === undefined) return fallback;
  if (!me || path === '/login' || path === '/signup') {
    return <Auth mode={path === '/signup' ? 'signup' : 'login'} onDone={(m) => { setMe(m); navigate('/app'); }} />;
  }
  const m = /^\/app\/p\/([0-9a-f-]{36})/.exec(path);
  if (m) return <Suspense fallback={fallback}><Workspace projectId={m[1]} me={me} /></Suspense>;
  if (path !== '/app') { history.replaceState(null, '', '/app'); }
  return <Dashboard me={me} onLogout={() => setMe(null)} />;
}
