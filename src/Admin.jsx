import React, { useState } from 'react';
import Legal from './Legal.jsx';

const won = (n) => `${Number(n).toLocaleString()}원`;
const dt = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATUS = { paid: '결제 완료', refunded: '환불 처리' };
const TABS = [['dash', '현황'], ['orders', '충전'], ['users', '회원'], ['reports', '신고'], ['content', '콘텐츠'], ['legal', '수사협조'], ['config', '설정']];

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
                <div className="a-line"><b>{o.nick}</b><em className={`tag ${o.status === 'paid' ? 'soft' : ''}`}>{STATUS[o.status] || o.status}</em>{o.test && <em className="tag">테스트 결제</em>}<span className="a-pts">{won(o.price)}</span></div>
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
        {tab === 'legal' && <Legal d={d} send={send} lookup={adm.lookup} exportRes={adm.exportRes} />}
        {tab === 'config' && <Settings config={d.config} send={send} />}
      </div>
    </div>
  );
}
