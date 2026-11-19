import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { connect, store, DEMO } from './api.js';
import { REGIONS, AGES, CATS, TOPICS, REPORT_REASONS } from '../shared/core.js';
import Admin from './Admin.jsx';
import { playService, playPrices, buy, pending, consume } from './pay.js';
const SUB_URL = (sku) => `https://play.google.com/store/account/subscriptions?sku=${sku}&package=kr.eumsoft.eumchat`;
import { pushSupported, permission, registerSW, enablePush, disablePush, currentSub } from './push.js';

// 초대 링크(?ref=코드)로 들어오면 코드를 기억해 두었다가 가입할 때 쓴다.
try { const r = new URLSearchParams(location.search).get('ref'); if (r) { store.set('eum_ref', r.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); history.replaceState(null, '', location.pathname); } } catch { /* 무시 */ }
const APP_URL = 'https://eumchat-production.up.railway.app';

const ICONS = {
  talk: 'M4 5h16v11H10l-6 4z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  group: 'M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 19c0-3 3-5 6-5s6 2 6 5M15 14c3 0 7 1 7 5',
  board: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  my: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-4 4-6 8-6s8 2 8 6',
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12l16-8-6 16-3-7z',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z',
  x: 'M6 6l12 12M18 6L6 18',
  chev: 'M9 5l7 7-7 7',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  ticket: 'M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4zM14 7v10',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
};
const Icon = ({ n, size = 22, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth={n === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]} /></svg>
);

const ago = (t) => {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return '방금';
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  return `${Math.floor(d / 86400)}일 전`;
};
const clock = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

const init = { ready: false, need: false, me: null, config: null, pushKey: '', notices: [], users: {}, talks: [], convs: [], rooms: [], room: {}, posts: [] };
function reducer(s, m) {
  switch (m.t) {
    case 'need_profile': return { ...s, need: true, ready: true };
    case 'ready': return { ...s, ready: true, need: false };
    case 'me': return { ...s, me: m.me };
    case 'config': return { ...s, config: m.config };
    case 'push.key': return { ...s, pushKey: m.key };
    case 'notices': return { ...s, notices: m.list };
    case 'users': return { ...s, users: Object.fromEntries(m.users.map((u) => [u.id, u])) };
    case 'talks': return { ...s, talks: m.talks };
    case 'convs': return { ...s, convs: m.convs };
    case 'rooms': return { ...s, rooms: m.rooms };
    case 'room': return { ...s, room: { ...s.room, [m.room.id]: m.room } };
    case 'room_gone': { const room = { ...s.room }; delete room[m.id]; return { ...s, room }; }
    case 'posts': return { ...s, posts: m.posts };
    default: return s;
  }
}

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);
const NOBODY = { id: '', nick: '(알 수 없음)', gender: 'M', age: '', region: '', intro: '' };

function Avatar({ u, size = 42 }) {
  return (
    <span className={`av ${u.gone ? 'gone' : u.gender}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {u.nick.replace('(', '')[0]}
      {u.online && <i className="dot" />}
    </span>
  );
}
const isBoost = (u) => (u.boostUntil || 0) > Date.now();
const Badges = ({ u }) => <>{u.vip && <em className="tag vip">VIP</em>}{isBoost(u) && <em className="tag boost">부스트</em>}</>;
const Meta = ({ u }) => <span className="meta">{u.gender === 'F' ? '여' : '남'} · {u.age} · {u.region}</span>;

function Sheet({ title, onClose, children }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head"><b>{title}</b><button className="ib" onClick={onClose} aria-label="닫기"><Icon n="x" /></button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
const Chips = ({ items, value, onChange }) => (
  <div className="chips">{items.map((it) => { const [v, label] = Array.isArray(it) ? it : [it, it]; return <button key={v} className={`chip ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>{label}</button>; })}</div>
);
const Empty = ({ children }) => <div className="empty">{children}</div>;

/* ---------- 프로필 입력 ---------- */
function ProfileForm({ initial, first, onSubmit }) {
  const [p, setP] = useState(initial || { nick: '', gender: '', age: '', region: '', intro: '' });
  const [agree, setAgree] = useState(!first);
  const [ref, setRef] = useState(() => (first ? store.get('eum_ref') || '' : ''));
  const [ad, setAd] = useState(false);
  const set = (k) => (v) => setP({ ...p, [k]: v });
  const ok = p.nick.trim().length >= 2 && p.gender && p.age && p.region && agree;
  return (
    <div className="form">
      <label>닉네임<input value={p.nick} maxLength={10} placeholder="2~10자" onChange={(e) => set('nick')(e.target.value)} /></label>
      <label>성별</label><Chips items={[['F', '여자'], ['M', '남자']]} value={p.gender} onChange={set('gender')} />
      <label>나이대</label><Chips items={AGES} value={p.age} onChange={set('age')} />
      <label>지역</label><Chips items={REGIONS} value={p.region} onChange={set('region')} />
      <label>한줄소개<input value={p.intro} maxLength={40} placeholder="나를 한 줄로 소개해 보세요" onChange={(e) => set('intro')(e.target.value)} /></label>
      {first && (
        <label>친구 초대 코드 <span className="meta">(선택)</span><input value={ref} maxLength={10} placeholder="친구에게 받은 코드가 있으면 입력" onChange={(e) => setRef(e.target.value.toUpperCase())} /></label>
      )}
      {first && (
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>만 19세 이상이며, 욕설·음란물·금전 요구·개인정보 요구를 하지 않겠습니다.</span></label>
      )}
      {first && (
        <label className="check"><input type="checkbox" checked={ad} onChange={(e) => setAd(e.target.checked)} />
          <span>(선택) 이벤트·쿠폰·혜택 소식을 알림으로 받겠습니다. 언제든 MY &gt; 알림 설정에서 끌 수 있습니다.</span></label>
      )}
      <button className="btn" disabled={!ok} onClick={() => onSubmit(p, ref.trim(), ad)}>{first ? '시작하기' : '저장'}</button>
    </div>
  );
}

/* ---------- 토크 ---------- */
function BoostBar() {
  const { me, s, send } = useApp(); const c = s.config;
  const left = Math.ceil(((me.boostUntil || 0) - Date.now()) / 60e3);
  const free = me.vipInfo?.freeBoostLeft > 0;
  return (
    <div className="boostbar">
      <Icon n="bolt" size={18} />
      <span className="grow">{left > 0 ? <><b>부스트 중</b> · {left}분 남음</> : <>내 프로필을 <b>{c.boostMin}분</b> 동안 맨 위에</>}</span>
      <button className="btn sm" onClick={() => send({ t: 'boost' })}>{free ? 'VIP 무료' : `${left > 0 ? '연장' : '부스트'} ${c.boostCost}P`}</button>
    </div>
  );
}
function PersonRow({ u, onClick }) {
  return (
    <button className={`row talk ${isBoost(u) ? 'pinned' : ''}`} onClick={onClick}>
      <Avatar u={u} />
      <span className="grow"><span className="line1"><b>{u.nick}</b><Meta u={u} /><Badges u={u} /></span><span className="text">{u.intro || ' '}</span></span>
      <span className="time">{u.online ? '접속 중' : ago(u.lastSeen)}</span>
    </button>
  );
}
function TalkTab() {
  const { s, me, U, hidden, setSheet } = useApp();
  const [g, setG] = useState('all');
  const [near, setNear] = useState(false);
  const [mode, setMode] = useState('talk');
  const notice = s.config.notice;
  const ok = (u) => !hidden(u.id) && (g === 'all' || u.gender === g) && (!near || u.region === me.region);
  const list = s.talks.filter((t) => { const u = U(t.uid); return ok({ ...u, id: t.uid }); });
  const people = Object.values(s.users).filter((u) => u.id !== me.id && !u.gone && ok(u))
    .sort((a, b) => (isBoost(b) - isBoost(a)) || (b.online - a.online) || (b.lastSeen - a.lastSeen)).slice(0, 200);
  return (
    <>
      <div className="filters">
        <Chips items={[['talk', '토크'], ['people', '주변 사람']]} value={mode} onChange={setMode} />
        <span className="sep" />
        <Chips items={[['all', '전체'], ['F', '여자'], ['M', '남자']]} value={g} onChange={setG} />
        <button className={`chip ${near ? 'on' : ''}`} onClick={() => setNear(!near)}>{me.region}만</button>
      </div>
      <div className="list">
        {notice && <div className="noticebar"><b>공지</b>{notice}</div>}
        <BoostBar />
        {mode === 'people' ? (
          <>
            {people.length === 0 && <Empty>조건에 맞는 사람이 없습니다.</Empty>}
            {people.map((u) => <PersonRow key={u.id} u={u} onClick={() => setSheet({ type: 'profile', uid: u.id })} />)}
          </>
        ) : <>
        {list.length === 0 && <Empty>등록된 토크가 없습니다.<br />첫 토크를 남겨 보세요.</Empty>}
        {list.map((t) => { const u = U(t.uid); const pinned = t.pinUntil > Date.now(); return (
          <button key={t.id} className={`row talk ${pinned || isBoost(u) ? 'pinned' : ''}`} onClick={() => setSheet({ type: 'profile', uid: t.uid, talk: t })}>
            <Avatar u={u} />
            <span className="grow">
              <span className="line1"><b>{u.nick}</b><Meta u={u} />{pinned && <em className="tag">상단</em>}<Badges u={u} /></span>
              <span className="text">{t.text}</span>
            </span>
            <span className="time">{ago(t.at)}</span>
          </button>
        ); })}
        </>}
      </div>
      <button className="fab" onClick={() => setSheet({ type: 'writeTalk' })} aria-label="토크 쓰기"><Icon n="plus" size={26} /></button>
    </>
  );
}
function WriteTalk({ close }) {
  const { send, me, s } = useApp();
  const [text, setText] = useState(''); const [pin, setPin] = useState(false);
  return (
    <Sheet title="토크 쓰기" onClose={close}>
      <div className="form">
        <textarea rows={3} maxLength={100} value={text} placeholder="지금 하고 싶은 말을 한 줄로 남겨 보세요" onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="hint">{text.length}/100 · 연락처, 금전 요구, 선정적인 글은 삭제될 수 있습니다.</div>
        <label className="check"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /><span>{s.config.pinMin}분 상단 고정 ({s.config.pinCost}P 차감 · 보유 {me.points.toLocaleString()}P)</span></label>
        <button className="btn" disabled={text.trim().length < 2} onClick={() => { send({ t: 'talk.add', text, pin }); close(); }}>등록하기</button>
      </div>
    </Sheet>
  );
}
function ProfileSheet({ uid, talk, close }) {
  const { send, me, U, setSheet, s, setView } = useApp();
  const u = U(uid); const mine = uid === me.id;
  const [text, setText] = useState('');
  const conv = s.convs.find((c) => [c.a, c.b].includes(uid) && c.status !== 'closed');
  const friend = me.friends.includes(uid); const blocked = me.blocks.includes(uid);
  useEffect(() => { if (!mine) send({ t: 'profile.view', uid }); }, [uid]);
  const cost = me.vipInfo?.on ? Math.floor((s.config.requestCost * (100 - s.config.vipRequestPct)) / 100) : s.config.requestCost;
  return (
    <Sheet title="프로필" onClose={close}>
      <div className="profile">
        <Avatar u={u} size={64} />
        <div><b className="big">{u.nick}</b> <Badges u={u} /><div><Meta u={u} /></div><div className="meta">{u.online ? '접속 중' : `최근 접속 ${ago(u.lastSeen)}`}</div></div>
      </div>
      {u.intro && <p className="intro">{u.intro}</p>}
      {talk && <p className="quote">{talk.text}</p>}
      {mine ? (
        talk ? <button className="btn ghost danger" onClick={() => { send({ t: 'talk.del', id: talk.id }); close(); }}>이 토크 삭제</button> : null
      ) : u.gone ? <Empty>탈퇴한 회원입니다.</Empty> : (
        <div className="form">
          {conv ? <>
            <button className="btn" onClick={() => { setView({ type: 'chat', id: conv.id }); close(); }}>대화방 열기</button>
            {conv.status === 'open' && <button className="btn ghost" onClick={() => setSheet({ type: 'gift', uid })}><Icon n="gift" size={18} /> 포인트 선물하기</button>}
          </> : !blocked && (
            <>
              <textarea rows={2} maxLength={200} value={text} placeholder="첫 인사를 적어 보세요 (비우면 기본 인사)" onChange={(e) => setText(e.target.value)} />
              <button className="btn" onClick={() => { if (me.points < cost) setSheet({ type: 'shop' }); else { send({ t: 'conv.request', to: uid, text }); close(); } }}>대화 신청{cost > 0 ? ` (${cost}P${me.vipInfo?.on && cost < s.config.requestCost ? ' · VIP 할인' : ''})` : ''}</button>
              {cost > 0 && <div className="hint">상대가 거절하면 포인트는 돌려받습니다. 보유 {me.points.toLocaleString()}P</div>}
            </>
          )}
          <div className="btn-row">
            <button className="btn ghost" onClick={() => send({ t: 'friend.toggle', uid })} disabled={blocked}>{friend ? '친구 해제' : '친구 추가'}</button>
            <button className="btn ghost" onClick={() => send({ t: 'block.toggle', uid })}>{blocked ? '차단 해제' : '차단'}</button>
            <button className="btn ghost danger" onClick={() => setSheet({ type: 'report', uid, ref: talk ? `토크:${talk.id}` : '프로필' })}>신고</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
function ReportSheet({ uid, refText, close }) {
  const { send, U } = useApp();
  const [reason, setReason] = useState(''); const [memo, setMemo] = useState('');
  return (
    <Sheet title={`${U(uid).nick} 님 신고`} onClose={close}>
      <div className="form">
        <Chips items={REPORT_REASONS} value={reason} onChange={setReason} />
        <textarea rows={3} maxLength={300} value={memo} placeholder="신고 내용을 적어 주세요 (선택)" onChange={(e) => setMemo(e.target.value)} />
        <div className="hint">신고하면 이 사용자는 함께 차단됩니다.</div>
        <button className="btn danger" disabled={!reason} onClick={() => { send({ t: 'report', uid, reason, memo, ref: refText }); close(); }}>신고하기</button>
      </div>
    </Sheet>
  );
}

/* ---------- 쪽지(1:1 대화) ---------- */
const unreadOf = (c, myId) => (c.status === 'open' ? c.msgs.filter((m) => !m.sys && m.uid !== myId && m.at > (c.read[myId] || 0)).length : 0);
function MailTab() {
  const { s, me, U, hidden, setView, send } = useApp();
  const [seg, setSeg] = useState('chat');
  const convs = s.convs.filter((c) => !hidden(c.a === me.id ? c.b : c.a));
  const incoming = convs.filter((c) => c.status === 'pending' && c.b === me.id);
  const chats = convs.filter((c) => !(c.status === 'pending' && c.b === me.id)).sort((a, b) => b.msgs.at(-1).at - a.msgs.at(-1).at);
  return (
    <>
      <div className="filters"><Chips items={[['chat', '대화'], ['req', `받은 신청 ${incoming.length || ''}`]]} value={seg} onChange={setSeg} /></div>
      <div className="list">
        {seg === 'chat' ? (
          <>
            {chats.length === 0 && <Empty>진행 중인 대화가 없습니다.<br />토크에서 마음에 드는 상대에게 대화를 신청해 보세요.</Empty>}
            {chats.map((c) => { const u = U(c.a === me.id ? c.b : c.a); const last = c.msgs.at(-1); const n = unreadOf(c, me.id); return (
              <button key={c.id} className="row" onClick={() => setView({ type: 'chat', id: c.id })}>
                <Avatar u={u} />
                <span className="grow"><span className="line1"><b>{u.nick}</b>{c.status === 'pending' && <em className="tag soft">수락 대기</em>}{c.status === 'closed' && <em className="tag soft">종료</em>}</span>
                  <span className="text one">{last.deleted ? '삭제된 메시지입니다.' : last.text}</span></span>
                <span className="time">{ago(last.at)}{n > 0 && <i className="badge">{n}</i>}</span>
              </button>
            ); })}
          </>
        ) : (
          <>
            {incoming.length === 0 && <Empty>받은 대화 신청이 없습니다.</Empty>}
            {incoming.map((c) => { const u = U(c.a); return (
              <div key={c.id} className="row req">
                <Avatar u={u} />
                <span className="grow"><span className="line1"><b>{u.nick}</b><Meta u={u} /></span><span className="text">{c.msgs[0].text}</span>
                  <span className="btn-row"><button className="btn sm" onClick={() => { send({ t: 'conv.accept', id: c.id }); setView({ type: 'chat', id: c.id }); }}>수락</button><button className="btn sm ghost" onClick={() => send({ t: 'conv.reject', id: c.id })}>거절</button></span></span>
              </div>
            ); })}
          </>
        )}
      </div>
    </>
  );
}
function Composer({ onSend, disabled, placeholder = '메시지 입력' }) {
  const [text, setText] = useState('');
  const go = () => { if (text.trim()) { onSend(text); setText(''); } };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <input value={text} disabled={disabled} placeholder={disabled ? '지금은 메시지를 보낼 수 없습니다' : placeholder} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      <button className="ib send" disabled={disabled || !text.trim()} aria-label="보내기"><Icon n="send" /></button>
    </form>
  );
}
function Messages({ msgs, myId, readAt, onPick, showNick }) {
  const { U, setSheet } = useApp();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  return (
    <div className="msgs">
      {msgs.map((m) => m.sys ? <div key={m.id} className="sys">{m.text}</div> : (
        <div key={m.id} className={`msg ${m.uid === myId ? 'me' : ''}`}>
          {m.uid !== myId && showNick && <button className="who" onClick={() => setSheet({ type: 'profile', uid: m.uid })}><Avatar u={U(m.uid)} size={30} /></button>}
          <div className="col">
            {m.uid !== myId && showNick && <span className="nick">{U(m.uid).nick}</span>}
            <div className="bubble-row">
              <button className={`bubble ${m.deleted ? 'del' : ''} ${m.gift ? 'giftmsg' : ''}`} onClick={() => !m.deleted && !m.gift && onPick?.(m)}>{m.gift && <Icon n="gift" size={16} />}{m.deleted ? '삭제된 메시지입니다.' : m.text}</button>
              <span className="mt">{m.uid === myId && readAt !== undefined && readAt < m.at && <i>1</i>}{clock(m.at)}</span>
            </div>
          </div>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
function ChatView({ id }) {
  const { s, me, U, send, setView, setSheet } = useApp();
  const c = s.convs.find((x) => x.id === id);
  const lastId = c?.msgs.at(-1)?.id;
  useEffect(() => { if (c && unreadOf(c, me.id) > 0) send({ t: 'conv.read', id }); }, [lastId]);
  useEffect(() => { if (!c) setView(null); }, [!c]);
  if (!c) return null;
  const oid = c.a === me.id ? c.b : c.a; const u = U(oid);
  const mineReq = c.status === 'pending' && c.a === me.id; const toMe = c.status === 'pending' && c.b === me.id;
  return (
    <div className="screen">
      <header className="bar">
        <button className="ib" onClick={() => setView(null)} aria-label="뒤로"><Icon n="back" /></button>
        <button className="title" onClick={() => setSheet({ type: 'profile', uid: oid })}><b>{u.nick} <Badges u={u} /></b><span className="meta">{u.online ? '접속 중' : `최근 접속 ${ago(u.lastSeen)}`}</span></button>
        <button className="ib" onClick={() => setSheet({ type: 'chatMenu', id, uid: oid })} aria-label="메뉴"><Icon n="more" /></button>
      </header>
      <Messages msgs={c.msgs} myId={me.id} readAt={c.read[oid] || 0} onPick={(m) => setSheet({ type: 'msgMenu', id, m })} />
      {mineReq && <div className="notice">상대가 수락하면 대화가 시작됩니다.</div>}
      {toMe ? (
        <div className="btn-row pad"><button className="btn" onClick={() => send({ t: 'conv.accept', id })}>대화 수락</button><button className="btn ghost" onClick={() => { send({ t: 'conv.reject', id }); setView(null); }}>거절</button></div>
      ) : <Composer disabled={c.status !== 'open'} onSend={(text) => send({ t: 'conv.send', id, text })} />}
    </div>
  );
}

/* ---------- 그룹채팅 ---------- */
function GroupTab() {
  const { s, me, send, setSheet, setView } = useApp();
  const [topic, setTopic] = useState('전체');
  const rooms = s.rooms.filter((r) => topic === '전체' || r.topic === topic).sort((a, b) => b.members.includes(me.id) - a.members.includes(me.id) || b.last - a.last);
  const enter = (r) => {
    if (r.members.includes(me.id)) setView({ type: 'room', id: r.id });
    else if (r.locked) setSheet({ type: 'joinPw', room: r });
    else send({ t: 'room.join', id: r.id });
  };
  return (
    <>
      <div className="filters"><Chips items={['전체', ...TOPICS]} value={topic} onChange={setTopic} /></div>
      <div className="list">
        {rooms.length === 0 && <Empty>아직 열린 방이 없습니다.<br />첫 그룹채팅방을 만들어 보세요.</Empty>}
        {rooms.map((r) => (
          <button key={r.id} className="row" onClick={() => enter(r)}>
            <span className="av room">{r.name[0]}</span>
            <span className="grow"><span className="line1"><b>{r.name}</b>{r.locked && <Icon n="lock" size={14} />}{r.members.includes(me.id) && <em className="tag">참여 중</em>}</span>
              <span className="text one">{r.intro || `${r.topic} 이야기를 나누는 방`}</span></span>
            <span className="time">{r.topic}<br />{r.count}/{r.max}명</span>
          </button>
        ))}
      </div>
      <button className="fab" onClick={() => setSheet({ type: 'newRoom' })} aria-label="그룹채팅 만들기"><Icon n="plus" size={26} /></button>
    </>
  );
}
function NewRoom({ close }) {
  const { send } = useApp();
  const [r, setR] = useState({ name: '', topic: '', intro: '', max: 20, pw: '' });
  const set = (k) => (e) => setR({ ...r, [k]: e.target ? e.target.value : e });
  return (
    <Sheet title="그룹채팅 만들기" onClose={close}>
      <div className="form">
        <label>방 이름<input value={r.name} maxLength={20} onChange={set('name')} placeholder="2~20자" /></label>
        <label>주제</label><Chips items={TOPICS} value={r.topic} onChange={set('topic')} />
        <label>방 소개<input value={r.intro} maxLength={60} onChange={set('intro')} placeholder="어떤 방인지 알려 주세요" /></label>
        <label>최대 인원<input type="number" min={2} max={100} value={r.max} onChange={set('max')} /></label>
        <label>비밀번호 (비밀방으로 만들 때만)<input value={r.pw} maxLength={12} onChange={set('pw')} placeholder="비워 두면 공개방" /></label>
        <button className="btn" disabled={r.name.trim().length < 2 || !r.topic} onClick={() => { send({ t: 'room.create', ...r }); close(); }}>만들기</button>
      </div>
    </Sheet>
  );
}
function JoinPw({ room, close }) {
  const { send } = useApp(); const [pw, setPw] = useState('');
  return (
    <Sheet title={`'${room.name}' 입장`} onClose={close}>
      <div className="form"><label>비밀번호<input value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
        <button className="btn" disabled={!pw} onClick={() => { send({ t: 'room.join', id: room.id, pw }); close(); }}>입장하기</button></div>
    </Sheet>
  );
}
function RoomView({ id }) {
  const { s, me, send, setView, setSheet } = useApp();
  const r = s.room[id];
  useEffect(() => { if (!r) setView(null); }, [!r]);
  if (!r) return null;
  return (
    <div className="screen">
      <header className="bar">
        <button className="ib" onClick={() => setView(null)} aria-label="뒤로"><Icon n="back" /></button>
        <button className="title" onClick={() => setSheet({ type: 'members', id })}><b>{r.name}</b><span className="meta">{r.topic} · 참여자 {r.members.length}명</span></button>
        <button className="ib" onClick={() => setSheet({ type: 'members', id })} aria-label="참여자"><Icon n="group" /></button>
      </header>
      <Messages msgs={r.msgs} myId={me.id} showNick />
      <Composer onSend={(text) => send({ t: 'room.send', id, text })} />
    </div>
  );
}
function Members({ id, close }) {
  const { s, me, U, send, setSheet } = useApp(); const r = s.room[id];
  if (!r) return null;
  return (
    <Sheet title={`참여자 ${r.members.length}명`} onClose={close}>
      {r.intro && <p className="intro">{r.intro}</p>}
      {r.members.map((uid) => { const u = U(uid); return (
        <div key={uid} className="row flat">
          <button className="who" onClick={() => setSheet({ type: 'profile', uid })}><Avatar u={u} size={36} /></button>
          <span className="grow"><b>{u.nick}</b>{uid === r.owner && <em className="tag">방장</em>}{uid === me.id && <em className="tag soft">나</em>}</span>
          {r.owner === me.id && uid !== me.id && <button className="btn sm ghost danger" onClick={() => send({ t: 'room.kick', id, uid })}>강퇴</button>}
        </div>
      ); })}
      <button className="btn ghost" onClick={() => send({ t: 'room.mute', id })}>{me.notify?.mutedRooms?.includes(id) ? '이 방 알림 켜기' : '이 방 알림 끄기'}</button>
      <button className="btn ghost danger" onClick={() => { send({ t: 'room.leave', id }); close(); }}>채팅방 나가기</button>
    </Sheet>
  );
}

/* ---------- 라운지 ---------- */
function LoungeTab() {
  const { s, U, hidden, setSheet, setView } = useApp();
  const [cat, setCat] = useState('전체');
  const posts = s.posts.filter((p) => !hidden(p.uid) && (cat === '전체' || p.cat === cat));
  return (
    <>
      <div className="filters"><Chips items={['전체', ...CATS]} value={cat} onChange={setCat} /></div>
      <div className="list">
        {posts.length === 0 && <Empty>아직 글이 없습니다.</Empty>}
        {posts.map((p) => (
          <button key={p.id} className="row post" onClick={() => setView({ type: 'post', id: p.id })}>
            <span className="grow"><span className="line1"><em className="tag soft">{p.cat}</em><b>{p.title}</b></span>
              <span className="text one">{p.body}</span>
              <span className="meta">{U(p.uid).nick} · {ago(p.at)} · 좋아요 {p.likes.length} · 댓글 {p.comments.length}</span></span>
          </button>
        ))}
      </div>
      <button className="fab" onClick={() => setSheet({ type: 'writePost' })} aria-label="글쓰기"><Icon n="plus" size={26} /></button>
    </>
  );
}
function WritePost({ close }) {
  const { send } = useApp(); const [p, setP] = useState({ cat: '', title: '', body: '' });
  return (
    <Sheet title="글쓰기" onClose={close}>
      <div className="form">
        <Chips items={CATS} value={p.cat} onChange={(cat) => setP({ ...p, cat })} />
        <input value={p.title} maxLength={40} placeholder="제목" onChange={(e) => setP({ ...p, title: e.target.value })} />
        <textarea rows={6} maxLength={2000} value={p.body} placeholder="내용을 입력해 주세요" onChange={(e) => setP({ ...p, body: e.target.value })} />
        <button className="btn" disabled={!p.cat || p.title.trim().length < 2 || !p.body.trim()} onClick={() => { send({ t: 'post.add', ...p }); close(); }}>등록하기</button>
      </div>
    </Sheet>
  );
}
function PostView({ id }) {
  const { s, me, U, hidden, send, setView, setSheet } = useApp();
  const p = s.posts.find((x) => x.id === id);
  useEffect(() => { if (!p) setView(null); }, [!p]);
  if (!p) return null;
  const u = U(p.uid); const liked = p.likes.includes(me.id);
  return (
    <div className="screen">
      <header className="bar">
        <button className="ib" onClick={() => setView(null)} aria-label="뒤로"><Icon n="back" /></button>
        <span className="title"><b>라운지 · {p.cat}</b></span>
        {p.uid === me.id ? <button className="ib text-btn" onClick={() => send({ t: 'post.del', id })}>삭제</button> : <button className="ib text-btn" onClick={() => setSheet({ type: 'report', uid: p.uid, ref: `글:${p.id}` })}>신고</button>}
      </header>
      <div className="post-body">
        <h2>{p.title}</h2>
        <button className="row flat" onClick={() => setSheet({ type: 'profile', uid: p.uid })}><Avatar u={u} size={34} /><span className="grow"><b>{u.nick}</b><span className="meta"> {ago(p.at)}</span></span></button>
        <p className="body">{p.body}</p>
        <button className={`btn sm ${liked ? '' : 'ghost'}`} onClick={() => send({ t: 'post.like', id })}><Icon n="heart" size={16} fill={liked ? 'currentColor' : undefined} /> 좋아요 {p.likes.length}</button>
        <h3>댓글 {p.comments.length}</h3>
        {p.comments.filter((c) => !hidden(c.uid)).map((c) => (
          <div key={c.id} className="comment"><b>{U(c.uid).nick}</b><span className="meta"> {ago(c.at)}</span>
            {c.uid === me.id && <button className="link" onClick={() => send({ t: 'comment.del', id, cid: c.id })}>삭제</button>}
            <p>{c.text}</p></div>
        ))}
      </div>
      <Composer placeholder="댓글 입력" onSend={(text) => send({ t: 'post.comment', id, text })} />
    </div>
  );
}

/* ---------- MY ---------- */
function MyTab() {
  const { me, s, send, setSheet, theme, setTheme, openAdmin } = useApp();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const done = me.attend.last === today;
  const myTalks = s.talks.filter((t) => t.uid === me.id).length; const c = s.config;
  const Item = ({ label, value, onClick }) => <button className="row flat item" onClick={onClick}><span className="grow">{label}</span><span className="meta">{value}</span><Icon n="chev" size={16} /></button>;
  return (
    <div className="list my">
      <div className="card me-card">
        <Avatar u={{ ...me, online: false }} size={56} />
        <div className="grow"><b className="big">{me.nick}</b><div><Meta u={me} /></div><div className="meta">{me.intro || '한줄소개를 등록해 보세요'}</div></div>
        <button className="btn sm ghost" onClick={() => setSheet({ type: 'editProfile' })}>수정</button>
      </div>
      <div className="card attend">
        <div><span className="meta">보유 포인트</span><b className="points">{me.points.toLocaleString()}P</b>
          <span className="meta">{me.attend.streak > 0 ? `${me.attend.streak}일 연속 출석 중` : '오늘부터 출석을 시작해 보세요'}</span></div>
        <div className="pt-btns"><button className="btn" onClick={() => setSheet({ type: 'shop' })}>포인트 충전</button>
          <button className="btn ghost" disabled={done} onClick={() => send({ t: 'attend' })}>{done ? '오늘 출석 완료' : `출석체크 +${c.attend}P`}</button></div>
      </div>
      <button className={`card vip-card ${me.vipInfo?.on ? 'on' : ''}`} onClick={() => setSheet({ type: 'vip' })}>
        <span className="vip-ic"><Icon n="crown" size={24} /></span>
        <span className="grow"><b>{me.vipInfo?.on ? 'VIP 이용 중' : 'VIP 멤버십'}</b><span className="meta">{me.vipInfo?.on ? `${new Date(me.vipInfo.until).toLocaleDateString('ko-KR')}까지 · 매달 ${c.vipPoints}P · 대화 신청 ${c.vipRequestPct}% 할인` : `월 ${c.vipPrice.toLocaleString()}원 · 매달 ${c.vipPoints}P · 대화 신청 ${c.vipRequestPct}% 할인 · 방문자 무료`}</span></span>
        <Icon n="chev" size={16} />
      </button>
      <div className="card my-quick">
        <button onClick={() => setSheet({ type: 'visitors' })}><Icon n="eye" size={20} /><b>{me.visit?.today || 0}명</b><span className="meta">오늘 나를 본 사람</span></button>
        <button onClick={() => setSheet({ type: 'picks' })}><Icon n="star" size={20} /><b>{me.picks?.length || 0}명</b><span className="meta">오늘의 추천 친구</span></button>
      </div>
      <button className="card invite-card" onClick={() => setSheet({ type: 'invite' })}>
        <span className="invite-ic"><Icon n="gift" size={26} /></span>
        <span className="grow"><b>친구 초대하고 포인트 받기</b><span className="meta">친구는 가입 즉시 {c.inviteJoin}P, 나는 친구가 첫 출석하면 {c.inviteReward}P{c.inviteMilestone > 0 && c.inviteMilestoneBonus > 0 ? ` · ${c.inviteMilestone}명마다 +${c.inviteMilestoneBonus}P` : ''}</span></span>
        <Icon n="chev" size={16} />
      </button>
      <p className="hint pad">매일 출석 {c.attend}P · 3일 연속 +{c.bonus3}P · 7일 연속 +{c.bonus7}P. 대화 신청 {c.requestCost}P, 토크 상단 고정 {c.pinCost}P.</p>
      <div className="card">
        <Item label="포인트 내역" value="" onClick={() => setSheet({ type: 'ledger' })} />
        <Item label="쿠폰 등록" value="" onClick={() => setSheet({ type: 'coupon' })} />
        <Item label="공지·이벤트" value={s.notices?.length ? `${s.notices.length}건` : ''} onClick={() => setSheet({ type: 'notices' })} />
        <Item label="친구 초대" value={me.invite?.count ? `${me.invite.count}명 초대` : `내 코드 ${me.code || ''}`} onClick={() => setSheet({ type: 'invite' })} />
        <Item label="알림 설정" value={me.pushOn && me.notify?.push ? '휴대폰 알림 켜짐' : '휴대폰 알림 꺼짐'} onClick={() => setSheet({ type: 'notify' })} />
        <Item label="친구 목록" value={`${me.friends.length}명`} onClick={() => setSheet({ type: 'people', kind: 'friends' })} />
        <Item label="차단 목록" value={`${me.blocks.length}명`} onClick={() => setSheet({ type: 'people', kind: 'blocks' })} />
        <Item label="내가 쓴 토크" value={`${myTalks}개`} onClick={() => setSheet({ type: 'myTalks' })} />
        <Item label="화면 모드" value={theme === 'dark' ? '다크' : '라이트'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      </div>
      <div className="card">
        <Item label="이용 원칙" value="" onClick={() => setSheet({ type: 'rules' })} />
        {!DEMO && <a className="row flat item" href="/privacy" target="_blank" rel="noreferrer"><span className="grow">개인정보처리방침</span><Icon n="chev" size={16} /></a>}
        {DEMO && <Item label="관리자 화면 체험" value="비밀번호 admin" onClick={openAdmin} />}
        <Item label={DEMO ? '체험판 초기화' : '회원 탈퇴'} value="" onClick={() => setSheet({ type: 'quit' })} />
      </div>
      {DEMO && <p className="hint pad">체험판입니다. 대화 상대는 자동 응답하는 가상 회원이고, 내용은 이 브라우저에만 저장됩니다.</p>}
    </div>
  );
}
function People({ kind, close }) {
  const { me, U, send, setSheet } = useApp(); const ids = kind === 'friends' ? me.friends : me.blocks;
  return (
    <Sheet title={kind === 'friends' ? '친구 목록' : '차단 목록'} onClose={close}>
      {ids.length === 0 && <Empty>{kind === 'friends' ? '등록한 친구가 없습니다.' : '차단한 사용자가 없습니다.'}</Empty>}
      {ids.map((uid) => { const u = U(uid); return (
        <div key={uid} className="row flat"><button className="who" onClick={() => kind === 'friends' && setSheet({ type: 'profile', uid })}><Avatar u={u} size={36} /></button>
          <span className="grow"><b>{u.nick}</b> <Meta u={u} /></span>
          <button className="btn sm ghost" onClick={() => send({ t: kind === 'friends' ? 'friend.toggle' : 'block.toggle', uid })}>{kind === 'friends' ? '해제' : '차단 해제'}</button></div>
      ); })}
    </Sheet>
  );
}

/* ---------- 친구 초대 · 쿠폰 ---------- */
const INVITE_STATUS = { pending: ['첫 출석 대기', ''], paid: ['보상 지급', 'soft'], blocked: ['지급 제외', ''], capped: ['이번 달 한도 초과', ''] };
function InviteSheet({ close }) {
  const { me, s, send, setToast } = useApp(); const c = s.config; const inv = me.invite || {};
  const [code, setCode] = useState(store.get('eum_ref') || '');
  const link = `${APP_URL}/?ref=${me.code}`;
  const text = `이음챗에서 동네 친구 만들어요! 가입할 때 초대 코드 ${me.code} 를 넣으면 ${c.inviteJoin}P를 바로 받아요.\n${link}`;
  const copy = async (v, msg) => { try { await navigator.clipboard.writeText(v); setToast(msg); } catch { setToast('복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.'); } };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: '이음챗 초대', text }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    copy(text, '초대 메시지를 복사했습니다. 카톡이나 문자에 붙여 넣어 보내세요.');
  };
  return (
    <Sheet title="친구 초대" onClose={close}>
      <div className="invite-hero">
        <span className="meta">내 초대 코드</span>
        <button className="invite-code" onClick={() => copy(me.code, '초대 코드를 복사했습니다.')}>{me.code}</button>
        <div className="btn-row"><button className="btn" onClick={share}>초대 메시지 보내기</button><button className="btn ghost" onClick={() => copy(link, '초대 링크를 복사했습니다.')}>링크 복사</button></div>
      </div>
      <div className="invite-rules">
        <div><b>+{c.inviteJoin}P</b><span>친구가 내 코드로 가입하면 친구에게 바로</span></div>
        <div><b>+{c.inviteReward}P</b><span>친구가 첫 출석체크를 하면 나에게</span></div>
        {c.inviteMilestone > 0 && c.inviteMilestoneBonus > 0 && <div><b>+{c.inviteMilestoneBonus}P</b><span>보상 받은 친구 {c.inviteMilestone}명마다 추가로</span></div>}
      </div>
      <div className="have"><span className="meta">초대한 친구 {inv.count || 0}명 · 보상 {inv.paid || 0}명</span><b>{(inv.earned || 0).toLocaleString()}P</b></div>
      {inv.list?.length > 0 && <><h4 className="sub">초대한 친구</h4>{inv.list.map((x) => (
        <div key={x.id} className="row flat"><span className="grow"><b>{x.nick}</b><br /><span className="meta">{new Date(x.at).toLocaleDateString('ko-KR')}</span></span><em className={`tag ${INVITE_STATUS[x.status]?.[1] || ''}`}>{INVITE_STATUS[x.status]?.[0] || x.status}</em></div>
      ))}</>}
      {inv.by && <p className="hint">나를 초대한 친구: <b>{inv.by}</b></p>}
      {inv.canEnter && (
        <div className="form"><h4 className="sub">친구에게 받은 초대 코드가 있나요?</h4>
          <input value={code} maxLength={10} placeholder="초대 코드 입력" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="btn ghost" disabled={code.trim().length < 4} onClick={() => { store.del('eum_ref'); send({ t: 'invite.use', code }); }}>코드 등록하고 {c.inviteJoin}P 받기</button>
          <span className="hint">가입 후 7일 안에 한 번만 등록할 수 있습니다.</span></div>
      )}
      <ul className="rules small"><li>{c.inviteMonthMax > 0 ? `초대 보상은 한 달에 ${c.inviteMonthMax}명까지 받을 수 있습니다.` : '초대 보상 인원 제한은 없습니다.'}</li><li>같은 기기·같은 네트워크에서 여러 계정을 만들어 초대하면 보상이 지급되지 않습니다.</li><li>부정한 방법으로 받은 포인트는 회수되고 이용이 제한될 수 있습니다.</li></ul>
    </Sheet>
  );
}
function GiftSheet({ uid, close }) {
  const { me, s, send, U } = useApp(); const c = s.config; const [amt, setAmt] = useState(100);
  const presets = [10, 50, 100, 300, 500, 1000].filter((x) => x >= c.giftMin && x <= c.giftMax);
  const n = Math.floor(Number(amt) || 0);
  return (
    <Sheet title={`${U(uid).nick} 님에게 선물`} onClose={close}>
      <div className="have"><span className="meta">보유 포인트</span><b>{me.points.toLocaleString()}P</b></div>
      <div className="chips wrap">{presets.map((x) => <button key={x} className={`chip ${n === x ? 'on' : ''}`} onClick={() => setAmt(x)}>{x.toLocaleString()}P</button>)}</div>
      <div className="form">
        <input type="number" min={c.giftMin} max={c.giftMax} value={amt} onChange={(e) => setAmt(e.target.value)} />
        <button className="btn" disabled={n < c.giftMin || n > c.giftMax || n > me.points} onClick={() => { send({ t: 'gift', to: uid, amount: n }); close(); }}>{n.toLocaleString()}P 선물하기</button>
        {n > me.points && <span className="hint err">포인트가 부족합니다.</span>}
        <span className="hint">대화 중인 상대에게만 보낼 수 있고, 보낸 선물은 취소할 수 없습니다. 하루 {c.giftDayMax.toLocaleString()}P까지 보낼 수 있습니다.</span>
      </div>
    </Sheet>
  );
}
function VisitorsSheet({ close }) {
  const { me, s, send, setSheet, U } = useApp(); const v = me.visit || {}; const c = s.config;
  return (
    <Sheet title="나를 본 사람" onClose={close}>
      <div className="have"><span className="meta">오늘 {v.today || 0}명 · 최근 7일 {v.week || 0}명</span><Icon n="eye" size={22} /></div>
      {v.open ? (
        <>
          {v.list.length === 0 && <Empty>아직 내 프로필을 본 사람이 없습니다.<br />토크를 쓰거나 부스트를 써 보세요.</Empty>}
          {v.list.map((x) => { const u = U(x.uid); return <PersonRow key={x.uid} u={{ ...u, lastSeen: x.at, online: false }} onClick={() => setSheet({ type: 'profile', uid: x.uid })} />; })}
          {!me.vipInfo?.on && <p className="hint">{new Date(v.openUntil).toLocaleString('ko-KR')}까지 볼 수 있습니다.</p>}
        </>
      ) : (
        <>
          <div className="locked">{Array.from({ length: Math.min(4, Math.max(1, v.week || 0)) }, (_, i) => <div key={i} className="row flat blur"><span className="av M" style={{ width: 42, height: 42 }}>?</span><span className="grow"><b>숨겨진 방문자</b><br /><span className="meta">○○ · ○○대 · ○○</span></span></div>)}</div>
          <button className="btn" disabled={!v.week} onClick={() => send({ t: 'visit.open' })}>{c.visitorCost}P로 {c.visitorHours}시간 동안 보기</button>
          <button className="btn ghost" onClick={() => setSheet({ type: 'vip' })}>VIP는 언제나 무료로 볼 수 있어요</button>
        </>
      )}
      <p className="hint">내 프로필을 연 회원이 최근 순으로 보입니다. 차단한 회원은 보이지 않습니다.</p>
    </Sheet>
  );
}
function PicksSheet({ close }) {
  const { me, U, setSheet, s } = useApp();
  return (
    <Sheet title="오늘의 추천 친구" onClose={close}>
      <p className="hint">매일 같은 지역·비슷한 나이대에서 아직 대화하지 않은 분을 골라 드려요. 저녁 {s.config.pickHour}시에 알림으로도 알려 드립니다.</p>
      {(me.picks || []).length === 0 && <Empty>오늘은 추천할 분이 없습니다.<br />내일 다시 확인해 주세요.</Empty>}
      {(me.picks || []).map((id) => <PersonRow key={id} u={U(id)} onClick={() => setSheet({ type: 'profile', uid: id })} />)}
    </Sheet>
  );
}
function VipSheet({ close }) {
  const { me, s, verifyVip, setToast } = useApp(); const c = s.config; const v = me.vipInfo || {};
  const [svc, setSvc] = useState(undefined); const [price, setPrice] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let on = true; (async () => {
    const service = await playService(); if (!on) return; setSvc(service); if (!service) return;
    const pr = await playPrices(service, [c.vipSku]); if (on) setPrice(pr[c.vipSku] || '');
    if (!v.on) for (const x of await pending(service)) if (x.sku === c.vipSku) await verifyVip(x.token); // 결제했는데 반영 안 된 구독 복구
  })(); return () => { on = false; }; }, []);
  const subscribe = async () => {
    setBusy(true);
    if (DEMO) await verifyVip(`demo-sub-${Date.now()}`);
    else { const r = await buy(c.vipSku); if (r) { const ok = await verifyVip(r.token); r.finish(ok); } else setToast('구독이 취소되었습니다.'); }
    setBusy(false);
  };
  return (
    <Sheet title="VIP 멤버십" onClose={close}>
      <div className={`vip-hero ${v.on ? 'on' : ''}`}><Icon n="crown" size={34} /><b>{v.on ? 'VIP 이용 중' : '이음챗 VIP'}</b><span>{v.on ? `${new Date(v.until).toLocaleDateString('ko-KR')}까지 · 자동 갱신` : `월 ${price || `${c.vipPrice.toLocaleString()}원`}`}</span></div>
      <div className="invite-rules">
        <div><b>{c.vipPoints}P</b><span>매달 결제될 때마다 포인트 지급</span></div>
        <div><b>{c.vipRequestPct}%</b><span>대화 신청 비용 할인</span></div>
        <div><b>무료</b><span>나를 본 사람(방문자) 언제나 보기</span></div>
        {c.vipFreeBoost > 0 && <div><b>매일 {c.vipFreeBoost}회</b><span>프로필 부스트 무료</span></div>}
        <div><b>VIP</b><span>프로필과 대화에 VIP 배지 표시</span></div>
      </div>
      {v.on ? <a className="btn ghost" href={SUB_URL(c.vipSku)} target="_blank" rel="noreferrer">Google Play에서 구독 관리·해지</a> : (
        <>
          {svc === null && !DEMO && <div className="warn">구독은 Google Play에서 설치한 이음챗 앱에서만 할 수 있습니다.</div>}
          <button className="btn" disabled={busy || (!DEMO && !svc)} onClick={subscribe}>{busy ? '확인 중…' : DEMO ? '테스트로 구독하기 (체험판)' : '구독 시작하기'}</button>
        </>
      )}
      <p className="hint">매달 자동으로 결제되며, Google Play에서 언제든 해지할 수 있습니다. 해지해도 이미 결제한 기간이 끝날 때까지 VIP가 유지됩니다. 결제·환불은 Google Play 정책을 따릅니다.</p>
    </Sheet>
  );
}
function NoticesSheet({ close, focus }) {
  const { s } = useApp(); const list = s.notices || [];
  return (
    <Sheet title="공지·이벤트" onClose={close}>
      {list.length === 0 && <Empty>공지가 없습니다.</Empty>}
      {list.map((n) => <div key={n.id} className={`card notice-item ${focus === n.id ? 'focus' : ''}`}><b>{n.title}</b><span className="meta">{new Date(n.at).toLocaleString('ko-KR')}</span><p>{n.body}</p></div>)}
    </Sheet>
  );
}
function CouponSheet({ close }) {
  const { send } = useApp(); const [code, setCode] = useState('');
  return (
    <Sheet title="쿠폰 등록" onClose={close}>
      <div className="form">
        <input value={code} maxLength={20} placeholder="쿠폰 코드 입력" onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
        <button className="btn" disabled={code.trim().length < 4} onClick={() => { send({ t: 'coupon.use', code }); setCode(''); }}>등록하고 포인트 받기</button>
        <span className="hint">이벤트·공식 채널에서 받은 쿠폰 코드를 입력하세요. 쿠폰은 계정당 한 번만 쓸 수 있습니다.</span>
      </div>
    </Sheet>
  );
}

/* ---------- 포인트 충전 · 내역 ---------- */
function Shop({ close }) {
  const { s, me, verify, setToast } = useApp();
  const [svc, setSvc] = useState(undefined); // undefined 확인 중, null 결제 불가
  const [prices, setPrices] = useState({}); const [busy, setBusy] = useState(''); const [test, setTest] = useState(null);
  const products = s.config.products;
  useEffect(() => { let on = true; (async () => {
    const service = await playService(); if (!on) return; setSvc(service);
    if (!service) return;
    setPrices(await playPrices(service, products.map((p) => p.sku)));
    for (const x of await pending(service)) { // 결제만 되고 충전이 안 된 건 복구
      const p = products.find((y) => y.sku === x.sku);
      if (p && await verify(p.id, x.token)) consume(service, x.token);
    }
  })(); return () => { on = false; }; }, []);
  const pay = async (p) => {
    if (DEMO) return setTest(p);
    setBusy(p.id);
    const r = await buy(p.sku);
    if (r) { const ok = await verify(p.id, r.token); r.finish(ok); if (ok) consume(svc, r.token); } else setToast('결제가 취소되었습니다.');
    setBusy('');
  };
  const payTest = async () => { const p = test; setTest(null); setBusy(p.id); await verify(p.id, `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`); setBusy(''); };
  const can = DEMO || !!svc;
  return (
    <Sheet title="포인트 충전" onClose={close}>
      <div className="have"><span className="meta">보유 포인트</span><b>{me.points.toLocaleString()}P</b></div>
      {svc === null && !DEMO && <div className="warn">포인트 결제는 Google Play에서 설치한 이음챗 앱에서만 할 수 있습니다.</div>}
      {DEMO && <div className="warn">체험판은 실제 결제 없이 테스트 결제로 충전됩니다.</div>}
      {me.firstBuy && s.config.firstBuyPct > 0 && <div className="first-buy"><Icon n="gift" size={18} /><span><b>첫 충전 보너스 +{s.config.firstBuyPct}%</b> · 처음 충전하면 포인트를 더 드려요</span></div>}
      {products.map((p) => (
        <button key={p.id} className="prod" disabled={!can || !!busy} onClick={() => pay(p)}>
          <span className="grow"><b>{(p.points + p.bonus).toLocaleString()}P</b>{p.bonus > 0 && <em className="tag">+{p.bonus.toLocaleString()}P 보너스</em>}{me.firstBuy && s.config.firstBuyPct > 0 && <em className="tag soft">첫 충전 +{Math.floor((p.points * s.config.firstBuyPct) / 100).toLocaleString()}P</em>}<span className="meta">{p.name}</span></span>
          <span className="price">{busy === p.id ? '확인 중…' : prices[p.sku] || `${p.price.toLocaleString()}원`}</span>
        </button>
      ))}
      <p className="hint">Google Play로 결제하면 확인 즉시 자동으로 충전됩니다. 환불은 Google Play 환불 정책을 따르며, 환불 시 충전된 포인트는 회수됩니다.</p>
      {me.orders.length > 0 && <><h4 className="sub">최근 충전</h4>{me.orders.map((o) => <div key={o.id} className="row flat"><span className="grow">{o.name} · {(o.points + o.bonus).toLocaleString()}P<br /><span className="meta">{new Date(o.at).toLocaleString('ko-KR')}</span></span><em className={`tag ${o.status === 'paid' ? 'soft' : ''}`}>{o.status === 'paid' ? '충전 완료' : '환불'}</em></div>)}</>}
      {test && (
        <div className="scrim" onClick={() => setTest(null)}><div className="sheet play" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-body"><span className="meta">Google Play 테스트 결제 (체험판)</span><b className="big">{test.name} · {(test.points + test.bonus).toLocaleString()}P</b><b>{test.price.toLocaleString()}원</b>
            <p className="hint">실제 결제가 아닙니다. 요금이 청구되지 않습니다.</p><button className="btn" onClick={payTest}>구매</button><button className="btn ghost" onClick={() => setTest(null)}>취소</button></div>
        </div></div>
      )}
    </Sheet>
  );
}
function Ledger({ close }) {
  const { me } = useApp();
  return (
    <Sheet title="포인트 내역" onClose={close}>
      <div className="have"><span className="meta">보유 포인트</span><b>{me.points.toLocaleString()}P</b></div>
      {me.ledger.length === 0 && <Empty>포인트 내역이 없습니다.</Empty>}
      {me.ledger.map((l) => <div key={l.id} className="row flat"><span className="grow">{l.reason}<br /><span className="meta">{new Date(l.at).toLocaleString('ko-KR')} · 잔액 {l.balance.toLocaleString()}P</span></span><b className={l.delta > 0 ? 'plus' : 'minus'}>{l.delta > 0 ? '+' : ''}{l.delta.toLocaleString()}P</b></div>)}
    </Sheet>
  );
}

/* ---------- 알림 설정 ---------- */
function Switch({ on, onChange, label, desc, disabled }) {
  return (
    <button className="sw-row" onClick={() => !disabled && onChange(!on)} disabled={disabled} role="switch" aria-checked={on}>
      <span className="grow"><b>{label}</b>{desc && <span className="meta">{desc}</span>}</span>
      <span className={`sw ${on ? 'on' : ''}`}><i /></span>
    </button>
  );
}
function NotifySheet({ close }) {
  const { me, s, send, setToast } = useApp();
  const n = me.notify || {};
  const [busy, setBusy] = useState(false);
  const phoneOn = !!(me.pushOn && n.push);
  const set = (k) => (v) => send({ t: 'notify.set', [k]: v });
  const togglePhone = async (v) => {
    setBusy(true);
    try {
      if (v) send({ t: 'push.sub', sub: await enablePush(s.pushKey) });
      else send({ t: 'push.unsub', endpoint: await disablePush() });
    } catch (e) { setToast(e.message); }
    setBusy(false);
  };
  const perm = permission();
  return (
    <Sheet title="알림 설정" onClose={close}>
      <div className="card sw-card">
        <Switch on={phoneOn} onChange={togglePhone} disabled={busy || !pushSupported()} label="휴대폰 알림" desc="앱을 닫아 두어도 새 메시지를 휴대폰 알림으로 받습니다." />
      </div>
      {!pushSupported() && <p className="warn">{DEMO ? '체험판에서는 휴대폰 알림을 쓸 수 없습니다. 앱 안의 팝업 알림은 동작합니다.' : 'Play 스토어에서 설치한 이음챗 앱이나 크롬에서 휴대폰 알림을 켤 수 있습니다.'}</p>}
      {pushSupported() && perm === 'denied' && <p className="warn">휴대폰 설정에서 이음챗 알림이 막혀 있습니다. 설정 &gt; 애플리케이션 &gt; 이음챗 &gt; 알림에서 허용해 주세요.</p>}
      <h4 className="sub">받을 알림</h4>
      <div className="card sw-card">
        <Switch on={n.request} onChange={set('request')} label="대화 신청" desc="누군가 나에게 대화를 신청했을 때" />
        <Switch on={n.msg} onChange={set('msg')} label="1:1 메시지" desc="쪽지 대화의 새 메시지, 대화 수락" />
        <Switch on={n.room} onChange={set('room')} label="그룹채팅" desc="참여 중인 방의 새 메시지 (방마다 따로 끌 수 있어요)" />
        <Switch on={n.comment} onChange={set('comment')} label="내 글 댓글" desc="라운지에 쓴 내 글에 댓글이 달렸을 때" />
        <Switch on={n.pick} onChange={set('pick')} label="오늘의 추천 친구" desc={`매일 저녁 ${s.config.pickHour}시 추천 친구 소식`} />
      </div>
      <h4 className="sub">이벤트·혜택</h4>
      <div className="card sw-card">
        <Switch on={n.event} onChange={set('event')} label="이벤트·쿠폰·혜택 알림 (광고성 정보 수신 동의)" desc={me.adConsent ? `${new Date(me.adConsent.at).toLocaleDateString('ko-KR')} ${me.adConsent.on ? '수신 동의' : '수신 거부'}` : '켜면 포인트 이벤트와 쿠폰 소식을 알려 드려요. 밤 9시 ~ 아침 8시에는 보내지 않습니다.'} />
      </div>
      <h4 className="sub">표시 방법</h4>
      <div className="card sw-card">
        <Switch on={n.preview} onChange={set('preview')} label="메시지 내용 미리보기" desc="끄면 휴대폰 알림에 내용 대신 '새 알림이 도착했습니다'만 보여요." />
        <Switch on={n.quiet} onChange={set('quiet')} label="방해 금지 (밤 10시 ~ 오전 8시)" desc="이 시간에는 휴대폰 알림을 보내지 않아요." />
      </div>
      <p className="hint">앱을 보고 있을 때는 휴대폰 알림 대신 화면 위에 팝업으로 알려 드립니다. 위에서 끈 종류는 팝업도 뜨지 않습니다.</p>
    </Sheet>
  );
}

/* ---------- 앱 ---------- */
const TABS = [['talk', '토크', 'talk'], ['mail', '쪽지', 'mail'], ['group', '그룹채팅', 'group'], ['lounge', '라운지', 'board'], ['my', 'MY', 'my']];

export default function App() {
  const [s, dispatch] = useReducer(reducer, init);
  const [online, setOnline] = useState(false);
  const [tab, setTab] = useState('talk');
  const [view, setView] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState('');
  const [theme, setThemeState] = useState(store.get('eum_theme') || 'light');
  const api = useRef(null);
  const iapWait = useRef({});
  const isAdminUrl = () => location.pathname === '/admin' || location.hash === '#admin';
  const [adminMode, setAdminMode] = useState(isAdminUrl);
  const [adm, setAdm] = useState({ state: 'out', data: null });
  const [banner, setBanner] = useState(null);
  const viewRef = useRef(null);
  useEffect(() => { viewRef.current = view; }, [view]);
  const openView = (v) => {
    if (!v?.type || !v.id) return;
    setBanner(null);
    if (v.type === 'picks') { setView(null); setSheet({ type: 'picks' }); } else if (v.type === 'notice') { setView(null); setSheet({ type: 'notices', focus: v.id }); } else { setSheet(null); setView(v); }
  };

  useEffect(() => {
    api.current = connect((m) => {
      if (m.t === 'admin.ok') setAdm((a) => ({ ...a, state: 'in' }));
      else if (m.t === 'admin.fail') setAdm({ state: 'fail', off: m.off, data: null });
      else if (m.t === 'admin.data') setAdm((a) => ({ ...a, data: m.data }));
      else if (m.t === 'admin.lookup') setAdm((a) => ({ ...a, lookup: m }));
      else if (m.t === 'admin.export') setAdm((a) => ({ ...a, exportRes: { ...m, uid: m.name.split('_')[1] } }));
      else if (m.t === 'iap.done' || m.t === 'iap.fail') { iapWait.current[m.token]?.(m.t === 'iap.done'); delete iapWait.current[m.token]; }
      else if (m.t === 'toast') setToast(m.msg);
      else if (m.t === 'goto') setView(m.view);
      else if (m.t === 'notify') {
        const cur = viewRef.current;
        if (!(cur && m.view && cur.type === m.view.type && cur.id === m.view.id) || document.visibilityState === 'hidden') setBanner({ ...m, key: Date.now() });
      }
      else if (m.t === 'bye') { api.current.reset(); location.reload(); } else dispatch(m);
    }, (v) => {
      setOnline(v); if (!v) setAdm({ state: 'out', data: null });
      else api.current?.send({ t: 'vis', v: document.visibilityState });
    });
    // 앱이 화면에 보이는지 서버에 알린다: 보이면 화면 팝업, 안 보이면 휴대폰 알림
    const onVis = () => api.current?.send({ t: 'vis', v: document.visibilityState });
    document.addEventListener('visibilitychange', onVis);
    registerSW(openView);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => { if (!banner) return undefined; const t = setTimeout(() => setBanner(null), 4500); return () => clearTimeout(t); }, [banner]);
  // 알림을 눌러 앱이 열린 경우(?open=chat:ID) 해당 화면으로 이동
  useEffect(() => {
    if (!s.ready || !s.me) return;
    const o = new URLSearchParams(location.search).get('open');
    if (o) { const [type, id] = o.split(':'); openView({ type, id }); history.replaceState(null, '', location.pathname); }
    if (s.me.notify?.push) currentSub().then((sub) => { if (sub) api.current?.send({ t: 'push.sub', sub }); }).catch(() => {});
  }, [s.ready, !!s.me]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30e3); return () => clearInterval(t); }, []);

  const send = (m) => api.current.send(m);
  const me = s.me;
  // 결제 토큰을 서버에 보내고 충전 결과(true/false)를 기다린다.
  const verify = (productId, token) => new Promise((ok) => {
    iapWait.current[token] = ok; send({ t: 'iap.verify', productId, token });
    setTimeout(() => { if (iapWait.current[token]) { delete iapWait.current[token]; ok(false); } }, 30e3);
  });
  const verifyVip = (token) => new Promise((ok) => {
    iapWait.current[token] = ok; send({ t: 'vip.verify', token });
    setTimeout(() => { if (iapWait.current[token]) { delete iapWait.current[token]; ok(false); } }, 30e3);
  });
  const exitAdmin = () => { if (location.pathname === '/admin') location.href = '/'; else { if (location.hash === '#admin') location.hash = ''; setAdminMode(false); } };
  const ctx = useMemo(() => ({
    s, me, send, setView, setSheet, theme, api, verify, verifyVip, setToast, openAdmin: () => setAdminMode(true),
    setTheme: (t) => { store.set('eum_theme', t); setThemeState(t); },
    U: (id) => s.users[id] || NOBODY,
    hidden: (id) => !!me && me.blocks.includes(id),
  }), [s, theme]);

  if (adminMode) return <><Admin adm={adm} send={send} onExit={exitAdmin} demo={DEMO} />{toast && <div className="toast fixed">{toast}</div>}</>;
  if (!s.ready) return <div className="app center"><div className="logo">이음챗</div><p className="meta">{online ? '불러오는 중…' : '서버에 연결하는 중…'}</p></div>;
  if (s.need || !me) {
    return (
      <div className="app onboard">
        <div className="logo">이음챗</div>
        <p className="lead">동네 사람들과 가볍게 이야기 나누는 곳.<br />프로필을 만들고 시작해 보세요.</p>
        <ProfileForm first onSubmit={(profile, ref, adConsent) => { store.del('eum_ref'); send({ t: 'hello', profile, ref, adConsent }); }} />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const badge = s.convs.reduce((n, c) => (ctx.hidden(c.a === me.id ? c.b : c.a) ? n : n + unreadOf(c, me.id) + (c.status === 'pending' && c.b === me.id ? 1 : 0)), 0);
  const close = () => setSheet(null);
  const title = TABS.find((t) => t[0] === tab)[1];

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        {!online && <div className="offline">연결이 끊겼습니다. 다시 연결하는 중…</div>}
        {me.banned && <div className="offline">이용이 정지된 계정입니다.</div>}
        {view?.type === 'chat' ? <ChatView id={view.id} /> : view?.type === 'room' ? <RoomView id={view.id} /> : view?.type === 'post' ? <PostView id={view.id} /> : (
          <>
            <header className="bar top"><span className="logo sm">이음챗</span><b className="tab-title">{title}</b><button className="pts" onClick={() => setSheet({ type: 'shop' })} aria-label="포인트 충전">{me.points.toLocaleString()}P +</button></header>
            <main className="main">
              {tab === 'talk' && <TalkTab />}{tab === 'mail' && <MailTab />}{tab === 'group' && <GroupTab />}{tab === 'lounge' && <LoungeTab />}{tab === 'my' && <MyTab />}
            </main>
            <nav className="tabs">
              {TABS.map(([k, label, icon]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  <span className="ti"><Icon n={icon} />{k === 'mail' && badge > 0 && <i className="badge">{badge}</i>}</span>{label}
                </button>
              ))}
            </nav>
          </>
        )}

        {sheet?.type === 'profile' && <ProfileSheet uid={sheet.uid} talk={sheet.talk} close={close} />}
        {sheet?.type === 'shop' && <Shop close={close} />}
        {sheet?.type === 'notify' && <NotifySheet close={close} />}
        {sheet?.type === 'ledger' && <Ledger close={close} />}
        {sheet?.type === 'invite' && <InviteSheet close={close} />}
        {sheet?.type === 'coupon' && <CouponSheet close={close} />}
        {sheet?.type === 'gift' && <GiftSheet uid={sheet.uid} close={close} />}
        {sheet?.type === 'visitors' && <VisitorsSheet close={close} />}
        {sheet?.type === 'picks' && <PicksSheet close={close} />}
        {sheet?.type === 'vip' && <VipSheet close={close} />}
        {sheet?.type === 'notices' && <NoticesSheet close={close} focus={sheet.focus} />}
        {sheet?.type === 'writeTalk' && <WriteTalk close={close} />}
        {sheet?.type === 'report' && <ReportSheet uid={sheet.uid} refText={sheet.ref} close={close} />}
        {sheet?.type === 'newRoom' && <NewRoom close={close} />}
        {sheet?.type === 'joinPw' && <JoinPw room={sheet.room} close={close} />}
        {sheet?.type === 'members' && <Members id={sheet.id} close={close} />}
        {sheet?.type === 'writePost' && <WritePost close={close} />}
        {sheet?.type === 'people' && <People kind={sheet.kind} close={close} />}
        {sheet?.type === 'editProfile' && <Sheet title="프로필 수정" onClose={close}><ProfileForm initial={me} onSubmit={(profile) => { send({ t: 'profile', profile }); close(); }} /></Sheet>}
        {sheet?.type === 'myTalks' && (
          <Sheet title="내가 쓴 토크" onClose={close}>
            {s.talks.filter((t) => t.uid === me.id).length === 0 && <Empty>작성한 토크가 없습니다.</Empty>}
            {s.talks.filter((t) => t.uid === me.id).map((t) => <div key={t.id} className="row flat"><span className="grow">{t.text}<br /><span className="meta">{ago(t.at)}</span></span><button className="btn sm ghost danger" onClick={() => send({ t: 'talk.del', id: t.id })}>삭제</button></div>)}
          </Sheet>
        )}
        {sheet?.type === 'chatMenu' && (
          <Sheet title="대화 메뉴" onClose={close}>
            <div className="form">
              {s.convs.find((x) => x.id === sheet.id)?.status === 'open' && <button className="btn ghost" onClick={() => setSheet({ type: 'gift', uid: sheet.uid })}>포인트 선물하기</button>}
              <button className="btn ghost" onClick={() => { send({ t: 'friend.toggle', uid: sheet.uid }); close(); }}>{me.friends.includes(sheet.uid) ? '친구 해제' : '친구 추가'}</button>
              <button className="btn ghost" onClick={() => { send({ t: 'block.toggle', uid: sheet.uid }); close(); }}>{me.blocks.includes(sheet.uid) ? '차단 해제' : '차단하기'}</button>
              <button className="btn ghost danger" onClick={() => setSheet({ type: 'report', uid: sheet.uid, ref: `대화:${sheet.id}` })}>신고하기</button>
              <button className="btn ghost danger" onClick={() => { send({ t: 'conv.leave', id: sheet.id }); setView(null); close(); }}>대화방 나가기</button>
            </div>
          </Sheet>
        )}
        {sheet?.type === 'msgMenu' && (
          <Sheet title="메시지" onClose={close}>
            <p className="quote">{sheet.m.text}</p>
            <div className="form">
              {sheet.m.uid === me.id
                ? <><div className="hint">지우면 상대 화면에는 삭제된 메시지로 남습니다.</div><button className="btn danger" onClick={() => { send({ t: 'msg.del', id: sheet.id, mid: sheet.m.id }); close(); }}>메시지 삭제</button></>
                : <button className="btn ghost danger" onClick={() => setSheet({ type: 'report', uid: sheet.m.uid, ref: `메시지:${sheet.m.id}` })}>이 메시지 신고</button>}
            </div>
          </Sheet>
        )}
        {sheet?.type === 'rules' && (
          <Sheet title="이용 원칙" onClose={close}>
            <ul className="rules"><li>만 19세 이상만 이용할 수 있습니다.</li><li>욕설, 음란물, 불법 촬영물, 성매매·금전 요구는 금지됩니다.</li><li>전화번호·메신저 아이디 같은 개인정보를 요구하거나 공개하지 마세요.</li><li>투자·송금을 권하는 상대는 사기일 수 있습니다. 바로 신고해 주세요.</li><li>신고하면 해당 사용자는 자동으로 차단됩니다.</li></ul>
          </Sheet>
        )}
        {sheet?.type === 'quit' && (
          <Sheet title={DEMO ? '체험판 초기화' : '회원 탈퇴'} onClose={close}>
            <div className="form"><div className="hint">{DEMO ? '이 브라우저에 저장된 프로필과 대화가 모두 지워집니다.' : '프로필과 토크가 삭제되며 되돌릴 수 없습니다.'}</div>
              <button className="btn danger" onClick={() => { if (DEMO) { api.current.reset(); location.reload(); } else send({ t: 'quit' }); }}>{DEMO ? '초기화' : '탈퇴하기'}</button></div>
          </Sheet>
        )}
        {banner && (
          <button key={banner.key} className="banner" onClick={() => openView(banner.view)} role="status">
            <span className="banner-ic"><Icon n={banner.kind === 'room' ? 'group' : banner.kind === 'comment' ? 'board' : banner.kind === 'pick' ? 'star' : banner.kind === 'event' ? 'gift' : 'mail'} size={18} /></span>
            <span className="grow"><b>{banner.title}</b><span className="one">{banner.body}</span></span>
          </button>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Ctx.Provider>
  );
}
