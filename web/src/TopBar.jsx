import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useApp, Avatar } from './ui.jsx';

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M3 15 Q9 13 16 6 Q23 13 29 15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 15v11h16V15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="16" cy="20" r="2.4" fill="var(--gold)" />
    </svg>
  );
}

function UserMenu() {
  const { me, logout } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const f = e => ref.current && !ref.current.contains(e.target) && setOpen(false);
    addEventListener('mousedown', f); return () => removeEventListener('mousedown', f);
  }, []);
  if (!me) return <Link to="/login" className="btn primary sm">로그인</Link>;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="me-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <span style={{ fontSize: 13.5 }}>{me.name}</span><Avatar name={me.name} src={me.avatar} />
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <Link to="/trips">여행</Link><Link to="/wishlist">위시리스트</Link>
          <hr />
          {me.role === 'guest' ? <Link to="/host/start">호스트 되기</Link> : <Link to="/host">호스트 관리</Link>}
          {me.role === 'admin' && <Link to="/admin">관리자</Link>}
          <Link to="/account">내 정보</Link>
          <hr />
          <button onClick={logout}>로그아웃</button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ children }) {
  const { me } = useApp();
  return (
    <header className="top">
      <div className="wrap bar">
        <Link to="/" className="brand" aria-label="머묾 홈"><Mark />머묾<small>Meomul</small></Link>
        {children || <div style={{ flex: 1 }} />}
        <nav className="navr">
          {me && me.role !== 'guest' ? <NavLink to="/host">호스트 관리</NavLink> : <NavLink to="/host/start">호스트 되기</NavLink>}
          {me?.role === 'admin' && <NavLink to="/admin">관리자</NavLink>}
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}

