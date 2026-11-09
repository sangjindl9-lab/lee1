import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/Auth';
import { BrandMark, useBranding } from '../context/Branding';
import { useRealtime } from '../context/Realtime';
import { fmtTime } from '../lib/format';
import { useNow } from '../lib/useApi';

interface NavItem {
  to: string;
  text: string;
  perm?: string;
}

const NAV: NavItem[] = [
  { to: '/', text: '대시보드', perm: 'device.read' },
  { to: '/alarms', text: '알람', perm: 'alarm.read' },
  { to: '/approvals', text: '승인 대기 명령', perm: 'command.approve' },
  { to: '/sites', text: '현장·함체 관리', perm: 'site.read' },
  { to: '/audit', text: '감사로그', perm: 'audit.read' },
  { to: '/users', text: '사용자 관리', perm: 'user.manage' },
];

const CONN_TEXT: Record<string, string> = {
  connected: '실시간 연결됨',
  connecting: '실시간 연결 중',
  disconnected: '실시간 끊김',
  error: '실시간 연결 실패',
};

export function Layout() {
  const { user, logout, can } = useAuth();
  const { state, error } = useRealtime();
  const branding = useBranding();
  const now = useNow(1000);

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark compact />
        <div className={`conn conn-${state}`} title={error ?? undefined}>
          <span className="conn-dot" />
          <span className="conn-text">{CONN_TEXT[state]}</span>
        </div>
        <div className="clock mono">{fmtTime(now)}</div>
        <div className="userbox">
          <span className="user-name">{user?.display_name || user?.username}</span>
          <span className="user-org">{user?.org_name}</span>
          <button className="btn btn-sm" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
      </header>
      <nav className="sidenav" aria-label="주 메뉴">
        {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            {n.text}
          </NavLink>
        ))}
        {branding.companyName ? <div className="nav-foot">{branding.companyName}</div> : null}
      </nav>
      <main className="content">
        {state === 'error' || state === 'disconnected' ? (
          <div className="banner banner-warn">실시간 수신이 끊겼습니다. 화면 값이 최신이 아닐 수 있습니다. 자동으로 다시 연결합니다.</div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
