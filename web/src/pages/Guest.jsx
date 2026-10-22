import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api, fmtD, fmtDT, won, photo, todayLocal } from '../lib.js';
import { useApp, Badge, Avatar, ConfirmModal, Loading, ErrorBox } from '../ui.jsx';
import { Card, useLike } from './Home.jsx';

export function Wishlist() {
  const [items, setItems] = useState(null), [err, setErr] = useState(null);
  const like = useLike(setItems);
  useEffect(() => { api('/api/wishlist').then(r => setItems(r.items)).catch(e => setErr(e.message)); }, []);
  const shown = items?.filter(x => x.liked !== false);
  return (
    <><TopBar /><main className="wrap">
      <div className="head"><div><h1>위시리스트</h1><p>{shown ? `저장한 숙소 ${shown.length}곳` : ''}</p></div></div>
      {err ? <ErrorBox error={err} /> : !items ? <Loading /> : shown.length
        ? <div className="grid">{shown.map(l => <Card key={l.id} l={l} onLike={like} />)}</div>
        : <div className="empty"><b>아직 저장한 숙소가 없어요</b>숙소 사진의 하트를 누르면 여기에 모여요.<br /><Link className="link" to="/">숙소 둘러보기</Link></div>}
    </main></>
  );
}

export function Trips() {
  const [items, setItems] = useState(null), [err, setErr] = useState(null), [tab, setTab] = useState('upcoming');
  useEffect(() => { api('/api/bookings').then(r => setItems(r.items)).catch(e => setErr(e.message)); }, []);
  const t = todayLocal();
  const groups = {
    upcoming: x => ['requested', 'confirmed'].includes(x.status) && x.check_out >= t,
    past: x => x.status === 'completed' || (x.status === 'confirmed' && x.check_out < t),
    cancelled: x => ['cancelled', 'declined', 'expired'].includes(x.status),
  };
  const list = items?.filter(groups[tab]).sort((a, b) => (tab === 'upcoming' ? a.check_in.localeCompare(b.check_in) : b.check_in.localeCompare(a.check_in)));
  return (
    <><TopBar /><main className="wrap narrow">
      <div className="head"><div><h1>여행</h1><p>예약 요청과 확정된 여행을 한곳에서 확인해요.</p></div></div>
      <div className="tabs" role="tablist">
        {[['upcoming', '다가오는 여행'], ['past', '지난 여행'], ['cancelled', '취소·거절']].map(([k, v]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {err ? <ErrorBox error={err} /> : !items ? <div className="skel" style={{ height: 120 }} /> : list.length ? (
        <div className="trips">{list.map(b => (
          <Link className="trip" key={b.id} to={`/bookings/${b.id}`}>
            <div className="thumb">{b.cover && <img src={photo(b.cover, true)} alt="" />}</div>
            <div style={{ minWidth: 0 }}>
              <Badge s={b.status} />
              <h4>{b.title}</h4>
              <p className="num">{fmtD(b.check_in)} – {fmtD(b.check_out)} · {b.nights}박 · 게스트 {b.guests}명</p>
              <p className="num">{b.region} {b.area} · 총 {won(b.total)} · 예약번호 {b.code}</p>
            </div>
            <div className="acts">{tab === 'past' && !b.reviewed && <span className="btn sm primary">후기 쓰기</span>}<span className="btn sm line">자세히</span></div>
          </Link>))}
        </div>
      ) : <div className="empty"><b>{tab === 'upcoming' ? '예정된 여행이 없어요' : '기록이 없어요'}</b>{tab === 'upcoming' && <Link className="link" to="/">머물 곳 찾아보기</Link>}</div>}
    </main></>
  );
}

function Messages({ bookingId, canWrite }) {
  const [items, setItems] = useState(null), [body, setBody] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const ref = useRef(null);
  const load = () => api(`/api/bookings/${bookingId}/messages`).then(r => setItems(r.items)).catch(e => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [bookingId]);
  useEffect(() => { ref.current && (ref.current.scrollTop = ref.current.scrollHeight); }, [items?.length]);
  const send = async e => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try { await api(`/api/bookings/${bookingId}/messages`, { method: 'POST', body: { body } }); setBody(''); await load(); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <div className="box">
      <h3 className="h3">메시지</h3>
      <div className="thread" ref={ref}>
        {!items ? <span className="muted">불러오는 중</span> : items.length ? items.map(m => (
          <div key={m.id} className={'msg' + (m.mine ? ' mine' : '')}>{m.body}<small>{m.mine ? '나' : m.name} · {fmtDT(m.created_at)}</small></div>
        )) : <span className="muted">아직 주고받은 메시지가 없어요.</span>}
      </div>
      {canWrite && <form className="compose" onSubmit={send}>
        <textarea id="msg-body" aria-label="메시지 입력" maxLength={1000} value={body} onChange={e => setBody(e.target.value)} placeholder="메시지를 입력하세요" />
        <button className="btn primary" disabled={busy || !body.trim()}>보내기</button>
      </form>}
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      <p className="hint" style={{ marginTop: 10 }}>개인 계좌 송금이나 외부 메신저로 결제를 유도하면 거절하고 신고해 주세요.</p>
    </div>
  );
}

function ReviewForm({ id, onDone }) {
  const [v, setV] = useState({ rating: 5, cleanliness: 5, accuracy: 5, location: 5, body: '' }), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const Stars = ({ k, label }) => (
    <div className="lbl">{label}<div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => <button type="button" key={n} role="radio" aria-checked={v[k] === n} className={n <= v[k] ? 'on' : ''} onClick={() => setV({ ...v, [k]: n })} aria-label={`${n}점`}>★</button>)}
    </div></div>
  );
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api(`/api/bookings/${id}/review`, { method: 'POST', body: v }); onDone(); } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <form className="box form" onSubmit={submit}>
      <h3 className="h3" style={{ margin: 0 }}>후기 남기기</h3>
      <div className="four"><Stars k="rating" label="전체" /><Stars k="cleanliness" label="청결도" /><Stars k="accuracy" label="정확도" /><Stars k="location" label="위치" /></div>
      <label>어떤 점이 좋았나요?<textarea id="review-body" maxLength={2000} value={v.body} onChange={e => setV({ ...v, body: e.target.value })} placeholder="다음 게스트에게 도움이 되도록 솔직하게 적어 주세요 (10자 이상)" /></label>
      {err && <div className="err">{err}</div>}
      <div><button className="btn primary" disabled={busy}>후기 등록</button></div>
    </form>
  );
}

export function BookingPage() {
  const { id } = useParams();
  const { notify } = useApp();
  const [b, setB] = useState(null), [err, setErr] = useState(null), [modal, setModal] = useState(null);
  const load = () => api(`/api/bookings/${id}`).then(setB).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <><TopBar /><main className="wrap narrow"><ErrorBox error={err} /></main></>;
  if (!b) return <><TopBar /><main className="wrap narrow"><div className="skel" style={{ height: 200 }} /></main></>;
  const t = todayLocal();
  const isHost = b.role === 'host', active = ['requested', 'confirmed'].includes(b.status);
  const canCancel = active && b.check_in > t && b.role !== 'admin';
  const canReview = b.role === 'guest' && !b.reviewed && (b.status === 'completed' || (b.status === 'confirmed' && b.check_out <= t));
  const act = async (path, body, msg) => { await api(path, { method: 'POST', body }); notify(msg); await load(); };
  return (
    <><TopBar /><main className="wrap narrow">
      <p style={{ margin: '0 0 8px' }}><Link className="link" to={isHost ? '/host' : '/trips'}>← {isHost ? '호스트 관리' : '여행 목록'}</Link></p>
      <div className="head"><div><Badge s={b.status} /><h1>{b.title}</h1><p className="num">예약번호 {b.code} · {fmtDT(b.created_at)} 요청</p></div></div>
      <div className="box">
        <div className="trip" style={{ border: 0, padding: 0, background: 'none' }}>
          <Link to={`/rooms/${b.listing_id}`} className="thumb">{b.cover && <img src={photo(b.cover, true)} alt="" />}</Link>
          <div style={{ minWidth: 0 }}>
            <p className="num" style={{ color: 'var(--fg)', fontSize: 15 }}><b>{fmtD(b.check_in)} {b.checkin_time}</b> 체크인<br /><b>{fmtD(b.check_out)} {b.checkout_time}</b> 체크아웃</p>
            <p className="num">{b.nights}박 · 게스트 {b.guests}명</p>
          </div>
        </div>
        <div className="calc num" style={{ marginTop: 18 }}>
          <div><span>{won(b.nightly)} × {b.nights}박</span><span>{won(b.nightly * b.nights)}</span></div>
          {b.cleaning_fee > 0 && <div><span>청소비</span><span>{won(b.cleaning_fee)}</span></div>}
          <div><span>서비스 수수료</span><span>{won(b.service_fee)}</span></div>
          <div className="tot"><span>게스트 결제 총액</span><span>{won(b.total)}</span></div>
          {b.host_payout != null && <><div><span>호스트 수수료</span><span>−{won(b.host_fee)}</span></div><div className="tot"><span>호스트 정산 예정액</span><span>{won(b.host_payout)}</span></div></>}
        </div>
        <p className="hint" style={{ marginTop: 12 }}>결제 기능은 준비 중이에요. 결제 전에는 숙박 비용을 개인 계좌로 보내지 마세요.</p>
      </div>
      <div className="box">
        <h3 className="h3">{isHost ? '게스트' : '호스트'} 정보</h3>
        <div className="host"><Avatar name={isHost ? b.guest_name : b.host_name} src={isHost ? b.guest_avatar : b.host_avatar} />
          <div><b>{isHost ? b.guest_name : b.host_name}님</b>
            <p>{(isHost ? b.guest_phone : b.host_phone) || '연락처는 예약이 확정되면 보여요.'}</p></div></div>
        {b.address && <p style={{ marginTop: 14 }}><b>주소</b><br />{b.address}</p>}
        {b.decline_reason && <p className="err" style={{ marginTop: 14 }}>사유: {b.decline_reason}</p>}
      </div>
      {isHost && b.status === 'requested' && (
        <div className="box" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ flex: 1, minWidth: 200 }}>요청에 24시간 안에 답하지 않으면 자동으로 만료돼요.</span>
          <button className="btn line" onClick={() => setModal('decline')}>거절</button>
          <button className="btn primary" onClick={() => setModal('accept')}>수락</button>
        </div>
      )}
      {canReview && <ReviewForm id={b.id} onDone={() => { notify('후기를 등록했어요. 고마워요!'); load(); }} />}
      {b.role !== 'admin' && <Messages bookingId={b.id} canWrite={!['cancelled', 'declined', 'expired'].includes(b.status)} />}
      {canCancel && <div style={{ marginTop: 16 }}><button className="btn ghost-danger" onClick={() => setModal('cancel')}>예약 취소</button></div>}

      {modal === 'accept' && <ConfirmModal title="예약을 수락할까요?" text="수락하면 게스트에게 주소와 연락처가 공개되고 예약이 확정돼요." okText="수락하기"
        onOk={() => act(`/api/host/bookings/${b.id}/accept`, {}, '예약을 수락했어요')} onClose={() => setModal(null)} />}
      {modal === 'decline' && <ConfirmModal title="예약을 거절할까요?" text="거절 사유는 게스트에게 보여요." okText="거절하기" danger reason reasonLabel="거절 사유 (선택)"
        onOk={r => act(`/api/host/bookings/${b.id}/decline`, { reason: r || undefined }, '예약을 거절했어요')} onClose={() => setModal(null)} />}
      {modal === 'cancel' && <ConfirmModal title="예약을 취소할까요?" text={isHost ? '확정된 예약을 호스트가 취소하면 게스트에게 큰 불편을 줘요. 반복되면 이용이 제한될 수 있어요.' : '취소하면 되돌릴 수 없어요.'}
        okText="예약 취소" danger reason reasonLabel="취소 사유 (선택)" onOk={r => act(`/api/bookings/${b.id}/cancel`, { reason: r || undefined }, '예약을 취소했어요')} onClose={() => setModal(null)} />}
    </main></>
  );
}
