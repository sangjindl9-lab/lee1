import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api, fmtD, fmtYM, won, photo, CAT_NAMES, nightsBetween } from '../lib.js';
import { useApp, Icon, P, Star, AMEN, Avatar, Calendar, useNarrow, ErrorBox, LBadge } from '../ui.jsx';

function Lightbox({ photos, i, onClose }) {
  const [k, setK] = useState(i);
  useEffect(() => {
    const f = e => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setK(x => Math.min(photos.length - 1, x + 1)); if (e.key === 'ArrowLeft') setK(x => Math.max(0, x - 1)); };
    addEventListener('keydown', f); document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', f); document.body.style.overflow = ''; };
  }, []);
  return (
    <div className="lb" role="dialog" aria-modal="true" aria-label="사진 보기">
      <div className="top"><button onClick={onClose}>✕ 닫기</button><span className="num">{k + 1} / {photos.length}</span><span style={{ width: 70 }} /></div>
      <div className="stage">
        <button className="nav" onClick={() => setK(Math.max(0, k - 1))} disabled={k === 0} aria-label="이전 사진">‹</button>
        <img src={photo(photos[k])} alt={`숙소 사진 ${k + 1}`} />
        <button className="nav" onClick={() => setK(Math.min(photos.length - 1, k + 1))} disabled={k === photos.length - 1} aria-label="다음 사진">›</button>
      </div>
    </div>
  );
}

export default function Listing() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { me, config, notify } = useApp();
  const nav = useNavigate();
  const narrow = useNarrow();
  const [l, setL] = useState(null), [err, setErr] = useState(null), [avail, setAvail] = useState(null);
  const [lb, setLb] = useState(null), [cal, setCal] = useState(false);
  const [quote, setQuote] = useState(null), [qErr, setQErr] = useState(null);
  const [step, setStep] = useState(0), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [bErr, setBErr] = useState(null);
  const bookRef = useRef(null);
  const ci = sp.get('checkIn'), co = sp.get('checkOut');
  const guests = Math.max(1, Number(sp.get('guests') || 1));
  const setQ = patch => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };

  useEffect(() => {
    setL(null); setErr(null);
    api(`/api/listings/${id}`).then(setL).catch(e => setErr(e.message));
    api(`/api/listings/${id}/availability`).then(r => setAvail({ ...r, set: new Set(r.unavailable) })).catch(() => setAvail({ set: new Set(), minNights: 1 }));
  }, [id]);
  useEffect(() => {
    setQuote(null); setQErr(null); setStep(0);
    if (!ci || !co || !l || l.status !== 'approved') return;
    api(`/api/listings/${id}/quote?checkIn=${ci}&checkOut=${co}&guests=${Math.min(guests, l.max_guests)}`).then(setQuote).catch(e => setQErr(e.message));
  }, [ci, co, guests, l?.id]);
  // 고른 날짜가 이미 막혀 있으면 지움
  useEffect(() => {
    if (!avail || !ci || !co) return;
    for (const d of avail.unavailable || []) if (d >= ci && d < co) { setQ({ checkIn: null, checkOut: null }); break; }
  }, [avail]);

  const g = l ? Math.min(guests, l.max_guests) : guests;
  const n = ci && co ? nightsBetween(ci, co) : 0;
  const isOwner = me && l && me.id === l.host_id;

  const like = async () => {
    if (!me) return nav('/login?next=' + encodeURIComponent(location.pathname + location.search));
    const on = !l.liked; setL({ ...l, liked: on });
    try { await api(`/api/wishlist/${l.id}`, { method: on ? 'POST' : 'DELETE' }); notify(on ? '위시리스트에 담았어요' : '위시리스트에서 뺐어요'); }
    catch (e) { setL({ ...l, liked: !on }); notify(e.message, true); }
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(location.origin + `/rooms/${l.id}`); notify('링크를 복사했어요'); } catch { notify('주소창의 링크를 복사해 주세요'); }
  };
  const book = async () => {
    if (!me) return nav('/login?next=' + encodeURIComponent(location.pathname + location.search));
    setBusy(true); setBErr(null);
    try {
      const r = await api('/api/bookings', { method: 'POST', body: { listingId: Number(l.id), checkIn: ci, checkOut: co, guests: g, message: msg.trim() || undefined } });
      notify(r.status === 'confirmed' ? '예약이 확정됐어요' : '예약 요청을 보냈어요. 호스트가 24시간 안에 답해요');
      nav(`/bookings/${r.id}`);
    } catch (e) {
      setBErr(e); setBusy(false);
      if (e.status === 409) api(`/api/listings/${id}/availability`).then(r => setAvail({ ...r, set: new Set(r.unavailable) }));
    }
  };

  if (err) return <><TopBar /><main className="wrap"><ErrorBox error={err} /></main></>;
  if (!l) return <><TopBar /><main className="wrap"><div className="skel" style={{ height: 36, maxWidth: 420, margin: '22px 0' }} /><div className="skel" style={{ aspectRatio: '2.3/1' }} /></main></>;

  const photos = l.photos || [];
  const st = l.stats || {};
  const rules = (l.rules || '').trim();
  const calProps = { today: avail?.today || config?.today, unavailable: avail?.set, minNights: avail?.minNights || l.min_nights, start: ci, end: co };

  return (
    <div className="has-mbook">
      <TopBar />
      <main className="wrap" style={{ paddingBottom: 120 }}>
        {l.status !== 'approved' && <div className="okmsg" style={{ marginTop: 16, background: 'var(--warn-soft)', color: 'var(--warn)' }}>미리보기 화면이에요. 현재 상태: <LBadge s={l.status} /> 게스트에게는 승인 후에 보여요.</div>}
        <h1 className="dtitle">{l.title}</h1>
        <div className="dsub">
          {st.n ? <span className="star num"><Star /><b>{Number(st.rating).toFixed(2)}</b> · 후기 {st.n}개</span> : <span>아직 후기가 없어요</span>}
          <span>{l.region} {l.area}</span>
          <span className="dact">
            <button className="ibtn" onClick={share}><Icon d={P.share} />공유</button>
            {!isOwner && <button className={'ibtn' + (l.liked ? ' on' : '')} onClick={like}><Icon d={P.heart} />{l.liked ? '저장됨' : '저장'}</button>}
          </span>
        </div>

        {photos.length ? (
          <div className={'gallery' + (!narrow && photos.length < 5 ? ' n1' : '')}>
            {(narrow ? photos : photos.length < 5 ? photos.slice(0, 1) : photos.slice(0, 5)).map((p, i) => (
              <button key={p} onClick={() => setLb(i)} aria-label={`사진 ${i + 1} 크게 보기`}><img src={photo(p)} alt="" loading={i ? 'lazy' : 'eager'} /></button>
            ))}
            <button className="all" onClick={() => setLb(0)}>사진 {photos.length}장 모두 보기</button>
          </div>
        ) : <div className="empty">사진이 아직 없어요</div>}

        <div className="dbody">
          <div>
            <div className="sec" style={{ paddingTop: 0 }}>
              <h2 className="h3" style={{ marginBottom: 4 }}>{CAT_NAMES[l.category]} · 호스트 {l.host?.name}님</h2>
              <div className="muted">최대 인원 {l.max_guests}명 · 침실 {l.bedrooms}개 · 침대 {l.beds}개 · 욕실 {l.baths}개</div>
            </div>
            <div className="sec">
              <div className="host"><Avatar name={l.host?.name} src={l.host?.avatar} lg />
                <div><b>호스트: {l.host?.name}님</b><p>{fmtYM(l.host?.created_at)} 가입 · 숙소 {l.host?.listings}곳{l.host?.reviews ? ` · 후기 ${l.host.reviews}개 · 평점 ${l.host.rating}` : ''}</p></div>
              </div>
              {l.host?.bio && <p className="desc" style={{ marginTop: 12 }}>{l.host.bio}</p>}
            </div>
            <div className="sec hl3">
              {l.instant_book
                ? <div><Icon d={P.bolt} /><span><b>즉시 예약</b>호스트 승인을 기다리지 않고 바로 확정돼요.</span></div>
                : <div><Icon d={P.chat} /><span><b>호스트 승인 후 확정</b>요청을 보내면 호스트가 24시간 안에 답해요.</span></div>}
              <div><Icon d={P.door} /><span><b>체크인 {l.checkin_time} · 체크아웃 {l.checkout_time}</b>정확한 주소와 연락처는 예약이 확정되면 보여요.</span></div>
              <div><Icon d={P.shield} /><span><b>안전한 대화</b>호스트와는 머묾 메시지로 연락하세요. 외부 계좌 송금 요청은 거절하고 신고해 주세요.</span></div>
            </div>
            <div className="sec"><h3>숙소 소개</h3><p className="desc">{l.description || '소개가 아직 없어요.'}</p></div>
            {!!l.amenities?.length && <div className="sec"><h3>편의시설</h3><div className="amen">{l.amenities.filter(a => AMEN[a]).map(a => <div key={a}><Icon d={AMEN[a][1]} />{AMEN[a][0]}</div>)}</div></div>}
            <div className="sec">
              <h3>날짜 선택</h3>
              <p className="muted" style={{ margin: '-6px 0 14px' }}>{n ? `${fmtD(ci)} – ${fmtD(co)} · ${n}박` : '여행 날짜를 고르면 정확한 요금이 보여요.'}</p>
              {avail && <Calendar {...calProps} months={narrow ? 1 : 2} onChange={(s, e) => setQ({ checkIn: s, checkOut: e })} />}
            </div>
            <div className="sec">
              <h3>알아 두기</h3>
              <div className="rules">
                <div><b>숙소 이용 규칙</b><p>{rules || '등록된 규칙이 없어요.'}</p></div>
                <div><b>체크인·아웃</b><p>체크인 {l.checkin_time} 이후{'\n'}체크아웃 {l.checkout_time} 이전{l.min_nights > 1 ? `\n최소 ${l.min_nights}박` : ''}</p></div>
                <div><b>취소</b><p>체크인 전날까지 화면에서 취소할 수 있어요. 결제 도입 후에는 환불 규정이 함께 표시돼요.</p></div>
              </div>
            </div>
            <div className="sec" style={{ borderBottom: 0 }}>
              {st.n ? <>
                <div className="rev-sum"><span className="big num">{Number(st.rating).toFixed(2)}</span><span className="muted">후기 {st.n}개</span></div>
                <div className="bars num">{[['청결도', st.cleanliness], ['정확도', st.accuracy], ['위치', st.location]].map(([k, v]) => (
                  <div key={k}><div className="t"><span>{k}</span><b>{Number(v).toFixed(1)}</b></div><div className="b"><i style={{ width: (v / 5 * 100) + '%' }} /></div></div>))}</div>
                <div className="reviews">{l.reviews.map(r => (
                  <div className="rv" key={r.id}>
                    <div className="who"><Avatar name={r.name} src={r.avatar} /><div><b>{r.name}</b><small>{fmtYM(r.created_at)} · ★ {r.rating}</small></div></div>
                    <p>{r.body}</p>
                    {r.host_reply && <div className="reply"><b>호스트 답글</b><br />{r.host_reply}</div>}
                  </div>))}</div>
              </> : <><h3>후기</h3><p className="muted">아직 후기가 없어요. 숙박을 마친 게스트만 후기를 남길 수 있어요.</p></>}
            </div>
          </div>

          <aside className="book" ref={bookRef}>
            <div className="p num"><b>{won(l.price)}</b><span>/박</span></div>
            <div className="fields">
              <div className="row">
                <button type="button" onClick={() => setCal(!cal)}><small>체크인</small><span className={ci ? '' : 'phd'}>{ci ? fmtD(ci) : '날짜 추가'}</span></button>
                <button type="button" onClick={() => setCal(!cal)}><small>체크아웃</small><span className={co ? '' : 'phd'}>{co ? fmtD(co) : '날짜 추가'}</span></button>
              </div>
              <div className="g">
                <div><small>인원</small><br /><span>게스트 {g}명</span></div>
                <div className="ctl">
                  <button type="button" disabled={g <= 1} onClick={() => setQ({ guests: g - 1 > 1 ? g - 1 : null })} aria-label="인원 줄이기">−</button>
                  <span className="num">{g}</span>
                  <button type="button" disabled={g >= l.max_guests} onClick={() => setQ({ guests: g + 1 })} aria-label="인원 늘리기">+</button>
                </div>
              </div>
            </div>
            {cal && avail && <div className="pop"><Calendar {...calProps} months={1} onChange={(s, e) => { setQ({ checkIn: s, checkOut: e }); if (e) setCal(false); }} /></div>}

            {isOwner ? <Link className="btn line block" style={{ marginTop: 14 }} to={`/host/listings/${l.id}`}>내 숙소 수정하기</Link>
              : l.status !== 'approved' ? <button className="btn primary block" style={{ marginTop: 14 }} disabled>예약할 수 없는 상태예요</button>
              : step === 0 ? <button type="button" className="btn primary block" style={{ marginTop: 14 }} disabled={!quote} onClick={() => setStep(1)}>{!n ? '날짜를 선택하세요' : quote ? (l.instant_book ? '예약하기' : '예약 요청하기') : '요금 확인 중'}</button>
              : <>
                <div className="confirm">
                  <b>예약 내용을 확인해 주세요</b><br />{fmtD(ci)} – {fmtD(co)}, {n}박 · 게스트 {g}명<br />총액 <b className="num">{won(quote.total)}</b>
                </div>
                <label className="lbl" style={{ marginTop: 12 }}>호스트에게 보낼 메시지 <small className="hint">선택 · 방문 목적, 도착 예정 시간 등</small>
                  <textarea className="inp" id="book-msg" rows={3} maxLength={1000} value={msg} onChange={e => setMsg(e.target.value)} /></label>
                {bErr && <div className="err" style={{ marginTop: 10 }}>{bErr.message}{bErr.code === 'PHONE_REQUIRED' && <> <Link className="link" to="/account">휴대폰 번호 등록하기</Link></>}</div>}
                <button type="button" className="btn primary block" style={{ marginTop: 12 }} disabled={busy} onClick={book}>{busy ? '보내는 중' : l.instant_book ? '확인하고 예약하기' : '확인하고 예약 요청'}</button>
                <button type="button" className="btn line block" style={{ marginTop: 8 }} onClick={() => setStep(0)}>다시 고르기</button>
              </>}
            {qErr && <div className="err" style={{ marginTop: 10 }}>{qErr}</div>}
            <p className="note">{me ? '아직 요금이 청구되지 않아요' : '예약하려면 로그인이 필요해요'}</p>
            {quote && (
              <div className="calc num">
                <div><span>{won(quote.nightly)} × {quote.nights}박</span><span>{won(quote.subtotal)}</span></div>
                {quote.cleaningFee > 0 && <div><span>청소비</span><span>{won(quote.cleaningFee)}</span></div>}
                <div><span>서비스 수수료</span><span>{won(quote.serviceFee)}</span></div>
                <div className="tot"><span>총액</span><span>{won(quote.total)}</span></div>
              </div>
            )}
          </aside>
        </div>
      </main>
      <div className="mbook">
        <div className="num"><b>{won(l.price)}</b> /박<br /><small className="muted">{n ? `${fmtD(ci)} – ${fmtD(co)}` : '날짜 미선택'}</small></div>
        <button type="button" className="btn primary" onClick={() => bookRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{n ? '예약하기' : '날짜 고르기'}</button>
      </div>
      {lb !== null && <Lightbox photos={photos} i={lb} onClose={() => setLb(null)} />}
    </div>
  );
}
