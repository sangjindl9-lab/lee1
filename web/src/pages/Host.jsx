import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api, fmtD, fmtShort, won, man, photo, CAT_NAMES, todayLocal, addD, parseD, ymd } from '../lib.js';
import { useApp, Badge, LBadge, Avatar, ConfirmModal, Calendar, AMEN, Icon, Stepper, ErrorBox, useNarrow } from '../ui.jsx';

/* ---------- 호스트 시작 ---------- */
export function BecomeHost() {
  const { me, refresh, notify } = useApp();
  const nav = useNavigate();
  const [phone, setPhone] = useState(me.phone || ''), [agree, setAgree] = useState(false), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (me.role !== 'guest' && me.hostAgreed) nav('/host', { replace: true }); }, []);
  const go = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api('/api/me/become-host', { method: 'POST', body: { phone, agree } }); await refresh(); notify('호스트 등록을 마쳤어요'); nav('/host'); }
    catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <><TopBar /><main className="wrap narrow">
      <div className="head"><div><h1>내 공간을 머묾에 올려 보세요</h1><p>등록은 무료이고, 예약이 확정됐을 때만 수수료가 붙어요.</p></div></div>
      <div className="stats">
        <div className="stat"><small>1단계</small><b style={{ fontSize: 18 }}>숙소 정보·사진 등록</b></div>
        <div className="stat"><small>2단계</small><b style={{ fontSize: 18 }}>머묾 심사 (보통 1~2일)</b></div>
        <div className="stat"><small>3단계</small><b style={{ fontSize: 18 }}>예약 받고 정산</b></div>
      </div>
      <form className="box form" onSubmit={go}>
        <label>휴대폰 번호 <small>예약이 확정된 게스트와 머묾 운영팀만 볼 수 있어요</small><input id="host-phone" inputMode="tel" placeholder="010-1234-5678" value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label className="check"><input type="checkbox" id="host-agree" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>숙소 운영에 필요한 인허가(농어촌민박, 외국인관광 도시민박업, 한옥체험업 등)를 갖추고 있으며, <Link className="link" to="/terms">호스트 이용약관</Link>에 동의해요.</span></label>
        {err && <div className="err">{err}</div>}
        <div><button className="btn primary" disabled={busy || !agree}>호스트 시작하기</button></div>
      </form>
    </main></>
  );
}

/* ---------- 호스트 홈 ---------- */
function Chart({ months }) {
  const now = parseD(todayLocal());
  const rows = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); const k = ymd(d).slice(0, 7); return { k, label: `${d.getMonth() + 1}월`, v: Number(months.find(m => m.m === k)?.v || 0) }; });
  const max = Math.max(1, ...rows.map(r => r.v));
  return <div className="chart" aria-label="최근 6개월 정산 예정액">{rows.map(r => <div key={r.k}><b className="num">{r.v ? man(r.v) : ''}</b><i style={{ height: (r.v / max * 100) + '%' }} />{r.label}</div>)}</div>;
}

export function HostHome() {
  const { notify } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('requested');
  const [sum, setSum] = useState(null), [listings, setListings] = useState(null), [books, setBooks] = useState(null), [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const loadAll = () => {
    api('/api/host/summary').then(setSum).catch(e => setErr(e.message));
    api('/api/host/listings').then(r => setListings(r.items)).catch(e => setErr(e.message));
  };
  const loadBooks = () => { setBooks(null); api('/api/host/bookings?status=' + (tab === 'listings' ? 'all' : tab)).then(r => setBooks(r.items)).catch(e => setErr(e.message)); };
  useEffect(loadAll, []);
  useEffect(() => { if (tab !== 'listings') loadBooks(); }, [tab]);
  const create = () => nav('/host/listings/new');
  const decide = async (b, accept, reason) => {
    await api(`/api/host/bookings/${b.id}/${accept ? 'accept' : 'decline'}`, { method: 'POST', body: accept ? {} : { reason: reason || undefined } });
    notify(accept ? '예약을 수락했어요' : '예약을 거절했어요'); loadBooks(); loadAll();
  };
  if (err) return <><TopBar /><main className="wrap"><ErrorBox error={err} /></main></>;
  return (
    <><TopBar /><main className="wrap">
      <div className="head"><div><h1>호스트 관리</h1><p>예약 요청에 빨리 답할수록 검색 결과에서 유리해요.</p></div><button className="btn primary" onClick={create}>+ 새 숙소 등록</button></div>
      {sum && <div className="stats num">
        <div className="stat"><small>답해야 할 요청</small><b style={{ color: sum.requests ? 'var(--danger)' : undefined }}>{sum.requests}건</b></div>
        <div className="stat"><small>다가오는 예약</small><b>{sum.upcoming}건</b></div>
        <div className="stat"><small>이번 달 정산 예정</small><b>{won(sum.month_payout)}</b></div>
        <div className="stat"><small>게시 중인 숙소</small><b>{sum.live} / {sum.listings}</b></div>
      </div>}
      {sum && <div className="box" style={{ marginBottom: 24 }}><h3 className="h3" style={{ marginBottom: 0 }}>월별 정산 예정액</h3><Chart months={sum.months} /></div>}
      <div className="tabs" role="tablist">
        {[['requested', '예약 요청', sum?.requests], ['upcoming', '다가오는 예약'], ['past', '지난 예약'], ['cancelled', '취소·거절'], ['listings', '내 숙소']].map(([k, v, c]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{v}{c ? <span className="cnt">{c}</span> : null}</button>)}
      </div>
      {tab === 'listings' ? (!listings ? <div className="skel" style={{ height: 120 }} /> : listings.length ? (
        <div className="trips">{listings.map(l => (
          <div className="trip" key={l.id}>
            <div className="thumb">{l.cover ? <img src={photo(l.cover, true)} alt="" /> : <span className="noimg">사진 없음</span>}</div>
            <div style={{ minWidth: 0 }}>
              <LBadge s={l.status} />
              <h4>{l.title}</h4>
              <p className="num">{CAT_NAMES[l.category]} · {l.region} {l.area} · {won(l.price)}/박 · 사진 {l.photo_count}장</p>
              {l.reject_reason && ['rejected', 'suspended'].includes(l.status) && <p style={{ color: 'var(--danger)' }}>사유: {l.reject_reason}</p>}
            </div>
            <div className="acts"><Link className="btn sm line" to={`/rooms/${l.id}`}>미리보기</Link><Link className="btn sm primary" to={`/host/listings/${l.id}`}>관리</Link></div>
          </div>))}</div>
      ) : <div className="empty"><b>아직 등록한 숙소가 없어요</b><button className="link" onClick={create}>첫 숙소 등록하기</button></div>)
        : !books ? <div className="skel" style={{ height: 120 }} /> : books.length ? (
          <div className="trips">{books.map(b => (
            <div className="trip" key={b.id}>
              <Link to={`/bookings/${b.id}`} className="thumb">{b.cover && <img src={photo(b.cover, true)} alt="" />}</Link>
              <div style={{ minWidth: 0 }}>
                <Badge s={b.status} />
                <h4 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar name={b.guest_name} src={b.guest_avatar} />{b.guest_name}님 · {b.title}</h4>
                <p className="num">{fmtD(b.check_in)} – {fmtD(b.check_out)} · {b.nights}박 · {b.guests}명 · 정산 {won(b.host_payout)}</p>
                {b.message && <p style={{ color: 'var(--fg)' }}>“{b.message.slice(0, 120)}{b.message.length > 120 ? '…' : ''}”</p>}
              </div>
              <div className="acts">
                {b.status === 'requested' && <><button className="btn sm line" onClick={() => setModal({ b, accept: false })}>거절</button><button className="btn sm primary" onClick={() => setModal({ b, accept: true })}>수락</button></>}
                <Link className="btn sm line" to={`/bookings/${b.id}`}>메시지·상세</Link>
              </div>
            </div>))}</div>
        ) : <div className="empty"><b>{tab === 'requested' ? '답할 요청이 없어요' : '해당하는 예약이 없어요'}</b></div>}
      {modal && <ConfirmModal title={modal.accept ? '예약을 수락할까요?' : '예약을 거절할까요?'} text={`${modal.b.guest_name}님 · ${fmtD(modal.b.check_in)} – ${fmtD(modal.b.check_out)}`}
        okText={modal.accept ? '수락하기' : '거절하기'} danger={!modal.accept} reason={!modal.accept} reasonLabel="거절 사유 (선택, 게스트에게 보여요)"
        onOk={r => decide(modal.b, modal.accept, r)} onClose={() => setModal(null)} />}
    </main></>
  );
}

/* ---------- 숙소 등록·수정 ---------- */
const EMPTY = { title: '', description: '', category: 'cabin', region: '서울', area: '', address: '', price: 120000, cleaningFee: 20000, maxGuests: 2, bedrooms: 1, beds: 1, baths: 1,
  amenities: ['wifi'], rules: '실내 금연\n밤 10시 이후 정숙', checkinTime: '15:00', checkoutTime: '11:00', minNights: 1, instantBook: false };
const fromRow = l => ({ title: l.title, description: l.description, category: l.category, region: l.region, area: l.area, address: l.address, price: l.price, cleaningFee: l.cleaning_fee,
  maxGuests: l.max_guests, bedrooms: l.bedrooms, beds: l.beds, baths: l.baths, amenities: l.amenities, rules: l.rules, checkinTime: l.checkin_time, checkoutTime: l.checkout_time,
  minNights: l.min_nights, instantBook: l.instant_book });

function Photos({ l, reload }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const input = useRef(null);
  const up = async files => {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    const fd = new FormData();
    [...files].slice(0, 10).forEach(f => fd.append('photos', f));
    try { const r = await api(`/api/host/listings/${l.id}/photos`, { method: 'POST', form: fd }); notify(`사진 ${r.ids.length}장을 올렸어요${r.reReview ? '. 다시 심사를 받아요' : ''}`); await reload(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const move = async (i, d) => {
    const ids = [...l.photos]; const j = i + d; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api(`/api/host/listings/${l.id}/photos/order`, { method: 'PUT', body: { ids: ids.map(Number) } }); await reload(); } catch (e) { setErr(e.message); }
  };
  const del = async pid => { try { await api(`/api/host/listings/${l.id}/photos/${pid}`, { method: 'DELETE' }); await reload(); } catch (e) { setErr(e.message); } };
  return (
    <div className="box">
      <h3 className="h3">사진 <small className="hint">최소 3장 · 첫 사진이 대표 사진 · 위치 정보(EXIF)는 자동으로 지워져요</small></h3>
      <div className="photos">
        {l.photos.map((p, i) => (
          <div className="ph" key={p}>
            <img src={photo(p, true)} alt={`사진 ${i + 1}`} />
            {i === 0 && <span className="tag">대표</span>}
            <div className="ops">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="앞으로">‹</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === l.photos.length - 1} aria-label="뒤로">›</button>
              <button type="button" onClick={() => del(p)} aria-label="삭제">✕</button>
            </div>
          </div>))}
        <label className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); up(e.dataTransfer.files); }}>
          <input ref={input} id="photo-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={e => up(e.target.files)} />
          {busy ? '올리는 중…' : <span>+ 사진 추가<br /><small>끌어다 놓거나 눌러서 선택 (한 장 12MB 이하)</small></span>}
        </label>
      </div>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}

function BlockCal({ l, reload }) {
  const { notify } = useApp();
  const narrow = useNarrow();
  const [blocked, setBlocked] = useState(new Set(l.blocked)), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { setBlocked(new Set(l.blocked)); setDirty(false); }, [l.blocked.join()]);
  const marks = useMemo(() => {
    const m = {};
    for (const b of l.booked) { let d = parseD(b.check_in); while (ymd(d) < b.check_out) { m[ymd(d)] = 'booked'; d = addD(d, 1); } }
    for (const d of blocked) if (!m[d]) m[d] = 'blocked';
    return m;
  }, [blocked, l.booked]);
  const toggle = s => { const n = new Set(blocked); n.has(s) ? n.delete(s) : n.add(s); setBlocked(n); setDirty(true); };
  const save = async () => {
    setBusy(true);
    const orig = new Set(l.blocked);
    try {
      await api(`/api/host/listings/${l.id}/blocks`, { method: 'PUT', body: { add: [...blocked].filter(d => !orig.has(d)), remove: [...orig].filter(d => !blocked.has(d)) } });
      notify('달력을 저장했어요'); await reload();
    } catch (e) { notify(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="box">
      <h3 className="h3">예약 달력</h3>
      <p className="hint" style={{ margin: '-8px 0 12px' }}>빗금 날짜는 예약을 받지 않아요. 초록 날짜는 이미 예약됐어요.</p>
      <Calendar mode="multi" months={narrow ? 1 : 2} marks={marks} onToggle={toggle} />
      {l.booked.length > 0 && <div style={{ marginTop: 14 }}><b style={{ fontSize: 13 }}>진행 중인 예약</b>
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>{l.booked.map(b => <Link key={b.id} to={`/bookings/${b.id}`} className="num" style={{ fontSize: 13.5 }}><Badge s={b.status} /> {fmtShort(b.check_in)}–{fmtShort(b.check_out)} · {b.guest}님 · {b.code}</Link>)}</div></div>}
      <div style={{ marginTop: 14 }}><button className="btn primary sm" disabled={!dirty || busy} onClick={save}>달력 저장</button></div>
    </div>
  );
}

export function HostEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { config, notify } = useApp();
  const nav = useNavigate();
  const [l, setL] = useState(null), [v, setV] = useState(isNew ? EMPTY : null), [err, setErr] = useState(null), [loadErr, setLoadErr] = useState(null);
  const [busy, setBusy] = useState(false), [modal, setModal] = useState(null);
  const load = async () => { try { const r = await api(`/api/host/listings/${id}`); setL(r); setV(fromRow(r)); } catch (e) { setLoadErr(e.message); } };
  useEffect(() => { if (!isNew) load(); }, [id]);
  const set = k => e => setV({ ...v, [k]: e?.target ? (e.target.type === 'number' ? Number(e.target.value) : e.target.value) : e });
  const save = async e => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      if (isNew) { const r = await api('/api/host/listings', { method: 'POST', body: v }); notify('저장했어요. 이제 사진을 올려 주세요'); nav(`/host/listings/${r.id}`, { replace: true }); }
      else { const r = await api(`/api/host/listings/${id}`, { method: 'PUT', body: v }); notify(r.reReview ? '저장했어요. 공개 정보가 바뀌어 다시 심사를 받아요' : '저장했어요'); await load(); }
    } catch (e2) { setErr(e2.message); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };
  const action = async (path, method, msg) => { await api(path, { method }); notify(msg); if (method === 'DELETE') nav('/host'); else await load(); };
  if (loadErr) return <><TopBar /><main className="wrap narrow"><ErrorBox error={loadErr} /></main></>;
  if (!v) return <><TopBar /><main className="wrap narrow"><div className="skel" style={{ height: 300 }} /></main></>;
  const amen = Object.entries(AMEN);
  const fee = Math.round(v.price * (config?.hostFeeRate || 0.03));
  return (
    <><TopBar /><main className="wrap narrow">
      <p style={{ margin: '0 0 8px' }}><Link className="link" to="/host">← 호스트 관리</Link></p>
      <div className="head">
        <div>{l && <LBadge s={l.status} />}<h1>{isNew ? '새 숙소 등록' : v.title || '숙소 관리'}</h1>
          <p>{isNew ? '기본 정보를 저장하면 사진과 달력을 설정할 수 있어요.' : l.status === 'approved' ? '이름·소개·위치를 바꾸면 다시 심사를 받아요. 요금과 달력은 바로 반영돼요.' : '정보와 사진 3장 이상을 채운 뒤 심사를 요청하세요.'}</p></div>
        {l && <div className="tools">
          <Link className="btn line sm" to={`/rooms/${l.id}`}>미리보기</Link>
          {['draft', 'rejected'].includes(l.status) && <button className="btn primary sm" onClick={() => action(`/api/host/listings/${l.id}/submit`, 'POST', '심사를 요청했어요. 보통 1~2일 걸려요').catch(e => setErr(e.message))}>심사 요청</button>}
          {['approved', 'pending'].includes(l.status) && <button className="btn line sm" onClick={() => setModal('unpublish')}>게시 중단</button>}
        </div>}
      </div>
      {l?.reject_reason && ['rejected', 'suspended'].includes(l.status) && <div className="err" style={{ marginBottom: 16 }}>머묾 운영팀: {l.reject_reason}</div>}
      {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}

      <form className="form" onSubmit={save}>
        <div className="box form">
          <h3 className="h3" style={{ margin: 0 }}>기본 정보</h3>
          <label>숙소 이름<input id="f-title" maxLength={60} value={v.title} onChange={set('title')} placeholder="예: 협재 돌담집 독채" /></label>
          <div className="two">
            <label>숙소 유형<select id="f-cat" value={v.category} onChange={set('category')}>{Object.entries(CAT_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" id="f-instant" checked={v.instantBook} onChange={e => setV({ ...v, instantBook: e.target.checked })} /><span>즉시 예약 받기 <small className="hint">승인 없이 바로 확정</small></span></label>
          </div>
          <label>숙소 소개 <small>30자 이상 · 풍경, 동선, 주변 정보, 특별한 점</small><textarea id="f-desc" maxLength={4000} rows={6} value={v.description} onChange={set('description')} /></label>
        </div>
        <div className="box form">
          <h3 className="h3" style={{ margin: 0 }}>위치</h3>
          <div className="two">
            <label>지역<select id="f-region" value={v.region} onChange={set('region')}>{(config?.regions || []).map(r => <option key={r}>{r}</option>)}</select></label>
            <label>공개 지역 <small>검색·목록에 보여요</small><input id="f-area" maxLength={60} value={v.area} onChange={set('area')} placeholder="예: 제주시 한림읍" /></label>
          </div>
          <label>상세 주소 <small>예약이 확정된 게스트에게만 보여요</small><input id="f-addr" maxLength={200} value={v.address} onChange={set('address')} placeholder="도로명 주소와 동·호수" autoComplete="street-address" /></label>
        </div>
        <div className="box form">
          <h3 className="h3" style={{ margin: 0 }}>요금과 인원</h3>
          <div className="two">
            <label>1박 요금 (원)<input id="f-price" type="number" min={10000} max={10000000} step={1000} value={v.price} onChange={set('price')} /><small className="num">호스트 수수료 {won(fee)} 제외 후 1박 {won(v.price - fee)} 정산</small></label>
            <label>청소비 (원, 예약당)<input id="f-clean" type="number" min={0} max={1000000} step={1000} value={v.cleaningFee} onChange={set('cleaningFee')} /></label>
          </div>
          <div className="four">
            <Stepper label="최대 인원" value={v.maxGuests} min={1} max={30} onChange={set('maxGuests')} />
            <Stepper label="침실" value={v.bedrooms} min={0} max={30} onChange={set('bedrooms')} />
            <Stepper label="침대" value={v.beds} min={0} max={50} onChange={set('beds')} />
            <Stepper label="욕실" value={v.baths} min={0} max={30} onChange={set('baths')} />
          </div>
          <div className="three">
            <label>체크인<input id="f-in" type="time" value={v.checkinTime} onChange={set('checkinTime')} /></label>
            <label>체크아웃<input id="f-out" type="time" value={v.checkoutTime} onChange={set('checkoutTime')} /></label>
            <label>최소 숙박<select id="f-min" value={v.minNights} onChange={e => setV({ ...v, minNights: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7, 14, 30].map(n => <option key={n} value={n}>{n}박</option>)}</select></label>
          </div>
        </div>
        <div className="box form">
          <h3 className="h3" style={{ margin: 0 }}>편의시설</h3>
          <div className="amen-pick">{amen.map(([k, [name, d]]) => {
            const on = v.amenities.includes(k);
            return <label key={k} className={on ? 'on' : ''}><input type="checkbox" checked={on} onChange={() => setV({ ...v, amenities: on ? v.amenities.filter(x => x !== k) : [...v.amenities, k] })} /><Icon d={d} />{name}</label>;
          })}</div>
          <label>숙소 이용 규칙<textarea id="f-rules" maxLength={2000} rows={4} value={v.rules} onChange={set('rules')} /></label>
        </div>
        <div className="sticky-save">
          {!isNew && <button type="button" className="btn ghost-danger" onClick={() => setModal('delete')}>숙소 삭제</button>}
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={busy}>{busy ? '저장 중' : isNew ? '저장하고 다음' : '변경 내용 저장'}</button>
        </div>
      </form>
      {l && <div style={{ marginTop: 16 }}><Photos l={l} reload={load} /><BlockCal l={l} reload={load} /></div>}

      {modal === 'unpublish' && <ConfirmModal title="게시를 중단할까요?" text="검색에서 바로 사라져요. 이미 받은 예약은 그대로 유지돼요. 다시 올리려면 심사를 받아야 해요." okText="게시 중단"
        onOk={() => action(`/api/host/listings/${l.id}/unpublish`, 'POST', '게시를 중단했어요')} onClose={() => setModal(null)} />}
      {modal === 'delete' && <ConfirmModal title="숙소를 삭제할까요?" text="사진과 달력까지 모두 지워지고 되돌릴 수 없어요. 예약 기록이 있는 숙소는 삭제할 수 없어요." okText="삭제" danger
        onOk={() => action(`/api/host/listings/${l.id}`, 'DELETE', '숙소를 삭제했어요')} onClose={() => setModal(null)} />}
    </main></>
  );
}
