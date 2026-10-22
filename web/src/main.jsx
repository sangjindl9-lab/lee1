import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import './styles.css';
import { api, setCsrf } from './lib.js';
import { AppCtx, useApp, Icon, P } from './ui.jsx';
import Home from './pages/Home.jsx';
import Listing from './pages/Listing.jsx';
import Login from './pages/Login.jsx';
import { Wishlist, Trips, BookingPage } from './pages/Guest.jsx';
import Account from './pages/Account.jsx';
import { HostHome, HostEdit, BecomeHost } from './pages/Host.jsx';
import Admin from './pages/Admin.jsx';
import { Terms, Privacy, NotFound } from './pages/Legal.jsx';

function Shell({ children }) {
  const { me, config } = useApp();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const b = config?.business || {};
  return (
    <>
      {config?.demo && <div className="demo-band">시연 모드입니다. 예약·결제는 실제로 이뤄지지 않아요.</div>}
      {children}
      <footer className="foot">
        <div className="wrap">
          <div className="links"><Link to="/terms">이용약관</Link><Link to="/privacy">개인정보처리방침</Link><Link to="/host/start">호스트 되기</Link></div>
          <p>머묾은 통신판매중개자로서 숙소 예약의 당사자가 아니며, 숙소 정보와 거래에 대한 책임은 각 호스트에게 있습니다.</p>
          {b.name && <p>{b.name} · 대표 {b.ceo} · 사업자등록번호 {b.regNo}{b.salesNo && ` · 통신판매업 신고 ${b.salesNo}`}</p>}
          {b.address && <p>{b.address}{b.phone && ` · 고객센터 ${b.phone}`}{b.email && ` · ${b.email}`}</p>}
          <p>© {new Date().getFullYear()} 머묾</p>
        </div>
      </footer>
      <nav className="tabbar" aria-label="하단 메뉴">
        <NavLink to="/" end><Icon d={P.search} />둘러보기</NavLink>
        <NavLink to="/wishlist"><Icon d={P.heart} />위시리스트</NavLink>
        <NavLink to="/trips"><Icon d={P.trip} />여행</NavLink>
        {me && me.role !== 'guest' ? <NavLink to="/host"><Icon d={P.home} />호스트</NavLink> : null}
        <NavLink to={me ? '/account' : '/login'}><Icon d={P.user} />{me ? '내 정보' : '로그인'}</NavLink>
      </nav>
    </>
  );
}

function Need({ role, children }) {
  const { me } = useApp();
  const loc = useLocation();
  if (!me) return <Navigate to={'/login?next=' + encodeURIComponent(loc.pathname + loc.search)} replace />;
  if (role === 'host' && me.role === 'guest') return <Navigate to="/host/start" replace />;
  if (role === 'admin' && me.role !== 'admin') return <NotFound />;
  return children;
}

function App() {
  const [me, setMe] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [toast, setToast] = useState(null);
  const nav = useNavigate();
  const refresh = useCallback(async () => {
    const r = await api('/api/me').catch(() => ({ user: null }));
    setCsrf(r.csrf); setMe(r.user);
    return r.user;
  }, []);
  useEffect(() => { refresh(); api('/api/config').then(setConfig).catch(() => {}); }, [refresh]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);
  const notify = (msg, bad) => setToast({ msg, bad });
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); await refresh(); nav('/'); notify('로그아웃했어요'); };
  if (me === undefined) return <div className="wrap" style={{ paddingBlock: 60 }}><div className="skel" style={{ height: 40, maxWidth: 240 }} /></div>;
  return (
    <AppCtx.Provider value={{ me, config, refresh, notify, logout }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/rooms/:id" element={<Listing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/wishlist" element={<Need><Wishlist /></Need>} />
          <Route path="/trips" element={<Need><Trips /></Need>} />
          <Route path="/bookings/:id" element={<Need><BookingPage /></Need>} />
          <Route path="/account" element={<Need><Account /></Need>} />
          <Route path="/host/start" element={<Need><BecomeHost /></Need>} />
          <Route path="/host" element={<Need role="host"><HostHome /></Need>} />
          <Route path="/host/listings/:id" element={<Need role="host"><HostEdit /></Need>} />
          <Route path="/admin" element={<Need role="admin"><Admin /></Need>} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
      {toast && <div className={'toast' + (toast.bad ? ' bad' : '')} role="status">{toast.msg}</div>}
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
