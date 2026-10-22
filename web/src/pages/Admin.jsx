import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api, fmtDT, fmtShort, won, photo, CAT_NAMES } from '../lib.js';
import { useApp, Badge, LBadge, ConfirmModal, ErrorBox } from '../ui.jsx';

const ROLE = { guest: '게스트', host: '호스트', admin: '관리자' };
const PROV = { kakao: '카카오', naver: '네이버', google: '구글', demo: '시연' };
const ACTION = {
  login: '로그인', withdraw: '회원 탈퇴', become_host: '호스트 등록', listing_create: '숙소 생성', listing_update: '숙소 수정', listing_submit: '심사 요청',
  listing_unpublish: '게시 중단', listing_delete: '숙소 삭제', photo_upload: '사진 업로드', booking_create: '예약 생성', booking_accept: '예약 수락',
  booking_decline: '예약 거절', booking_cancel: '예약 취소', admin_listing_approve: '관리자 승인', admin_listing_reject: '관리자 보완 요청',
  admin_listing_suspend: '관리자 게시 중지', admin_user_update: '회원 권한·상태 변경', admin_booking_cancel: '관리자 예약 취소', admin_review_hide: '후기 숨김',
};

function Dash() {
  const [s, setS] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { api('/api/admin/stats').then(setS).catch(e => setErr(e.message)); }, []);
  if (err) return <ErrorBox error={err} />;
  if (!s) return <div className="skel" style={{ height: 160 }} />;
  const max = Math.max(1, ...s.daily.map(d => d.n));
  return (
    <>
      <div className="stats num">
        <div className="stat"><small>심사 대기 숙소</small><b style={{ color: s.pending ? 'var(--warn)' : undefined }}>{s.pending}</b></div>
        <div className="stat"><small>게시 중 숙소</small><b>{s.live}</b></div>
        <div className="stat"><small>회원 (최근 7일 신규)</small><b>{s.users} <small className="muted" style={{ fontSize: 14 }}>+{s.users_7d}</small></b></div>
        <div className="stat"><small>활동 호스트</small><b>{s.hosts}</b></div>
        <div className="stat"><small>응답 대기 예약</small><b>{s.requests}</b></div>
        <div className="stat"><small>이번 달 거래액</small><b>{won(s.gmv_month)}</b></div>
        <div className="stat"><small>이번 달 수수료 수익</small><b>{won(s.revenue_month)}</b></div>
        <div className="stat"><small>최근 30일 예약</small><b>{s.bookings_30d}건</b></div>
      </div>
      <div className="box"><h3 className="h3" style={{ marginBottom: 0 }}>최근 14일 예약 생성</h3>
        <div className="chart">{s.daily.map(d => <div key={d.d}><b className="num">{d.n || ''}</b><i style={{ height: (d.n / max * 100) + '%' }} />{d.d.slice(3)}</div>)}</div></div>
    </>
  );
}

function Listings() {
  const { notify } = useApp();
  const [status, setStatus] = useState('pending'), [q, setQ] = useState(''), [items, setItems] = useState(null), [modal, setModal] = useState(null);
  const load = () => { setItems(null); api(`/api/admin/listings?status=${status}${q ? '&q=' + encodeURIComponent(q) : ''}`).then(r => setItems(r.items)).catch(e => notify(e.message, true)); };
  useEffect(load, [status]);
  const act = async (l, action, reason) => { await api(`/api/admin/listings/${l.id}/${action}`, { method: 'POST', body: { reason } }); notify('처리했어요'); load(); };
  return (
    <>
      <div className="tools" style={{ marginBottom: 14 }}>
        <select className="sel" id="al-status" value={status} onChange={e => setStatus(e.target.value)} aria-label="상태">
          {[['pending', '심사 대기'], ['approved', '게시 중'], ['rejected', '보완 요청'], ['suspended', '게시 중지'], ['draft', '작성 중'], ['all', '전체']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <form onSubmit={e => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 6 }}><input className="sel" id="al-q" placeholder="숙소명·호스트 검색" value={q} onChange={e => setQ(e.target.value)} /><button className="btn sm line">검색</button></form>
      </div>
      {!items ? <div className="skel" style={{ height: 120 }} /> : items.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>사진</th><th>숙소</th><th>호스트</th><th>상세 주소</th><th>요금</th><th>상태</th><th>수정일</th><th></th></tr></thead>
          <tbody>{items.map(l => (
            <tr key={l.id}>
              <td>{l.cover ? <img className="mini" src={photo(l.cover, true)} alt="" /> : <span className="muted">없음</span>}<div className="hint num">{l.photo_count}장</div></td>
              <td className="wrapc"><Link className="link" to={`/rooms/${l.id}`} target="_blank" rel="noopener">{l.title}</Link><div className="hint">{CAT_NAMES[l.category]} · {l.region} {l.area}</div>{l.reject_reason && <div className="hint" style={{ color: 'var(--danger)' }}>{l.reject_reason}</div>}</td>
              <td>{l.host_name}<div className="hint">{l.host_email || '-'}<br />{l.host_phone || '-'}</div></td>
              <td className="wrapc">{l.address || <span className="muted">미입력</span>}</td>
              <td className="num">{won(l.price)}</td>
              <td><LBadge s={l.status} /></td>
              <td className="num">{fmtDT(l.updated_at)}</td>
              <td><div style={{ display: 'flex', gap: 4 }}>
                {l.status !== 'approved' && <button className="btn sm primary" onClick={() => setModal({ l, a: 'approve' })}>승인</button>}
                {['pending', 'draft'].includes(l.status) && <button className="btn sm line" onClick={() => setModal({ l, a: 'reject' })}>보완 요청</button>}
                {l.status !== 'suspended' && <button className="btn sm ghost-danger" onClick={() => setModal({ l, a: 'suspend' })}>중지</button>}
              </div></td>
            </tr>))}</tbody>
        </table></div>
      ) : <div className="empty"><b>해당하는 숙소가 없어요</b></div>}
      {modal && <ConfirmModal
        title={{ approve: '이 숙소를 승인할까요?', reject: '보완을 요청할까요?', suspend: '게시를 중지할까요?' }[modal.a]}
        text={modal.a === 'approve' ? '승인하면 바로 검색에 노출돼요. 사진·주소·인허가 정보를 확인했나요?' : '사유는 호스트에게 그대로 보여요.'}
        okText={{ approve: '승인', reject: '보완 요청', suspend: '게시 중지' }[modal.a]} danger={modal.a === 'suspend'}
        reason={modal.a !== 'approve'} reasonRequired={modal.a !== 'approve'} reasonLabel="사유"
        onOk={r => act(modal.l, modal.a, r || undefined)} onClose={() => setModal(null)} />}
    </>
  );
}

function Users() {
  const { me, notify } = useApp();
  const [q, setQ] = useState(''), [role, setRole] = useState('all'), [items, setItems] = useState(null), [modal, setModal] = useState(null);
  const load = () => { setItems(null); api(`/api/admin/users?role=${role}${q ? '&q=' + encodeURIComponent(q) : ''}`).then(r => setItems(r.items)).catch(e => notify(e.message, true)); };
  useEffect(load, [role]);
  const update = async (u, body) => { await api(`/api/admin/users/${u.id}`, { method: 'PUT', body }); notify('변경했어요'); load(); };
  return (
    <>
      <div className="tools" style={{ marginBottom: 14 }}>
        <select className="sel" id="au-role" value={role} onChange={e => setRole(e.target.value)} aria-label="권한">{[['all', '전체'], ['guest', '게스트'], ['host', '호스트'], ['admin', '관리자']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <form onSubmit={e => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 6 }}><input className="sel" id="au-q" placeholder="이름·이메일·전화" value={q} onChange={e => setQ(e.target.value)} /><button className="btn sm line">검색</button></form>
      </div>
      {!items ? <div className="skel" style={{ height: 120 }} /> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>이름</th><th>가입</th><th>연락처</th><th>권한</th><th>상태</th><th>예약·숙소</th><th>최근 로그인</th><th></th></tr></thead>
          <tbody>{items.map(u => (
            <tr key={u.id}>
              <td>{u.name}<div className="hint">{PROV[u.provider] || u.provider}</div></td>
              <td className="num">{fmtDT(u.created_at)}</td>
              <td>{u.email || '-'}<div className="hint">{u.phone || '-'}</div></td>
              <td>{u.id === me.id ? ROLE[u.role] : <select className="sel" aria-label="권한 변경" value={u.role} onChange={e => setModal({ u, body: { role: e.target.value }, t: `${u.name}님의 권한을 ${ROLE[e.target.value]}(으)로 바꿀까요?` })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</td>
              <td><span className={'state ' + (u.status === 'active' ? 'st-ok' : 'st-bad')}>{u.status === 'active' ? '정상' : '이용 정지'}</span></td>
              <td className="num">{u.bookings} · {u.listings}</td>
              <td className="num">{u.last_login_at ? fmtDT(u.last_login_at) : '-'}</td>
              <td>{u.id !== me.id && (u.status === 'active'
                ? <button className="btn sm ghost-danger" onClick={() => setModal({ u, body: { status: 'suspended' }, t: `${u.name}님의 이용을 정지할까요?`, danger: true })}>이용 정지</button>
                : <button className="btn sm line" onClick={() => setModal({ u, body: { status: 'active' }, t: `${u.name}님의 이용 정지를 풀까요?` })}>정지 해제</button>)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {modal && <ConfirmModal title={modal.t} text={modal.body.status === 'suspended' ? '바로 로그아웃되고, 게시 중인 숙소도 함께 내려가요.' : modal.body.role === 'admin' ? '관리자는 모든 회원 정보와 숙소를 볼 수 있어요. 신중하게 지정하세요.' : undefined}
        okText="변경" danger={modal.danger} onOk={() => update(modal.u, modal.body)} onClose={() => setModal(null)} />}
    </>
  );
}

function Bookings() {
  const { notify } = useApp();
  const [status, setStatus] = useState('all'), [q, setQ] = useState(''), [items, setItems] = useState(null), [modal, setModal] = useState(null);
  const load = () => { setItems(null); api(`/api/admin/bookings?status=${status}${q ? '&q=' + encodeURIComponent(q) : ''}`).then(r => setItems(r.items)).catch(e => notify(e.message, true)); };
  useEffect(load, [status]);
  return (
    <>
      <div className="tools" style={{ marginBottom: 14 }}>
        <select className="sel" id="ab-status" value={status} onChange={e => setStatus(e.target.value)} aria-label="상태">
          {[['all', '전체'], ['requested', '승인 대기'], ['confirmed', '확정'], ['completed', '완료'], ['cancelled', '취소'], ['declined', '거절'], ['expired', '만료']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <form onSubmit={e => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 6 }}><input className="sel" id="ab-q" placeholder="예약번호·숙소·게스트" value={q} onChange={e => setQ(e.target.value)} /><button className="btn sm line">검색</button></form>
      </div>
      {!items ? <div className="skel" style={{ height: 120 }} /> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>예약번호</th><th>숙소</th><th>게스트</th><th>호스트</th><th>일정</th><th>총액</th><th>수수료</th><th>상태</th><th></th></tr></thead>
          <tbody>{items.map(b => (
            <tr key={b.id}>
              <td className="num"><Link className="link" to={`/bookings/${b.id}`}>{b.code}</Link><div className="hint">{fmtDT(b.created_at)}</div></td>
              <td className="wrapc">{b.title}</td><td>{b.guest_name}</td><td>{b.host_name}</td>
              <td className="num">{fmtShort(b.check_in)}–{fmtShort(b.check_out)}</td>
              <td className="num">{won(b.total)}</td><td className="num">{won(b.service_fee + b.host_fee)}</td>
              <td><Badge s={b.status} /></td>
              <td>{['requested', 'confirmed'].includes(b.status) && <button className="btn sm ghost-danger" onClick={() => setModal(b)}>강제 취소</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {modal && <ConfirmModal title={`${modal.code} 예약을 취소할까요?`} text="분쟁·사기 의심 등 운영상 필요할 때만 사용하세요. 사유가 양쪽에 보여요." okText="강제 취소" danger reason reasonRequired reasonLabel="취소 사유"
        onOk={async r => { await api(`/api/admin/bookings/${modal.id}/cancel`, { method: 'POST', body: { reason: r } }); notify('취소했어요'); load(); }} onClose={() => setModal(null)} />}
    </>
  );
}

function Audit() {
  const [items, setItems] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { api('/api/admin/audit').then(r => setItems(r.items)).catch(e => setErr(e.message)); }, []);
  if (err) return <ErrorBox error={err} />;
  return !items ? <div className="skel" style={{ height: 120 }} /> : (
    <div className="tbl-wrap"><table>
      <thead><tr><th>시각</th><th>사용자</th><th>작업</th><th>대상</th><th>IP</th><th>내용</th></tr></thead>
      <tbody>{items.map(a => (
        <tr key={a.id}><td className="num">{fmtDT(a.created_at)}</td><td>{a.actor || '-'}</td><td>{ACTION[a.action] || a.action}</td><td className="num">{a.target ? String(a.target).slice(0, 12) : '-'}</td><td className="num">{a.ip}</td>
          <td className="hint" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{Object.keys(a.meta || {}).length ? JSON.stringify(a.meta) : ''}</td></tr>))}</tbody>
    </table></div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('dash');
  const T = { dash: ['대시보드', Dash], listings: ['숙소 심사', Listings], users: ['회원', Users], bookings: ['예약', Bookings], audit: ['활동 기록', Audit] };
  const C = T[tab][1];
  return (
    <><TopBar /><main className="wrap">
      <div className="head"><div><h1>관리자</h1><p>숙소 심사, 회원·예약 관리, 운영 기록을 확인해요.</p></div></div>
      <div className="tabs" role="tablist">{Object.entries(T).map(([k, [n]]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</div>
      <C />
    </main></>
  );
}
