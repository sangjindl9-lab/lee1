import { useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Dashboard from "./pages/Dashboard";
import Live from "./pages/Live";
import Playback from "./pages/Playback";
import Events from "./pages/Events";
import Analytics from "./pages/Analytics";
import Cameras from "./pages/Cameras";
import Sites from "./pages/Sites";
import Exports from "./pages/Exports";
import Users from "./pages/Users";
import Audit from "./pages/Audit";
import Storage from "./pages/Storage";
import Drivers from "./pages/Drivers";
import Bookmarks from "./pages/Bookmarks";
import Notify from "./pages/Notify";
import Edges from "./pages/Edges";
import SyncPlayback from "./pages/SyncPlayback";
import DeviceRecordings from "./pages/DeviceRecordings";

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#26303a" />
      <rect x="5" y="9" width="16" height="14" rx="2" fill="none" stroke="#f2c230" strokeWidth="2.5" />
      <path d="M21 14l6-3v10l-6-3z" fill="#f2c230" />
      <circle cx="10" cy="14" r="2" fill="#e5484d" />
    </svg>
  );
}

export default function App() {
  const { me, loading, logout, can, isSuper } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  if (loading) return <div className="empty">불러오는 중…</div>;
  if (!me) return <Login />;
  if (me.must_change_password) return <ChangePassword forced />;
  const close = () => setOpen(false);
  // 관제 프로그램의 영상벽 창(?kiosk=1): 메뉴 없이 화면만
  const kiosk = new URLSearchParams(loc.search).get("kiosk") === "1";
  return (
    <div className={`app${kiosk ? " kiosk" : ""}`}>
      {!kiosk && <nav className={`nav${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).tagName === "A" && close()}>
        <div className="brand"><Logo /><div>현장 영상관제<small>웹 NVR</small></div></div>
        <NavLink to="/" end>운영 대시보드</NavLink>
        {can("live_view") && <NavLink to="/live">실시간 관제</NavLink>}
        {can("playback") && <NavLink to="/playback">녹화 검색·재생</NavLink>}
        {can("playback") && <NavLink to="/sync">동기 재생</NavLink>}
        {can("playback") && <NavLink to="/bookmarks">북마크·메모</NavLink>}
        {can("live_view") && <NavLink to="/events">이벤트 센터</NavLink>}
        {can("live_view") && <NavLink to="/analytics">지능형 분석</NavLink>}
        {can("download") && <NavLink to="/exports">내보내기 작업</NavLink>}
        <div className="group">관리</div>
        <NavLink to="/cameras">카메라 관리</NavLink>
        <NavLink to="/sites">현장 관리</NavLink>
        {can("settings") && <NavLink to="/storage">저장장치·보관</NavLink>}
        <NavLink to="/drivers">지원 장비·드라이버</NavLink>
        {isSuper && <NavLink to="/users">사용자·권한</NavLink>}
        {isSuper && <NavLink to="/notify">알림·외부 연동</NavLink>}
        {isSuper && <NavLink to="/edges">현장 서버 통합</NavLink>}
        {can("playback") && <NavLink to="/device-recordings">카메라 저장영상</NavLink>}
        {isSuper && <NavLink to="/audit">감사로그</NavLink>}
        <NavLink to="/account">내 계정</NavLink>
        <div className="foot">
          <div><b>{me.display_name || me.username}</b> <span className="muted">{me.role_label}</span></div>
          <button className="ghost" style={{ padding: "4px 0" }} onClick={logout}>로그아웃</button>
        </div>
      </nav>}
      <main className="main" key={loc.pathname === "/live" ? "live" : "page"}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<Live />} />
          <Route path="/playback" element={<Playback />} />
          <Route path="/events" element={<Events />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/exports" element={<Exports />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/sites" element={<Sites />} />
          <Route path="/storage" element={<Storage />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/users" element={<Users />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/notify" element={<Notify />} />
          <Route path="/edges" element={<Edges />} />
          <Route path="/sync" element={<SyncPlayback />} />
          <Route path="/device-recordings" element={<DeviceRecordings />} />
          <Route path="/account" element={<ChangePassword />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      {!kiosk && <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>메뉴</button>}
    </div>
  );
}
