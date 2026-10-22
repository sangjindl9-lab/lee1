import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api, fmtYM } from '../lib.js';
import { useApp, Avatar, ConfirmModal } from '../ui.jsx';

const PROV = { kakao: '카카오', naver: '네이버', google: 'Google', demo: '시연 계정' };

export default function Account() {
  const { me, refresh, notify, logout } = useApp();
  const nav = useNavigate();
  const [v, setV] = useState({ name: me.name, phone: me.phone || '', bio: me.bio || '' });
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false), [modal, setModal] = useState(false);
  const save = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api('/api/me', { method: 'PUT', body: v }); await refresh(); notify('저장했어요'); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <><TopBar /><main className="wrap narrow">
      <div className="head"><div><h1>내 정보</h1><p>{PROV[me.provider] || me.provider} 계정으로 로그인 · {fmtYM(me.createdAt)} 가입</p></div></div>
      <form className="box form" onSubmit={save}>
        <div className="host"><Avatar name={me.name} src={me.avatar} lg /><div><b>{me.name}</b><p>{me.email || '이메일 정보 없음'}</p></div></div>
        <div className="two">
          <label>이름 (다른 회원에게 보여요)<input id="acc-name" maxLength={30} value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
          <label>휴대폰 번호 <small>예약 확정 시 상대에게만 공개</small><input id="acc-phone" inputMode="tel" placeholder="010-1234-5678" value={v.phone} onChange={e => setV({ ...v, phone: e.target.value })} /></label>
        </div>
        <label>소개 <small>호스트라면 게스트에게 보여요</small><textarea id="acc-bio" maxLength={500} value={v.bio} onChange={e => setV({ ...v, bio: e.target.value })} /></label>
        {err && <div className="err">{err}</div>}
        <div><button className="btn primary" disabled={busy}>저장</button></div>
      </form>
      <div className="box">
        <h3 className="h3">계정</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {me.role === 'guest' ? <Link className="btn line" to="/host/start">호스트 되기</Link> : <Link className="btn line" to="/host">호스트 관리</Link>}
          <button className="btn line" onClick={logout}>로그아웃</button>
          <button className="btn ghost-danger" onClick={() => setModal(true)}>회원 탈퇴</button>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>탈퇴하면 이름·연락처·이메일이 바로 지워져요. 전자상거래법에 따라 예약·거래 기록은 개인을 알아볼 수 없는 상태로 5년간 보관돼요.</p>
      </div>
      {modal && <ConfirmModal title="정말 탈퇴할까요?" text="탈퇴하면 위시리스트와 등록한 숙소가 모두 내려가고 되돌릴 수 없어요." okText="탈퇴하기" danger
        onOk={async () => { await api('/api/me', { method: 'DELETE' }); await refresh(); notify('탈퇴했어요. 그동안 고마웠어요'); nav('/'); }} onClose={() => setModal(false)} />}
    </main></>
  );
}
