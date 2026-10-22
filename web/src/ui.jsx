import { createContext, useContext, useEffect, useState } from 'react';
import { WK, ymd, parseD, addD, fmtD, nightsBetween, initial, avColor, STATUS, LSTATUS } from './lib.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/* ---------- 아이콘 ---------- */
export const P = {
  heart: 'M12 20s-7-4.4-9.3-9C1 7.4 3.4 4 7 4c2 0 3.4 1.2 5 3 1.6-1.8 3-3 5-3 3.6 0 6 3.4 4.3 7-2.3 4.6-9.3 9-9.3 9z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  back: 'M15 18l-6-6 6-6', share: 'M12 3v13M7 8l5-5 5 5M5 14v6h14v-6',
  trip: 'M4 7h16v13H4zM9 7V4h6v3', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5', key: 'M15 7a4 4 0 1 1-3.5 6L5 19.5V22h3v-2h2v-2h2l1.5-1.5',
  door: 'M6 21V4h10v17M3 21h18M13 12h.01', medal: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14L7 22l5-3 5 3-1.5-8',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', chat: 'M4 5h16v11H8l-4 4z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
};
export const Icon = ({ d, ...p }) => (
  <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d={d} /></svg>
);
export const Star = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.2l1.4-7L2 9.4l7-.8z" /></svg>;

export const CATS = [
  { id: 'all', name: '전체', icon: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'hanok', name: '한옥', icon: 'M2 11c4-1 6-4 10-6 4 2 6 5 10 6M5 10v9h14v-9M10 19v-5h4v5' },
  { id: 'ocean', name: '오션뷰', icon: 'M2 15c2 2 4 2 6 0s4-2 6 0 4 2 6 0 2-1 2-1M2 19c2 2 4 2 6 0s4-2 6 0 4 2 6 0M16 9a4 4 0 1 0-8 0' },
  { id: 'forest', name: '산·숲', icon: 'M12 3l5 8h-3l4 6H6l4-6H7zM12 17v4' },
  { id: 'city', name: '도심', icon: 'M3 21h18M5 21V8h5v13M10 21V3h6v18M16 21v-9h4v9' },
  { id: 'pool', name: '풀빌라', icon: 'M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M7 15V5a2 2 0 0 1 4 0M13 15V5a2 2 0 0 1 4 0M7 9h6M7 12h6' },
  { id: 'camp', name: '캠핑', icon: 'M3 20L12 4l9 16zM12 20v-6l-3 6M12 14l3 6' },
  { id: 'cabin', name: '독채', icon: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M9 20v-6h6v6' },
];
export const AMEN = {
  wifi: ['와이파이', 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01'],
  parking: ['무료 주차', 'M5 21V3h7a5 5 0 0 1 0 10H5'],
  kitchen: ['주방', 'M6 3v8a2 2 0 0 0 4 0V3M8 11v10M16 3c-2 2-2 6 0 8v10'],
  washer: ['세탁기', 'M4 3h16v18H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 6h.01'],
  heat: ['난방', 'M8 4c-2 3 2 5 0 8M12 4c-2 3 2 5 0 8M16 4c-2 3 2 5 0 8M3 18h18'],
  ac: ['에어컨', 'M3 5h18v7H3zM7 16c0 2-1 3-2 4M12 16v5M17 16c0 2 1 3 2 4'],
  tea: ['다기·차 세트', 'M4 9h12v4a6 6 0 0 1-12 0zM16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3'],
  view: ['바다·산 전망', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
  bbq: ['바비큐 그릴', 'M4 10h16a8 8 0 0 1-16 0zM8 18l-2 4M16 18l2 4M9 6c0-2 2-2 2-4M13 6c0-2 2-2 2-4'],
  fire: ['장작 난로', 'M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z'],
  work: ['업무 공간', 'M3 20h18M5 20V9h14v11M9 9V5h6v4'],
  pool: ['수영장', 'M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M7 15V5a2 2 0 0 1 4 0M13 15V5a2 2 0 0 1 4 0'],
  shower: ['야외 샤워', 'M4 20V8a4 4 0 0 1 8 0M10 8h6M12 12v1M15 12v1M18 12v1M12 16v1M15 16v1M18 16v1'],
  sauna: ['사우나', 'M4 4h16v16H4zM8 9c-1 2 1 3 0 5M12 9c-1 2 1 3 0 5M16 9c-1 2 1 3 0 5'],
  tv: ['TV', 'M3 5h18v12H3zM8 21h8'],
  pet: ['반려동물 동반', 'M5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4M19 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4M9 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4M15 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4M12 12c-3 0-6 4-6 7 0 2 2 2 6 1 4 1 6 1 6-1 0-3-3-7-6-7'],
  ev: ['전기차 충전', 'M7 3h8v18H7zM15 8h2l2 3v6M11 7l-2 5h4l-2 5'],
  elevator: ['엘리베이터', 'M5 3h14v18H5zM12 3v18M8 9l1.5-2L11 9M13 15l1.5 2 1.5-2'],
};

export const Avatar = ({ name, src, lg }) => (
  <span className={'av' + (lg ? ' lg' : '')} style={{ background: src ? 'var(--sunk)' : avColor(name) }}>
    {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : initial(name)}
  </span>
);
export const Badge = ({ s, map = STATUS }) => { const [t, c] = map[s] || [s, 'st-mute']; return <span className={'state ' + c}>{t}</span>; };
export const LBadge = ({ s }) => <Badge s={s} map={LSTATUS} />;

export function Modal({ title, children, onClose }) {
  useEffect(() => { const f = e => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}><h3>{title}</h3>{children}</div>
    </div>
  );
}

// 확인 대화상자 (사유 입력 선택)
export function ConfirmModal({ title, text, okText = '확인', danger, reason, reasonLabel, reasonRequired, onOk, onClose }) {
  const [r, setR] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => {
    if (reasonRequired && r.trim().length < 2) { setErr('사유를 입력해 주세요.'); return; }
    setBusy(true); setErr('');
    try { await onOk(r.trim()); onClose(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      {text && <p className="muted" style={{ margin: 0 }}>{text}</p>}
      {reason && <label className="lbl" style={{ marginTop: 14 }}>{reasonLabel || '사유'}<textarea className="inp" id="confirm-reason" rows={3} maxLength={300} value={r} onChange={e => setR(e.target.value)} /></label>}
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      <div className="acts"><button className="btn line" onClick={onClose}>닫기</button><button className={'btn ' + (danger ? 'danger' : 'primary')} disabled={busy} onClick={go}>{okText}</button></div>
    </Modal>
  );
}

/* ---------- 달력 ---------- */
// mode 'range': 체크인/체크아웃 선택, mode 'multi': 호스트가 날짜 여러 개를 차단/해제
export function Calendar({ start, end, onChange, unavailable, months = 2, today, minNights = 1, mode = 'range', marks, onToggle }) {
  const [off, setOff] = useState(0);
  const T = parseD(today || ymd(new Date()));
  const base = new Date(T.getFullYear(), T.getMonth() + off, 1);
  const un = unavailable || new Set();
  const rangeBlocked = (a, b) => { let d = parseD(a); while (ymd(d) < b) { if (un.has(ymd(d))) return true; d = addD(d, 1); } return false; };
  const pick = s => {
    if (mode === 'multi') return onToggle(s);
    if (!start || end || s <= start) { if (!un.has(s)) onChange(s, null); return; }
    if (rangeBlocked(start, s)) { if (!un.has(s)) onChange(s, null); return; }
    if (nightsBetween(start, s) < minNights) return;
    onChange(start, s);
  };
  const month = m => {
    const first = new Date(base.getFullYear(), base.getMonth() + m, 1), cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(<span key={'e' + i} />);
    const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= n; d++) {
      const dt = new Date(first.getFullYear(), first.getMonth(), d), s = ymd(dt), past = dt < T;
      let cls = past ? 'past' : '', disabled = past;
      if (mode === 'range') {
        // 체크아웃 날짜는 그날 밤이 막혀 있어도 고를 수 있음 (그날은 숙박하지 않으므로)
        const asCheckout = start && !end && s > start && !rangeBlocked(start, s);
        if (un.has(s) && !asCheckout) disabled = true;
        if (s === start || s === end) cls += ' edge';
        else if (start && end && s > start && s < end) cls += ' in';
      } else {
        const mk = marks?.[s];
        if (mk === 'booked') { cls += ' bk'; disabled = true; } else if (mk === 'blocked') cls += ' blk';
      }
      cells.push(<button key={s} type="button" className={cls} disabled={disabled} onClick={() => pick(s)} aria-label={fmtD(s)} aria-pressed={s === start || s === end}>{d}</button>);
    }
    return <div className="mon" key={m}><h5>{first.getFullYear()}년 {first.getMonth() + 1}월</h5><div className="days">{WK.map(w => <span className="w" key={w}>{w}</span>)}{cells}</div></div>;
  };
  const hint = mode === 'multi' ? '날짜를 누르면 예약 받기/막기가 바뀌어요' : start && end ? `${nightsBetween(start, end)}박 선택됨` : start ? '체크아웃 날짜를 고르세요' : '체크인 날짜를 고르세요';
  return (
    <div>
      <div className="calnav">
        <button type="button" onClick={() => setOff(Math.max(0, off - 1))} disabled={off === 0} aria-label="이전 달">‹</button>
        <span className="num muted" style={{ fontSize: 13 }}>{hint}</span>
        <button type="button" onClick={() => setOff(Math.min(11, off + 1))} disabled={off >= 11} aria-label="다음 달">›</button>
      </div>
      <div className={'cal' + (months === 1 ? ' one' : '')}>{Array.from({ length: months }, (_, i) => month(i))}</div>
      {mode === 'range' && <div className="calfoot"><span>{minNights > 1 ? `최소 ${minNights}박 · ` : ''}취소선 날짜는 예약 마감</span><button type="button" onClick={() => onChange(null, null)}>날짜 지우기</button></div>}
    </div>
  );
}

export function Stepper({ label, sub, value, min = 1, max = 16, onChange, id }) {
  return (
    <div className="stepper">
      <div><b>{label}</b>{sub && <small>{sub}</small>}</div>
      <div className="ctl">
        <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={label + ' 줄이기'}>−</button>
        <span className="num" id={id} aria-live="polite">{value}</span>
        <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={label + ' 늘리기'}>+</button>
      </div>
    </div>
  );
}

export function useNarrow(px = 760) {
  const [n, setN] = useState(typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => { const f = () => setN(window.innerWidth < px); addEventListener('resize', f); return () => removeEventListener('resize', f); }, [px]);
  return n;
}

export const Loading = () => <div className="grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: '20/24' }} />)}</div>;
export const ErrorBox = ({ error, retry }) => <div className="empty"><b>불러오지 못했어요</b>{error}{retry && <><br /><button className="link" onClick={retry}>다시 시도</button></>}</div>;
