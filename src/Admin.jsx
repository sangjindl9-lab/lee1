import React, { useState } from 'react';
import Legal from './Legal.jsx';
import { REGIONS } from '../shared/core.js';

const won = (n) => `${Number(n).toLocaleString()}원`;
const dt = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS = { paid: '결제 완료', refunded: '환불 처리' };
const TABS = [['dash', '현황'], ['orders', '충전'], ['users', '회원'], ['reports', '신고'], ['content', '콘텐츠'], ['mkt', '마케팅'], ['push', '단체 알림'], ['legal', '수사협조'], ['config', '설정']];

function Settings({ config, send }) {
  const [c, setC] = useState(() => JSON.parse(JSON.stringify(config)));
  const [words, setWords] = useState(config.banWords.join(', '));
  const [saved, setSaved] = useState(false);
  const set = (k, v) => { setC({ ...c, [k]: v }); setSaved(false); };
  const setP = (i, k, v) => set('products', c.products.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const Num = ({ k, label, unit = 'P' }) => (
    <label className="a-num"><span>{label}</span><span className="a-in"><input type="number" min={0} value={c[k]} onChange={(e) => set(k, e.target.value)} /><em>{unit}</em></span></label>
  );
  const save = () => { send({ t: 'admin.config', config: { ...c, banWords: words.split(',').map((w) => w.trim()).filter(Boolean) } }); setSaved(true); };
  return (
    <div className="a-stack">
      <section className="a-card"><h3>포인트 규칙</h3>
        {Num({ k: 'startPoints', label: '가입 축하 포인트' })}{Num({ k: 'attend', label: '출석체크' })}{Num({ k: 'bonus3', label: '3일 연속 보너스' })}{Num({ k: 'bonus7', label: '7일 연속 보너스' })}
        {Num({ k: 'requestCost', label: '대화 신청 비용 (거절 시 환불)' })}{Num({ k: 'pinCost', label: '토크 상단 고정 비용' })}{Num({ k: 'pinMin', label: '상단 고정 시간', unit: '분' })}
      </section>
      <section className="a-card"><h3>수익 상품</h3>
        {Num({ k: 'boostCost', label: '프로필 부스트 가격' })}{Num({ k: 'boostMin', label: '부스트 지속 시간', unit: '분' })}
        <label className="a-num"><span>VIP 구독 상품 ID (Play Console과 같게)</span><span className="a-in"><input value={c.vipSku} onChange={(e) => set('vipSku', e.target.value)} /></span></label>
        {Num({ k: 'vipPrice', label: 'VIP 표시 가격 (실제 금액은 Play Console)', unit: '원' })}{Num({ k: 'vipPoints', label: 'VIP 매달 지급 포인트' })}
        {Num({ k: 'vipRequestPct', label: 'VIP 대화 신청 할인', unit: '%' })}{Num({ k: 'vipFreeBoost', label: 'VIP 하루 무료 부스트', unit: '회' })}
        {Num({ k: 'visitorCost', label: '방문자 보기 가격' })}{Num({ k: 'visitorHours', label: '방문자 보기 시간', unit: '시간' })}
        {Num({ k: 'giftMin', label: '선물 최소' })}{Num({ k: 'giftMax', label: '선물 1회 최대' })}{Num({ k: 'giftDayMax', label: '선물 하루 최대 (0 = 제한 없음)' })}
        {Num({ k: 'massCost', label: '전체 쪽지 1명당 가격' })}{Num({ k: 'massDayMax', label: '전체 쪽지 하루 횟수 (0 = 제한 없음)', unit: '회' })}
        {Num({ k: 'massAllMax', label: "전체 쪽지 '전체' 선택 시 최대 인원", unit: '명' })}{Num({ k: 'massCooldownMin', label: '전체 쪽지 재발송 대기', unit: '분' })}
        {Num({ k: 'pickCount', label: '오늘의 추천 친구 인원 (0 = 끔)', unit: '명' })}{Num({ k: 'pickHour', label: '추천 친구 알림 시각 (21시 이전)', unit: '시' })}
      </section>
      <section className="a-card"><h3>마케팅 보상</h3>
        {Num({ k: 'inviteJoin', label: '초대받아 가입한 친구에게' })}{Num({ k: 'inviteReward', label: '초대한 사람에게 (친구 첫 출석 시)' })}
        {Num({ k: 'inviteMonthMax', label: '초대 보상 월 최대 인원 (0 = 제한 없음)', unit: '명' })}
        {Num({ k: 'inviteMilestone', label: '초대 달성 보너스 기준 (0 = 끔)', unit: '명마다' })}{Num({ k: 'inviteMilestoneBonus', label: '초대 달성 보너스' })}
        {Num({ k: 'firstBuyPct', label: '첫 충전 보너스 (0 = 끔)', unit: '%' })}
        {Num({ k: 'comebackDays', label: '복귀 보너스 기준 (0 = 끔)', unit: '일 이상' })}{Num({ k: 'comebackPoints', label: '복귀 보너스' })}
      </section>
      <section className="a-card"><h3>기록 보관 기간 (수사 협조용, 최소 90일)</h3>
        {Num({ k: 'keepLogsDays', label: '접속 기록 (IP·기기)', unit: '일' })}{Num({ k: 'keepTrailDays', label: '작성·삭제 원본', unit: '일' })}{Num({ k: 'keepReportsDays', label: '신고 및 신고 시점 증거', unit: '일' })}
      </section>
      <section className="a-card"><h3>충전 상품</h3>
        <p className="meta">상품 ID는 Google Play Console에 등록한 인앱 상품 ID와 똑같이 적어야 결제가 됩니다. 실제 결제 금액은 Play Console 가격이 적용됩니다.</p>
        {c.products.map((p, i) => (
          <div key={p.id} className="a-prod">
            <label>상품명<input value={p.name} maxLength={16} onChange={(e) => setP(i, 'name', e.target.value)} /></label>
            <label>Play 상품 ID<input value={p.sku || ''} maxLength={40} onChange={(e) => setP(i, 'sku', e.target.value)} /></label>
            <label>포인트<input type="number" min={0} value={p.points} onChange={(e) => setP(i, 'points', e.target.value)} /></label>
            <label>보너스<input type="number" min={0} value={p.bonus} onChange={(e) => setP(i, 'bonus', e.target.value)} /></label>
            <label>표시 가격(원)<input type="number" min={0} value={p.price} onChange={(e) => setP(i, 'price', e.target.value)} /></label>
            <button className="btn sm ghost danger" onClick={() => set('products', c.products.filter((_, j) => j !== i))}>상품 삭제</button>
          </div>
        ))}
        <button className="btn sm ghost" onClick={() => set('products', [...c.products, { id: `n${Date.now().toString(36)}`, sku: '', name: '', points: 100, bonus: 0, price: 1100 }])}>상품 추가</button>
      </section>
      <section className="a-card"><h3>공지 · 금지어</h3>
        <div className="form">
          <input placeholder="토크 화면 상단 공지 (비우면 표시 안 함)" maxLength={100} value={c.notice} onChange={(e) => set('notice', e.target.value)} />
          <textarea rows={3} placeholder="금지어를 쉼표로 구분해 입력" value={words} onChange={(e) => { setWords(e.target.value); setSaved(false); }} />
        </div>
      </section>
      <button className="btn" onClick={save}>{saved ? '저장되었습니다' : '설정 저장'}</button>
    </div>
  );
}

function Broadcast({ d, send }) {
  const [f, setF] = useState({ title: '', body: '', region: '' }); const [ok, setOk] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setOk(false); };
  const h = new Date(Date.now() + 9 * 3600e3).getUTCHours(); const night = h >= 21 || h < 8;
  return (
    <div className="a-stack">
      <section className="a-card"><h3>단체 알림 보내기</h3>
        <p className="meta">이벤트·혜택 알림을 켠 회원(광고성 정보 수신 동의) <b>{d.revenue.eventOn}명</b>에게만 보냅니다. 법에 따라 제목 앞에 "(광고)"와 수신거부 방법이 자동으로 붙고, 밤 9시 ~ 아침 8시에는 보낼 수 없습니다. 앱을 보고 있는 회원에게는 화면 팝업으로, 아니면 휴대폰 알림으로 갑니다.</p>
        <div className="form">
          <input placeholder="제목 (예: 주말 포인트 2배 이벤트)" maxLength={40} value={f.title} onChange={set('title')} />
          <textarea rows={4} placeholder="내용 (쿠폰 코드를 넣으면 회원이 MY > 쿠폰 등록에서 쓸 수 있습니다)" maxLength={300} value={f.body} onChange={set('body')} />
          <select value={f.region} onChange={set('region')}><option value="">전체 지역</option>{REGIONS.map((r) => <option key={r} value={r}>{r}만</option>)}</select>
          {night && <div className="hint err">지금은 광고성 알림을 보낼 수 없는 시간입니다.</div>}
          {!ok ? <button className="btn" disabled={!f.title.trim() || !f.body.trim() || night} onClick={() => setOk(true)}>보내기</button>
            : <div className="btn-row"><button className="btn danger" onClick={() => { send({ t: 'admin.broadcast', ...f }); setF({ title: '', body: '', region: '' }); setOk(false); }}>정말 보내기 (취소 불가)</button><button className="btn ghost" onClick={() => setOk(false)}>취소</button></div>}
        </div>
      </section>
      <section className="a-card"><h3>보낸 알림</h3>
        {d.notices.length === 0 && <p className="meta">보낸 알림이 없습니다.</p>}
        {d.notices.map((n) => <div key={n.id} className="a-led"><span><b>{n.title}</b> {n.region && <em className="tag soft">{n.region}</em>}<br /><span className="meta">{dt(n.at)} · {n.sent}명에게 발송</span><br />{n.body}</span></div>)}
      </section>
    </div>
  );
}

const INV = { pending: '첫 출석 대기', paid: '보상 지급', blocked: '지급 제외 (같은 IP)', capped: '월 한도 초과' };
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function Marketing({ m, send }) {
  const blank = { code: '', points: 100, max: 0, until: '', newDays: 0, memo: '', on: true };
  const [c, setC] = useState(blank);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const Stat = ({ label, value }) => <div className="a-stat"><span>{label}</span><b>{value}</b></div>;
  const iv = m.invites;
  return (
    <div className="a-stack">
      <div className="a-grid">
        <Stat label="전체 초대 가입" value={`${iv.total}명`} /><Stat label="이번 달 초대 가입" value={`${iv.month}명`} />
        <Stat label="보상 지급" value={`${iv.paid}명`} /><Stat label="첫 출석 대기" value={`${iv.pending}명`} />
        <Stat label="지급 제외 (같은 IP)" value={`${iv.blocked}명`} /><Stat label="초대 보상 지급 포인트" value={`${iv.points.toLocaleString()}P`} />
        <Stat label="첫 충전 보너스 받은 회원" value={`${m.firstBuyers}명`} /><Stat label="복귀 보너스 지급" value={`${m.comebacks}회`} />
      </div>
      <section className="a-card"><h3>쿠폰 만들기</h3>
        <p className="meta">이벤트·SNS·전단지에 쿠폰 코드를 공개하면 회원이 MY → 쿠폰 등록에서 입력해 포인트를 받습니다. 같은 코드로 다시 저장하면 내용이 바뀝니다.</p>
        <div className="a-coupon">
          <label>쿠폰 코드 (영문·숫자)<input value={c.code} maxLength={20} placeholder="예: OPEN2026" onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} /></label>
          <label>지급 포인트<input type="number" min={1} value={c.points} onChange={set('points')} /></label>
          <label>선착순 수량 (0 = 무제한)<input type="number" min={0} value={c.max} onChange={set('max')} /></label>
          <label>사용 기한 (비우면 무기한)<input type="date" min={today()} value={c.until} onChange={set('until')} /></label>
          <label>가입 N일 이내 회원만 (0 = 모두)<input type="number" min={0} value={c.newDays} onChange={set('newDays')} /></label>
          <label>메모 (회원 내역에 표시)<input value={c.memo} maxLength={30} placeholder="예: 오픈 기념" onChange={set('memo')} /></label>
        </div>
        <div className="btn-row"><button className="btn sm" disabled={c.code.length < 4} onClick={() => { send({ t: 'admin.coupon', coupon: c }); setC(blank); }}>쿠폰 저장</button></div>
        {m.coupons.length === 0 && <p className="meta">만든 쿠폰이 없습니다.</p>}
        {m.coupons.map((x) => (
          <div key={x.code} className={`a-led ${x.on ? '' : 'off'}`}>
            <span><b>{x.code}</b> {x.points.toLocaleString()}P {x.memo && `· ${x.memo}`}<br />
              <span className="meta">사용 {x.usedCount}{x.max ? ` / ${x.max}` : ''}회 · {x.until ? `${new Date(x.until).toLocaleDateString('ko-KR')}까지` : '무기한'}{x.newDays ? ` · 가입 ${x.newDays}일 이내` : ''}{x.on ? '' : ' · 중지됨'}</span></span>
            <span className="btn-row">
              <button className="btn sm ghost" onClick={() => send({ t: 'admin.coupon', coupon: { ...x, until: x.until ? new Date(x.until + 9 * 3600e3).toISOString().slice(0, 10) : '', on: !x.on } })}>{x.on ? '중지' : '재개'}</button>
              <button className="btn sm ghost danger" onClick={() => send({ t: 'admin.coupon.del', code: x.code })}>삭제</button>
            </span>
          </div>
        ))}
      </section>
      <section className="a-card"><h3>초대 순위</h3>
        {m.top.length === 0 && <p className="meta">아직 초대 기록이 없습니다.</p>}
        {m.top.map((t, i) => <div key={t.uid} className="a-led"><span><b>{i + 1}. {t.nick}</b><br /><span className="meta">초대 {t.total}명 · 보상 {t.paid}명{t.blocked ? ` · 제외 ${t.blocked}명` : ''}</span></span></div>)}
      </section>
      <section className="a-card"><h3>최근 초대 가입</h3>
        <p className="meta">한 사람이 같은 IP로 계속 초대 가입시키면 부정 이용일 수 있습니다. 회원 탭에서 포인트 차감·이용 정지로 조치하세요.</p>
        {m.recent.length === 0 && <p className="meta">기록이 없습니다.</p>}
        {m.recent.map((x) => <div key={x.id} className="a-led"><span><b>{x.by}</b> → {x.nick}<br /><span className="meta">{dt(x.at)} · {x.ip || 'IP 없음'}</span></span><em className={`tag ${x.status === 'paid' ? 'soft' : ''}`}>{INV[x.status] || x.status}</em></div>)}
      </section>
    </div>
  );
}

function Users({ users, send }) {
  const [q, setQ] = useState(''); const [sel, setSel] = useState(null); const [delta, setDelta] = useState(''); const [memo, setMemo] = useState('');
  const list = users.filter((u) => u.nick.includes(q.trim()));
  const give = (sign) => { const n = Math.abs(parseInt(delta, 10) || 0); if (n) { send({ t: 'admin.point', uid: sel, delta: sign * n, memo }); setDelta(''); setMemo(''); } };
  return (
    <div className="a-stack">
      <div className="form"><input placeholder="닉네임 검색" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.length === 0 && <p className="empty">해당하는 회원이 없습니다.</p>}
      {list.map((u) => (
        <div key={u.id} className={`a-card a-row ${u.banned ? 'off' : ''}`}>
          <div className="a-line"><b>{u.nick}</b>{u.bot && <em className="tag soft">가상</em>}{u.banned && <em className="tag">정지</em>}{u.online && <em className="tag soft">접속</em>}<span className="a-pts">{u.points.toLocaleString()}P</span></div>
          <div className="meta">{u.gender === 'F' ? '여' : '남'} · {u.age} · {u.region} · 가입 {dt(u.at)}</div>
          <div className="btn-row">
            <button className="btn sm ghost" onClick={() => setSel(sel === u.id ? null : u.id)}>포인트 지급·차감</button>
            <button className="btn sm ghost danger" onClick={() => send({ t: 'admin.ban', uid: u.id, on: !u.banned })}>{u.banned ? '정지 해제' : '이용 정지'}</button>
          </div>
          {sel === u.id && (
            <div className="form a-give">
              <input type="number" min={1} placeholder="포인트" value={delta} onChange={(e) => setDelta(e.target.value)} />
              <input placeholder="사유 (회원 내역에 표시)" maxLength={30} value={memo} onChange={(e) => setMemo(e.target.value)} />
              <div className="btn-row"><button className="btn sm" onClick={() => give(1)}>지급</button><button className="btn sm danger" onClick={() => give(-1)}>차감</button></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Admin({ adm, send, onExit, demo }) {
  const [pw, setPw] = useState(''); const [tab, setTab] = useState('dash'); const [kind, setKind] = useState('talks');
  if (adm.state !== 'in' || !adm.data) {
    return (
      <div className="app onboard">
        <div className="logo">이음챗 관리자</div>
        <p className="lead">{demo ? '체험판 관리자 비밀번호는 admin 입니다.' : '서버 환경변수 ADMIN_PASSWORD 에 설정한 비밀번호를 입력하세요.'}</p>
        <form className="form" onSubmit={(e) => { e.preventDefault(); send({ t: 'admin.login', pw }); }}>
          <input type="password" placeholder="관리자 비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          {adm.state === 'fail' && <div className="hint err">{adm.off ? '서버에 ADMIN_PASSWORD 가 설정되지 않아 관리자 화면이 잠겨 있습니다.' : '비밀번호가 맞지 않습니다.'}</div>}
          <button className="btn" disabled={!pw}>로그인</button>
          <button type="button" className="btn ghost" onClick={onExit}>앱으로 돌아가기</button>
        </form>
      </div>
    );
  }
  const d = adm.data; const s = d.stats;
  const Stat = ({ label, value, hot }) => <div className={`a-stat ${hot ? 'hot' : ''}`}><span>{label}</span><b>{value}</b></div>;
  return (
    <div className="app admin">
      <header className="bar top"><b className="tab-title">관리자</b><button className="btn sm ghost" onClick={onExit}>앱으로</button></header>
      <div className="filters"><div className="chips">{TABS.map(([k, label]) => (
        <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label}{k === 'reports' && s.reportsOpen > 0 ? ` ${s.reportsOpen}` : ''}</button>
      ))}</div></div>
      <div className="list a-list">
        {tab === 'dash' && (
          <div className="a-stack">
            <div className="a-grid">
              <Stat label="오늘 결제" value={`${s.paidToday}건`} /><Stat label="미처리 신고" value={`${s.reportsOpen}건`} hot={s.reportsOpen > 0} />
              <Stat label="오늘 매출" value={won(s.salesToday)} /><Stat label="누적 매출" value={won(s.salesTotal)} />
              <Stat label="회원" value={`${s.users}명`} /><Stat label="현재 접속" value={`${s.online}명`} />
              <Stat label="오늘 가입" value={`${s.joinedToday}명`} /><Stat label="오늘 토크" value={`${s.talksToday}개`} />
              <Stat label="회원 보유 포인트 합계" value={`${s.pointsHeld.toLocaleString()}P`} /><Stat label="이용 정지" value={`${s.banned}명`} />
              {d.revenue && <><Stat label="VIP 구독 중" value={`${d.revenue.vip}명`} /><Stat label="오늘 부스트" value={`${d.revenue.boostsToday}회`} />
              <Stat label="오늘 선물" value={`${d.revenue.giftsToday.toLocaleString()}P`} /><Stat label="방문자 보기 구매" value={`${d.revenue.visitOpens}회`} /><Stat label="오늘 전체 쪽지" value={`${d.revenue.massToday}회`} /></>}
            </div>
            <section className="a-card"><h3>최근 포인트 변동</h3>
              {d.ledger.length === 0 && <p className="meta">아직 내역이 없습니다.</p>}
              {d.ledger.slice(0, 30).map((l) => <div key={l.id} className="a-led"><span><b>{l.nick}</b> {l.reason}<br /><span className="meta">{dt(l.at)} · 잔액 {l.balance.toLocaleString()}P</span></span><b className={l.delta > 0 ? 'plus' : 'minus'}>{l.delta > 0 ? '+' : ''}{l.delta.toLocaleString()}P</b></div>)}
            </section>
          </div>
        )}
        {tab === 'orders' && (
          <div className="a-stack">
            <p className="meta">Google Play 결제가 확인되면 포인트는 자동으로 지급됩니다. Google에서 환불된 결제는 여기서 환불 처리하면 지급한 포인트를 회수합니다.</p>
            {d.orders.length === 0 && <p className="empty">결제 내역이 없습니다.</p>}
            {d.orders.map((o) => (
              <div key={o.id} className={`a-card a-row ${o.status === 'refunded' ? 'off' : ''}`}>
                <div className="a-line"><b>{o.nick}</b><em className={`tag ${o.status === 'paid' ? 'soft' : ''}`}>{STATUS[o.status] || o.status}</em>{o.kind === 'sub' && <em className="tag soft">VIP 구독</em>}{o.test && <em className="tag">테스트 결제</em>}<span className="a-pts">{won(o.price)}</span></div>
                <div className="meta">{o.name} · {(o.points + o.bonus).toLocaleString()}P · {dt(o.at)}{o.orderId ? ` · 주문 ${o.orderId}` : ''}</div>
                {o.status === 'paid' && <div className="btn-row"><button className="btn sm ghost danger" onClick={() => send({ t: 'admin.refund', id: o.id })}>환불 처리 (포인트 회수)</button></div>}
              </div>
            ))}
          </div>
        )}
        {tab === 'users' && <Users users={d.users} send={send} />}
        {tab === 'reports' && (
          <div className="a-stack">
            {d.reports.length === 0 && <p className="empty">접수된 신고가 없습니다.</p>}
            {d.reports.map((r) => (
              <div key={r.id} className={`a-card a-row ${r.done ? 'off' : ''}`}>
                <div className="a-line"><b>{r.nick}</b><em className="tag">{r.reason}</em>{r.done && <em className="tag soft">처리 완료</em>}</div>
                <div className="meta">신고자 {r.byNick} · {r.ref} · {dt(r.at)}</div>
                {r.memo && <p className="a-memo">{r.memo}</p>}
                <div className="btn-row"><button className="btn sm ghost" onClick={() => send({ t: 'admin.report', id: r.id })}>{r.done ? '미처리로 되돌리기' : '처리 완료'}</button><button className="btn sm ghost danger" onClick={() => send({ t: 'admin.ban', uid: r.uid, on: true })}>대상 이용 정지</button></div>
              </div>
            ))}
          </div>
        )}
        {tab === 'content' && (
          <div className="a-stack">
            <div className="chips">{[['talks', '토크'], ['posts', '라운지 글'], ['rooms', '그룹방']].map(([k, label]) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{label} {d[k].length}</button>)}</div>
            {d[kind].length === 0 && <p className="empty">항목이 없습니다.</p>}
            {d[kind].map((x) => <div key={x.id} className="a-card a-led"><span>{x.text}<br /><span className="meta">{x.nick} · {dt(x.at)}</span></span><button className="btn sm ghost danger" onClick={() => send({ t: 'admin.del', kind, id: x.id })}>삭제</button></div>)}
          </div>
        )}
        {tab === 'mkt' && d.marketing && <Marketing m={d.marketing} send={send} />}
        {tab === 'push' && d.revenue && <Broadcast d={d} send={send} />}
        {tab === 'legal' && <Legal d={d} send={send} lookup={adm.lookup} exportRes={adm.exportRes} />}
        {tab === 'config' && <Settings config={d.config} send={send} />}
      </div>
    </div>
  );
}
