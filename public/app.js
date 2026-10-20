(() => {
'use strict';
/* ===== 상수 ===== */
const TYPES = ['호텔/리조트','모텔','펜션/풀빌라','게하/한옥','캠핑/글램핑'];
const SIDO = ['서울','경기','인천','강원','부산','경상','제주','전라','충청'];
const AMEN = ['무료주차','수영장','조식','바베큐','와이파이','스파/월풀','반려견동반','취사가능','넷플릭스','오션뷰'];
const QUICK = [['avail','예약가능'],['이번주특가','이번주특가'],['신축/리모델링','신축/리모델링'],['무료주차','무료주차'],['수영장','수영장'],['조식','조식'],['오션뷰','오션뷰']];
const SORTS = [['rec','추천순'],['low','가격 낮은 순'],['high','가격 높은 순'],['rate','평점 높은 순'],['review','후기 많은 순']];
const STATUS = {pending:'결제대기', wait:'입금대기', ok:'예약확정', done:'이용완료', cancel:'취소'};
const STCLS = {pending:'wait', wait:'wait', ok:'ok', done:'done', cancel:'cancel'};
const PAY = {card:'카드·간편결제', bank:'무통장입금', site:'현장결제', points:'포인트 전액'};
const PKIND = {signup:'가입 축하', earn:'적립', use:'사용', use_cancel:'사용 취소', earn_cancel:'적립 취소', admin_add:'지급', admin_sub:'차감', expire:'소멸'};

/* ===== 아이콘 ===== */
const sv = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  back: sv('<path d="M15 5l-7 7 7 7"/>'), close: sv('<path d="M6 6l12 12M18 6L6 18"/>'),
  search: sv('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>'),
  cal: sv('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  user: sv('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  pin: sv('<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  home: sv('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
  map: sv('<path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  heart: sv('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z"/>'),
  heartF: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
  list: sv('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/>'),
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
  sort: sv('<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>'),
  filter: sv('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  check: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  chev: sv('<path d="M9 5l7 7-7 7"/>'),
  down: sv('<path d="M6 9l6 6 6-6"/>'),
  bolt: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>',
  me: sv('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 01-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0012 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 010-4.7V6.6h-4a12 12 0 000 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 001.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>',
  kakao: '<svg viewBox="0 0 24 24"><path fill="#191600" d="M12 3.5C6.8 3.5 2.5 6.8 2.5 10.9c0 2.6 1.8 4.9 4.4 6.3l-1 3.7c-.1.3.3.6.6.4l4.4-2.9c.4 0 .7.1 1.1.1 5.2 0 9.5-3.3 9.5-7.4S17.2 3.5 12 3.5z"/></svg>',
  t0: sv('<path d="M4 20V6l8-3 8 3v14M4 20h16M9 20v-4h6v4M8 8h1M11.5 8h1M15 8h1M8 11.5h1M11.5 11.5h1M15 11.5h1"/>'),
  t1: sv('<path d="M3 20V9l9-5 9 5v11z"/><path d="M8 20v-6h8v6M3 20h18"/><path d="M10 9.5h4"/>'),
  t2: sv('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/><path d="M2 21c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1"/>'),
  t3: sv('<path d="M2 10c4-1 6-4 10-6 4 2 6 5 10 6"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-5h6v5M3 20h18"/>'),
  t4: sv('<path d="M3 20L12 4l9 16z"/><path d="M12 4v16M9 20l3-6 3 6"/>'),
};
const TICON = t => I['t'+Math.max(0,TYPES.indexOf(t))];
const AICON = {
  '무료주차':sv('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 16V8h3a2.5 2.5 0 010 5h-3"/>'),
  '수영장':sv('<path d="M3 17c2 0 2-1.5 4.5-1.5S9.5 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17"/><path d="M8 14V5a2 2 0 014 0M16 14V5a2 2 0 00-4 0M8 9h8"/>'),
  '조식':sv('<path d="M4 11h13v2a6 6 0 01-6 6h-1a6 6 0 01-6-6z"/><path d="M17 12h1.5a2 2 0 010 4H16M8 4v3M11 3v4M14 4v3"/>'),
  '바베큐':sv('<path d="M4 9h16a8 8 0 01-16 0z"/><path d="M8 16.5L6 21M16 16.5l2 4.5M12 17v4"/>'),
  '와이파이':sv('<path d="M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19" r="1"/>'),
  '스파/월풀':sv('<path d="M3 12h18v3a5 5 0 01-5 5H8a5 5 0 01-5-5z"/><path d="M6 12V6a2 2 0 014 0"/>'),
  '반려견동반':sv('<circle cx="6" cy="10" r="1.8"/><circle cx="9.5" cy="6" r="1.8"/><circle cx="14.5" cy="6" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M12 12c-3 0-5.5 4-5.5 6a2 2 0 002.5 2c1.2-.3 2-.6 3-.6s1.8.3 3 .6a2 2 0 002.5-2c0-2-2.5-6-5.5-6z"/>'),
  '취사가능':sv('<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M4 13h16M8 9V6M12 9V4M16 9V6"/>'),
  '넷플릭스':sv('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4M10.5 8.5v5l4-2.5z"/>'),
  '오션뷰':sv('<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><circle cx="12" cy="8" r="3"/>')
};

/* ===== 유틸 ===== */
const $ = (s,r=document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p2 = n => String(n).padStart(2,'0');
const won = n => (Math.round(n)||0).toLocaleString('ko-KR');
const WD = ['일','월','화','수','목','금','토'];
const ds = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const pd = s => { const [y,m,d] = String(s).slice(0,10).split('-').map(Number); return new Date(y, m-1, d); };
const addD = (s,n) => { const d = pd(s); d.setDate(d.getDate()+n); return ds(d); };
let TODAY = ds(new Date());
const today = () => TODAY;
const nightsOf = (a,b) => Math.round((pd(b)-pd(a))/864e5);
const fmtS = s => { const d = pd(s); return `${p2(d.getMonth()+1)}.${p2(d.getDate())} (${WD[d.getDay()]})`; };
const fmtL = s => { const d = pd(s); return `${d.getMonth()+1}월 ${d.getDate()}일(${WD[d.getDay()]})`; };
const fmtDT = iso => { if(!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}.${p2(d.getMonth()+1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtD = iso => fmtDT(iso).slice(0,10);
const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v==null ? def : JSON.parse(v); } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const hash = s => { let h = 0; for (const c of String(s)) h = (h*31 + c.charCodeAt(0))|0; return Math.abs(h); };
const nightsList = (a,b) => { const out=[]; for (let d=a; d<b; d=addD(d,1)) out.push(d); return out; };
const isWeekendNight = s => { const w = pd(s).getDay(); return w===5 || w===6; };
const img = id => id ? '/img/' + encodeURIComponent(id) : '';

async function api(method, path, body){
  const r = await fetch(path, {method, credentials:'same-origin', headers:{'Content-Type':'application/json','X-Requested-With':'stayon'}, body: body===undefined ? undefined : JSON.stringify(body)});
  const j = await r.json().catch(()=>({}));
  if (!r.ok) { const e = new Error(j.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); e.status = r.status; e.code = j.code; throw e; }
  return j;
}

/* ===== 상태 ===== */
let D = {settings:{points:{}}, pay:{}, login:{}, places:[], rooms:[], nights:[], banners:[], wish:[], me:null};
let PL = {}, RM = {}, NT = {};
let me = null, ready = false;
const set = () => D.settings;
let cond = lsGet('so_cond', null);
let filt = {types:[], min:'', max:'', amen:[], quick:[], sort:'rec'};
let recent = lsGet('so_recent', []);
let tab = 'home', stack = [], dirty = false;
let myBookings = null;
const reviewCache = {};

function index(){
  TODAY = D.today || TODAY;
  if (!cond || !cond.in || cond.in < today()) cond = {sido:'', area:'', keyword:'', in: today(), out: addD(today(),1), adults:2, children:0};
  PL = Object.fromEntries(D.places.map(p=>[p.id,p]));
  RM = Object.fromEntries(D.rooms.map(r=>[r.id,r]));
  NT = {};
  for (const n of D.nights) (NT[n.room_id] = NT[n.room_id] || {})[n.night] = n;
  me = D.me;
  applyBrand();
}
async function load(){ D = await api('GET','/api/bootstrap'); index(); ready = true; }
async function refreshMe(){ try { const r = await api('GET','/api/me'); me = D.me = r.me; } catch {} }
const saveCond = () => lsSet('so_cond', cond);

/* ===== 계산 ===== */
const guests = () => cond.adults + cond.children;
const roomsOf = pid => D.rooms.filter(r => r.place_id===pid);
function roomQuote(r, a=cond.in, b=cond.out){
  const ns = nightsList(a,b), occ = NT[r.id] || {};
  const soldOut = ns.some(n => occ[n] && (occ[n].closed || occ[n].booked >= r.stock));
  const lines = ns.map(n => ({date:n, price: occ[n] && occ[n].price!=null ? occ[n].price : (isWeekendNight(n) && r.weekend_price ? r.weekend_price : r.price)}));
  const total = lines.reduce((s,x)=>s+x.price,0);
  const list = (r.list_price||0) * ns.length;
  return {lines, total, avg: ns.length ? total/ns.length : 0, list: list>total ? list : 0, soldOut, fits: r.max >= guests(), nights: ns.length};
}
function placeQuote(pid){
  const rs = roomsOf(pid).map(r => ({r, q: roomQuote(r)})).filter(x => x.q.fits);
  const open = rs.filter(x => !x.q.soldOut);
  const pick = (open.length ? open : rs).sort((a,b)=>a.q.total-b.q.total)[0];
  return {best: pick, available: open.length>0, any: rs.length>0};
}
function ph(p, seed, i=0, src){
  const s = src !== undefined ? src : (p && p.photos && p.photos[i] ? img(p.photos[i]) : '');
  if (s) return `<span class="ph"><img src="${esc(s)}" alt="" loading="lazy"></span>`;
  const h = hash(seed || (p && p.name) || 'x') % 360;
  return `<span class="ph"><span class="gen" style="background:linear-gradient(135deg,hsl(${h} 45% 62%),hsl(${(h+40)%360} 50% 42%))">${TICON(p && p.type)}</span></span>`;
}
const condText = () => `${fmtS(cond.in)} ~ ${fmtS(cond.out)} · ${nightsOf(cond.in,cond.out)}박`;
const guestText = () => `성인 ${cond.adults}${cond.children?`, 아동 ${cond.children}`:''}`;

/* ===== 공통 UI ===== */
let toastT;
function toast(m){ let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t);} t.textContent=m; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
function confirmBox(title, msg, ok='확인', danger=false){
  return new Promise(res => {
    const d = document.createElement('div'); d.className='dim'; d.style.alignItems='center';
    d.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><div class="dt">${esc(title)}</div>${msg?`<div class="dm">${esc(msg)}</div>`:''}<div class="da"><button class="btn ghost" data-x="0">취소</button><button class="btn ${danger?'danger':''}" data-x="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b || e.target===d) { d.remove(); res(!!(b && b.dataset.x==='1')); } });
    d.querySelector('[data-x="1"]').focus();
  });
}
async function copyText(t){ try { await navigator.clipboard.writeText(t); toast('복사했습니다.'); } catch { toast('복사할 수 없는 환경입니다. 길게 눌러 복사하세요.'); } }
const top = (title, {back=true, right=''}={}) => `<header class="top line">${back?`<button class="ib" data-a="back" aria-label="뒤로">${I.back}</button>`:''}<h1>${esc(title)}</h1>${right}</header>`;
const nav = () => {
  const items = [['home','홈',I.home],['region','지역',I.map],['wish','찜',I.heart],['trips','예약내역',I.list],['my',me?'마이':'로그인',I.me]];
  return `<nav class="nav" aria-label="메뉴">${items.map(([k,l,ic])=>`<button class="${tab===k&&!stack.length?'on':''}" data-a="tab" data-v="${k}" aria-label="${l}">${ic}<span>${l}</span></button>`).join('')}</nav>`;
};
function applyBrand(){
  document.documentElement.style.setProperty('--brand', set().color || '#3b4bdf');
  document.title = `${set().brand || '스테이온'} - 숙소 예약`;
}
const stTag = s => `<span class="st ${STCLS[s]}">${STATUS[s]||s}</span>`;
const testBadge = () => D.pay && D.pay.test ? `<div class="testpay">지금은 <b>테스트 결제 모드</b>입니다. 실제 돈이 결제되지 않습니다. PG사 연동 후 실제 결제로 바뀝니다.</div>` : '';

/* ===== 광고 ===== */
const adSeen = new Set(), adPick = {};
function track(id, k){ fetch('/api/ads/track', {method:'POST', keepalive:true, headers:{'Content-Type':'application/json','X-Requested-With':'stayon'}, body: JSON.stringify({id, k})}).catch(()=>{}); }
function markImp(id){ if (!adSeen.has(id)) { adSeen.add(id); track(id,'i'); } }
function adCard(b){
  const inner = b.image ? `<img src="${esc(img(b.image))}" alt="${esc(b.title)}">` : `<span class="adtxt" style="background:${esc(b.bg||'#3b4bdf')}"><b>${esc(b.title)}</b>${b.sub?`<span>${esc(b.sub)}</span>`:''}</span>`;
  const url = /^https?:\/\//i.test(b.link||'') ? b.link : '';
  return url ? `<a class="adb" href="${esc(url)}" target="_blank" rel="noopener sponsored" data-ad="${b.id}">${inner}<span class="adl">광고</span></a>` : `<div class="adb" data-ad="${b.id}">${inner}<span class="adl">광고</span></div>`;
}
function adSlot(slot){
  const list = D.banners.filter(b => b.slot===slot); if (!list.length) return '';
  if (slot==='home') { markImp(list[0].id); return `<div class="adwrap home"><div class="adtrack" id="adTrack">${list.map(adCard).join('')}</div>${list.length>1?`<span class="adcnt tnum" id="adCnt">1/${list.length}</span>`:''}</div>`; }
  const topP = list[0].priority, tops = list.filter(b=>b.priority===topP);
  if (!adPick[slot] || !tops.some(b=>b.id===adPick[slot])) adPick[slot] = tops[Math.floor(Math.random()*tops.length)].id;
  const b = list.find(x=>x.id===adPick[slot]); markImp(b.id);
  return `<div class="adwrap ${slot}">${adCard(b)}</div>`;
}
document.addEventListener('click', e => { const a = e.target.closest('[data-ad]'); if (a) track(+a.dataset.ad, 'c'); }, true);

/* ===== 카드 ===== */
function priceBlock(q, compact){
  if (!q) return '';
  const pct = q.list ? Math.round((1 - q.total/q.list)*100) : 0;
  return `<div class="price tnum">${compact?'':`<span class="lb">숙박 ${q.nights}박</span>`}${q.list?`<span class="old">${won(q.list)}원</span>`:''}<span class="now">${pct?`<span class="pct">${pct}%</span>`:''}<span class="won">${won(q.total)}원</span></span>${q.nights>1?`<span class="tot">1박 평균 ${won(q.avg)}원</span>`:''}</div>`;
}
const isWish = id => D.wish.includes(id);
function placeCard(p){
  const pq = placeQuote(p.id), w = isWish(p.id);
  return `<div style="position:relative"><button class="pc" data-a="place" data-v="${p.id}">
    ${ph(p, p.id)}
    <div class="ty">${esc(p.type)}${p.grade?` · ${esc(p.grade)}`:''}${p.sample?'<span class="exbadge">예시</span>':''}</div>
    <div class="nm">${esc(p.name)}</div>
    ${p.reviews ? `<div class="rate">${I.star}<b>${p.rating.toFixed(1)}</b><span>(${p.reviews})</span></div>` : `<div class="rate"><span class="tag y">신규</span></div>`}
    <div class="loc">${esc([p.sido,p.area].filter(Boolean).join(' · '))}</div>
    ${(p.tags||[]).length?`<div class="tags">${p.tags.map(t=>`<span class="tag ${t==='이번주특가'||t==='즉시할인'?'b':''}">${esc(t)}</span>`).join('')}</div>`:''}
    ${!pq.any ? `<div class="price"><span class="soldout">${roomsOf(p.id).length?'인원 초과':'객실 준비중'}</span></div>` : pq.available ? priceBlock(pq.best.q) : `<div class="price"><span class="lb">숙박 ${nightsOf(cond.in,cond.out)}박</span><span class="soldout">예약마감</span></div>`}
  </button><span class="wish"><button class="wishbtn ${w?'on':''}" data-a="wish" data-v="${p.id}" aria-label="찜하기" aria-pressed="${w}">${w?I.heartF:I.heart}</button></span></div>`;
}
function miniCard(p){
  const pq = placeQuote(p.id);
  return `<button class="mini" data-a="place" data-v="${p.id}">${ph(p,p.id)}<div class="n">${esc(p.name)}</div><div class="s">${esc(p.type)} · ${esc(p.area||p.sido||'')}</div><div class="p tnum">${pq.available ? won(pq.best.q.avg)+'원~' : '<span style="color:var(--ink3)">예약마감</span>'}</div></button>`;
}

/* ===== 화면 ===== */
const V = {};
V.home = () => {
  const ps = D.places, st = set();
  const featured = ps.filter(p=>p.featured), deals = ps.filter(p=>(p.tags||[]).includes('이번주특가'));
  return `<section class="screen">
    <header class="top"><div class="logo"><i>${I.bolt}</i>${esc(st.brand)}</div><div style="flex:1"></div>${me?`<button class="tx" data-a="tab" data-v="my">${(me.points||0).toLocaleString()}P</button>`:`<button class="tx" data-a="login">로그인</button>`}</header>
    <div class="searchbox">
      <form class="cond" data-f="kw" role="search">${I.search}<input id="kwHome" name="kw" placeholder="지역, 숙소명으로 찾아보세요" value="${esc(cond.keyword)}" enterkeyhint="search"></form>
      <div class="condrow">
        <button class="cond" data-a="condSheet">${I.cal}<span class="tnum">${condText()}</span></button>
        <button class="cond" data-a="condSheet">${I.user}<span>${guestText()}</span></button>
      </div>
      <button class="btn full" data-a="search">검색</button>
    </div>
    ${adSlot('home')}
    <div class="qc">${TYPES.map(t=>`<button data-a="type" data-v="${esc(t)}"><i>${TICON(t)}</i>${esc(t)}</button>`).join('')}</div>
    ${!me && st.points.signupBonus ? `<div class="banner"><div><b>지금 가입하면 ${won(st.points.signupBonus)}P</b><span>숙박 후 결제금액의 ${st.points.earnRate}% 적립</span></div><button class="btn sm" data-a="signup">회원가입</button></div>`:''}
    ${!ps.length ? `<div class="empty"><b>${ready?'등록된 숙소가 없어요':'불러오는 중…'}</b></div>` : ''}
    ${featured.length?`<div class="sect"><h2>${esc(st.brand)} 초이스 <button data-a="all">전체보기</button></h2><div class="hscroll">${featured.map(miniCard).join('')}</div></div>`:''}
    ${deals.length?`<div class="sect"><h2>이번주특가</h2><div class="hscroll">${deals.map(miniCard).join('')}</div></div>`:''}
    ${ps.length?`<div class="sect"><h2>새로 등록된 숙소</h2><div class="hscroll">${[...ps].sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,8).map(miniCard).join('')}</div></div>`:''}
    ${footer()}
  </section>${nav()}`;
};
function footer(){
  const st = set();
  return `<div class="foot">
    <b>${esc(st.company || st.brand)}</b>${st.ceo?` · 대표 ${esc(st.ceo)}`:''}${st.bizNo?`<br>사업자등록번호 ${esc(st.bizNo)}`:''}${st.saleNo?` · 통신판매업 ${esc(st.saleNo)}`:''}${st.address?`<br>${esc(st.address)}`:''}
    ${st.phone?`<br>고객센터 <span style="user-select:all">${esc(st.phone)}</span>`:''}${st.adContact?`<br>광고 문의 <span style="user-select:all">${esc(st.adContact)}</span>`:''}
    <br><button class="linkbtn" style="color:var(--ink3)" data-a="terms" data-v="service">이용약관</button> · <button class="linkbtn" style="color:var(--ink2);font-weight:700" data-a="terms" data-v="privacy">개인정보처리방침</button>
  </div>`;
}

V.region = () => {
  const sel = V.region.sido || SIDO[0];
  const areas = {};
  D.places.filter(p=>p.sido===sel).forEach(p => { const a = p.area || '기타'; areas[a] = (areas[a]||0)+1; });
  const n = D.places.filter(p=>p.sido===sel).length;
  return `<section class="screen">
    ${top('어디로 갈까요?',{back:false})}
    <form class="cond" data-f="kw" role="search" style="margin:8px var(--gr) 12px var(--gl);width:auto">${I.search}<input id="kwRegion" name="kw" placeholder="지역, 숙소명으로 찾아보세요" value="${esc(cond.keyword)}" enterkeyhint="search"></form>
    ${recent.length?`<div class="note pad">최근선택지역</div><div class="recent">${recent.map(r=>`<button class="chip" data-a="area" data-s="${esc(r.sido)}" data-v="${esc(r.area)}">${esc(r.sido)}${r.area?` · ${esc(r.area)}`:''}</button>`).join('')}</div>`:''}
    <div class="region">
      <div class="l">${SIDO.map(s=>`<button class="${s===sel?'on':''}" data-a="sido" data-v="${s}">${s}</button>`).join('')}</div>
      <div class="r">
        <button class="all" data-a="area" data-s="${sel}" data-v=""><span>${sel} 전체</span><small>${n}</small></button>
        ${Object.entries(areas).sort().map(([a,c])=>`<button data-a="area" data-s="${sel}" data-v="${esc(a)}"><span>${esc(a)}</span><small>${c}</small></button>`).join('')}
        ${!n?`<div class="none">아직 ${sel} 지역에 등록된 숙소가 없어요.</div>`:''}
      </div>
    </div>
  </section>${nav()}`;
};

V.list = () => {
  const kw = (cond.keyword||'').trim().toLowerCase();
  let rows = D.places.filter(p =>
    (!cond.sido || p.sido===cond.sido) && (!cond.area || (p.area||'기타')===cond.area) &&
    (!kw || [p.name,p.sido,p.area,p.address,p.type].join(' ').toLowerCase().includes(kw)) &&
    (!filt.types.length || filt.types.includes(p.type)) && filt.amen.every(a => (p.amenities||[]).includes(a)))
    .map(p => ({p, q: placeQuote(p.id)}));
  for (const k of filt.quick) rows = k==='avail' ? rows.filter(x=>x.q.available) : rows.filter(x => (x.p.tags||[]).includes(k) || (x.p.amenities||[]).includes(k));
  if (filt.min!=='' || filt.max!=='') rows = rows.filter(x => { if (!x.q.best) return false; const v = x.q.best.q.avg/10000; return (filt.min===''||v>=+filt.min) && (filt.max===''||v<=+filt.max); });
  const price = x => x.q.best ? x.q.best.q.avg : null;
  const sorters = {
    rec: (a,b) => (b.p.featured?1:0)-(a.p.featured?1:0) || (b.q.available?1:0)-(a.q.available?1:0) || b.p.rating-a.p.rating,
    low: (a,b) => (price(a)??Infinity)-(price(b)??Infinity), high: (a,b) => (price(b)??-1)-(price(a)??-1),
    rate: (a,b) => b.p.rating-a.p.rating || b.p.reviews-a.p.reviews, review: (a,b) => b.p.reviews-a.p.reviews
  };
  rows.sort(sorters[filt.sort]);
  const title = cond.keyword ? `'${cond.keyword}'` : cond.sido ? `${cond.sido}${cond.area?` · ${cond.area}`:' 전체'}` : (filt.types.length===1 ? filt.types[0] : '전체 숙소');
  const fcount = filt.types.length + filt.amen.length + (filt.min!==''||filt.max!==''?1:0);
  return `<section class="screen">
    <div class="ltop">
      <div class="bar"><button class="ib" data-a="back" aria-label="뒤로">${I.back}</button>
        <button class="q" data-a="condSheet"><b>${esc(title)}</b><span class="tnum">${condText()} · ${guestText()}</span></button></div>
      <div class="chips">
        <button class="chip ${filt.sort!=='rec'?'on':''}" data-a="sortSheet">${I.sort}${esc(SORTS.find(s=>s[0]===filt.sort)[1])}</button>
        <button class="chip ${fcount?'on':''}" data-a="filterSheet">${I.filter}필터${fcount?` ${fcount}`:''}</button>
        ${QUICK.map(([k,l])=>`<button class="chip ${filt.quick.includes(k)?'on':''}" data-a="quick" data-v="${esc(k)}" aria-pressed="${filt.quick.includes(k)}">${esc(l)}</button>`).join('')}
      </div>
    </div>
    ${rows.length ? `<div class="count"><b>${rows.length}</b>개의 숙소</div>${rows.map((x,i)=>placeCard(x.p)+(i===Math.min(2,rows.length-1)?adSlot('list'):'')).join('')}`
      : `<div class="empty"><b>조건에 맞는 상품이 없어요</b>지역이나 날짜, 인원을 변경해보세요.<br>${fcount||filt.quick.length?`<button class="btn ghost" data-a="resetFilter">필터 초기화하기</button>`:''}</div>`}
  </section>${nav()}`;
};

V.place = ({id}) => {
  const p = PL[id]; if (!p) return gone();
  const photos = (p.photos && p.photos.length) ? p.photos : [null];
  const w = isWish(id), st = set();
  const rooms = roomsOf(id).map(r => ({r, q: roomQuote(r)}));
  const pq = placeQuote(id);
  const revs = reviewCache[id];
  if (!revs) api('GET', `/api/places/${id}/reviews`).then(r => { reviewCache[id] = r; render(true); }).catch(()=>{});
  const mapUrl = 'https://map.naver.com/p/search/' + encodeURIComponent(p.address || p.name);
  return `<section class="screen nonav">
    <div class="gal"><div class="track" id="galTrack">${photos.map((x,i)=>ph(p, id+'-'+i, i)).join('')}</div>
      <span class="cnt tnum" id="galCnt">1/${photos.length}</span>
      <div class="ov"><button class="ib" data-a="back" aria-label="뒤로">${I.back}</button><button class="ib ${w?'on':''}" data-a="wish" data-v="${id}" aria-label="찜하기" aria-pressed="${w}">${w?I.heartF:I.heart}</button></div></div>
    <div class="dhead">
      <div class="ty">${esc(p.type)}${p.grade?` · ${esc(p.grade)}`:''}${p.sample?'<span class="exbadge">예시 숙소</span>':''}</div>
      <h1>${esc(p.name)}</h1>
      ${p.reviews?`<div class="rate" style="margin-top:8px">${I.star}<b>${p.rating.toFixed(1)}</b><span>후기 ${p.reviews}개</span></div>`:''}
      ${(p.tags||[]).length?`<div class="tags">${p.tags.map(t=>`<span class="tag ${t==='이번주특가'||t==='즉시할인'?'b':''}">${esc(t)}</span>`).join('')}</div>`:''}
      <div class="addr">${I.pin.replace('<svg','<svg style="width:16px;height:16px;flex:none;margin-top:1px"')}<span>${esc(p.address||'-')}</span><button class="linkbtn" data-a="copy" data-v="${esc(p.address||'')}">주소복사</button><a class="linkbtn" href="${esc(mapUrl)}" target="_blank" rel="noopener">지도보기</a></div>
      ${p.phone?`<div class="addr"><span>연락처 <span style="user-select:all">${esc(p.phone)}</span></span></div>`:''}
    </div>
    <div class="gap8"></div>
    <div class="dsec" id="rooms"><h3>객실 선택</h3>
      <button class="condbar" data-a="condSheet">${I.cal}<span class="tnum">${condText()} · ${guestText()}</span>${I.down.replace('<svg','<svg style="width:16px;height:16px"')}</button>
      ${rooms.length ? rooms.map(({r,q}) => `<div class="room">
        ${(r.photos&&r.photos[0])?ph(null,'',0,img(r.photos[0])):''}
        <div class="bd"><div class="rn">${esc(r.name)}</div>
          <div class="rs">기준 ${r.base}명 / 최대 ${r.max}명 · 입실 ${esc(p.check_in)} · 퇴실 ${esc(p.check_out)}</div>
          ${r.descr?`<div class="rd">${esc(r.descr)}</div>`:''}
          <div class="rp"><span class="lbl">숙박</span>${q.soldOut||!q.fits ? `<span class="soldout">${!q.fits?'인원 초과':'판매 완료'}</span>` : priceBlock(q,true)}</div>
          ${q.soldOut||!q.fits?'':`<div class="note" style="text-align:right;margin-top:4px">결제금액의 ${st.points.earnRate}% 포인트 적립</div>`}
          <button class="btn full" data-a="book" data-v="${r.id}" ${q.soldOut||!q.fits?'disabled':''}>${q.soldOut?'판매 완료':!q.fits?`최대 ${r.max}명까지 예약 가능`:'예약하기'}</button>
        </div></div>`).join('') : `<div class="note" style="padding:20px 0">등록된 객실이 없습니다.</div>`}
    </div>
    ${p.intro?`<div class="gap8"></div><div class="dsec"><h3>숙소 소개</h3><p>${esc(p.intro)}</p></div>`:''}
    ${(p.amenities||[]).length?`<div class="gap8"></div><div class="dsec"><h3>편의시설</h3><div class="amen">${p.amenities.map(a=>`<div>${AICON[a]||I.check}${esc(a)}</div>`).join('')}</div></div>`:''}
    <div class="gap8"></div>
    ${adSlot('detail')}
    <div class="dsec"><h3>이용 안내</h3><dl class="info"><dt>체크인</dt><dd>${esc(p.check_in)} 이후</dd><dt>체크아웃</dt><dd>${esc(p.check_out)} 이전</dd></dl>${p.notice?`<p style="margin-top:14px;color:var(--ink2);font-size:13px">${esc(p.notice)}</p>`:''}</div>
    <div class="gap8"></div>
    <div class="dsec"><h3>취소 및 환불 규정</h3><p style="font-size:13px;color:var(--ink2)">${esc(st.cancelPolicy)}</p></div>
    <div class="gap8"></div>
    <div class="dsec"><h3>후기 ${p.reviews?`<span style="font-size:14px;color:var(--ink2);font-weight:400">★ ${p.rating.toFixed(1)} · ${p.reviews}개</span>`:''}</h3>
      ${!revs ? `<div class="note">불러오는 중…</div>` : revs.length ? revs.map(r=>`<div class="rv"><div class="h"><span class="st" style="color:var(--star);padding:0">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span><b>${esc(r.author)}</b><span>${fmtD(r.created_at)}</span>${r.mine?`<button class="linkbtn" style="margin-left:auto;color:var(--ink3)" data-a="delReview" data-v="${r.id}" data-p="${id}">삭제</button>`:''}</div>${r.room_name?`<div class="rm">${esc(r.room_name)} 이용</div>`:''}<p>${esc(r.text)}</p>${r.reply?`<div class="rvrep"><b>숙소 답글</b>${esc(r.reply)}</div>`:''}</div>`).join('') : `<div class="note">아직 후기가 없어요. 숙박을 마친 회원만 후기를 남길 수 있어요.</div>`}
    </div>
    <div class="cta"><div class="l">${pq.available?`<small>${condText()}</small><b class="tnum">${won(pq.best.q.total)}원~</b>`:`<small>${condText()}</small><b style="color:var(--ink3);font-size:16px">예약 가능한 객실 없음</b>`}</div><button class="btn" data-a="toRooms">객실 선택하기</button></div>
  </section>`;
};

V.book = ({rid}) => {
  const r = RM[rid]; if (!r) return gone();
  const p = PL[r.place_id] || {}, st = set(), pol = st.points;
  const q = roomQuote(r);
  const methods = st.payMethods;
  const have = me ? me.points : 0;
  const cap = Math.floor(Math.min(Math.floor(q.total * pol.maxUseRate / 100), have) / pol.unit) * pol.unit;
  const usable = cap >= pol.minUse ? cap : 0;
  return `<section class="screen nonav">${top('예약')}
    <form class="form" data-f="book" data-r="${rid}">
      <div class="sum"><div class="pn">${esc(p.name)}</div><div class="rn">${esc(r.name)}</div>
        <dl class="tnum"><dt>체크인</dt><dd>${fmtL(cond.in)} ${esc(p.check_in)}</dd><dt>체크아웃</dt><dd>${fmtL(cond.out)} ${esc(p.check_out)}</dd><dt>인원</dt><dd>${guestText()}</dd></dl></div>
      <h3>예약자 정보</h3>
      <label class="fl" for="bkName">예약자 이름</label><input class="in" id="bkName" name="guestName" value="${esc(me.name)}" required autocomplete="name" maxlength="20">
      <label class="fl" for="bkPhone">휴대폰 번호</label><input class="in" id="bkPhone" name="phone" value="${esc(me.phone)}" required inputmode="tel" autocomplete="tel" maxlength="13">
      <div class="fl">방문 수단</div>
      <div class="seg"><label><input type="radio" name="visit" value="도보" checked><span>도보</span></label><label><input type="radio" name="visit" value="차량"><span>차량</span></label></div>
      <label class="fl" for="bkReq">요청사항 (선택)</label><textarea class="in" id="bkReq" name="request" maxlength="300" placeholder="숙소에 전달할 내용을 적어주세요."></textarea>
      <h3>포인트</h3>
      <div class="usept"><input class="in tnum" id="bkPts" name="points" type="number" min="0" step="${pol.unit}" max="${usable}" placeholder="0" ${usable?'':'disabled'}><button type="button" class="btn ghost sm" style="height:48px" data-a="allPts" data-v="${usable}" ${usable?'':'disabled'}>최대 사용</button></div>
      <p class="note" style="margin:6px 0 0;line-height:1.6">보유 ${won(have)}P · 이 예약에 최대 ${won(usable)}P 사용 가능 (${won(pol.minUse)}P부터, ${pol.unit}P 단위, 객실요금의 ${pol.maxUseRate}%까지)</p>
      <h3>결제 방법</h3>
      <div class="seg" id="paySeg">${methods.map((m,i)=>`<label><input type="radio" name="pay" value="${m}" ${i===0?'checked':''}><span>${PAY[m]}</span></label>`).join('')}</div>
      <p class="note" style="margin:6px 0 0;line-height:1.6" id="payNote"></p>
      ${methods.includes('card')?testBadge():''}
      <h3>결제 금액</h3>
      <div class="lines tnum">${q.lines.map(l=>`<div><span>${fmtS(l.date)}${isWeekendNight(l.date)?' 주말':''}</span><span>${won(l.price)}원</span></div>`).join('')}
        ${q.list?`<div class="disc"><span>할인 적용</span><span>-${won(q.list-q.total)}원</span></div>`:''}
        <div class="disc"><span>포인트 사용</span><span id="ptLine">-0원</span></div>
        <div class="tot"><span>총 결제 금액</span><b id="dueLine">${won(q.total)}원</b></div></div>
      <p class="note" style="margin-top:8px">이용 완료 후 결제금액의 ${pol.earnRate}%가 포인트로 적립됩니다.</p>
      <label class="agree"><input type="checkbox" name="agree" id="bkAgree" required>취소·환불 규정과 개인정보(예약자 이름, 휴대폰 번호) 숙소 제공에 동의합니다.</label>
      <details style="margin-top:8px;font-size:13px;color:var(--ink2)"><summary>취소·환불 규정 보기</summary><p style="white-space:pre-wrap;line-height:1.7">${esc(st.cancelPolicy)}</p></details>
      <div class="cta" style="margin:16px calc(-1 * var(--gr)) 0 calc(-1 * var(--gl))"><div class="l"><small>${nightsOf(cond.in,cond.out)}박 · ${guestText()}</small><b class="tnum" id="dueCta">${won(q.total)}원</b></div><button class="btn" type="submit" id="bkSubmit" ${q.soldOut?'disabled':''}>결제하기</button></div>
    </form>
  </section>`;
};
function bookUpdate(){
  const f = $('form[data-f="book"]'); if (!f) return;
  const r = RM[f.dataset.r], q = roomQuote(r);
  const pts = Math.max(0, +f.points.value || 0), due = Math.max(0, q.total - pts);
  $('#ptLine').textContent = `-${won(pts)}원`; $('#dueLine').textContent = `${won(due)}원`; $('#dueCta').textContent = `${won(due)}원`;
  const m = (f.querySelector('input[name=pay]:checked')||{}).value;
  const st = set();
  $('#payNote').textContent = due===0 ? '포인트로 전액 결제합니다.' : m==='card' ? '결제창에서 카드나 간편결제로 결제합니다.' : m==='bank' ? `예약 후 안내되는 계좌로 ${st.bankDeadlineHours?st.bankDeadlineHours+'시간 이내 ':''}입금하면 확정됩니다.` : m==='site' ? '숙소에 도착해서 결제합니다. 예약은 바로 확정됩니다.' : '';
  $('#bkSubmit').textContent = due===0 ? '포인트로 예약하기' : m==='card' ? `${won(due)}원 결제하기` : '예약하기';
}

V.mockpay = ({pay, code}) => `<section class="screen nonav">${top('테스트 결제',{back:false})}
  <div class="mockpay">
    <div class="testpay">테스트 결제 화면입니다. 실제 돈은 결제되지 않습니다. PG사를 연동하면 이 화면 대신 실제 결제창이 열립니다.</div>
    <div class="card"><small>TEST CARD</small><b>0000 •••• •••• 0000</b></div>
    <div class="sum"><div class="pn">${esc(pay.orderName)}</div><dl class="tnum"><dt>주문번호</dt><dd>${esc(pay.orderId)}</dd><dt>결제 금액</dt><dd><b>${won(pay.amount)}원</b></dd></dl></div>
    <div style="display:flex;gap:8px;margin-top:20px"><button class="btn ghost" style="flex:1" data-a="mockFail">결제 취소</button><button class="btn" style="flex:2" data-a="mockOk">${won(pay.amount)}원 결제 승인</button></div>
  </div></section>`;

V.done = ({code}) => {
  const b = (myBookings||[]).find(x=>x.code===code); const st = set();
  return `<section class="screen nonav">
    <div class="done"><div class="ok">${I.check}</div>
      <h2>${b && b.status==='wait' ? '예약 요청이 접수되었어요' : '예약이 확정되었어요'}</h2>
      <p>예약번호 <b class="tnum" style="color:var(--ink)">${esc(code)}</b></p>
      ${b?`<div class="sum" style="text-align:left;margin-top:20px"><div class="pn">${esc(b.place_name)}</div><div class="rn">${esc(b.room_name)}</div><dl class="tnum"><dt>일정</dt><dd>${fmtS(b.check_in)} ~ ${fmtS(b.check_out)}</dd><dt>결제</dt><dd>${PAY[b.pay_method]} · ${won(b.amount_due)}원</dd>${b.points_used?`<dt>포인트</dt><dd>${won(b.points_used)}P 사용</dd>`:''}</dl></div>`:''}
      ${b&&b.status==='wait'?`<div class="bank"><b>입금 안내</b>${st.bank?esc(st.bank):'입금 계좌는 고객센터로 문의해 주세요.'}\n입금액: ${won(b.amount_due)}원\n${esc(st.payDeadline)}${st.bank?`<br><button class="copy" data-a="copy" data-v="${esc(st.bank)}">계좌 복사</button>`:''}</div>`:''}
      ${b&&b.pay_method==='site'?`<p style="margin-top:18px">결제는 숙소에 도착해서 진행해 주세요.</p>`:''}
      <div style="display:flex;gap:8px;margin-top:26px"><button class="btn ghost" style="flex:1" data-a="tab" data-v="home">홈으로</button><button class="btn" style="flex:1" data-a="tab" data-v="trips">예약내역 보기</button></div>
    </div></section>`;
};

function bookingRow(b){
  return `<button class="bk" data-a="trip" data-v="${esc(b.code)}">
    <div class="h">${stTag(b.status)}<span class="code tnum">${esc(b.code)}</span></div>
    <div class="pn">${esc(b.place_name)}</div><div class="rn">${esc(b.room_name)}</div>
    <div class="dt tnum">${fmtS(b.check_in)} ~ ${fmtS(b.check_out)} · ${b.nights}박 · ${b.adults+b.children}명</div>
    <div class="meta"><span>${PAY[b.pay_method]}${b.status==='done'&&!b.reviewed?' · <b style="color:var(--brand)">후기 쓰고 포인트 받기</b>':''}</span><span class="tnum"><b>${won(b.amount_due)}원</b></span></div>
  </button>`;
}
V.trips = () => {
  if (!me) return `<section class="screen">${top('예약내역',{back:false})}<div class="empty"><b>로그인하고 예약내역을 확인하세요</b><button class="btn" data-a="login">로그인</button></div></section>${nav()}`;
  if (!myBookings) { loadMyBookings(); return `<section class="screen">${top('예약내역',{back:false})}<div class="empty">불러오는 중…</div></section>${nav()}`; }
  const up = myBookings.filter(b=>['pending','wait','ok'].includes(b.status)), past = myBookings.filter(b=>!['pending','wait','ok'].includes(b.status));
  return `<section class="screen">${top('예약내역',{back:false})}
    ${myBookings.length ? `${up.length?`<div class="count"><b>다가오는 예약</b></div>${up.map(bookingRow).join('')}`:''}${past.length?`<div class="count"><b>지난 예약</b></div>${past.map(bookingRow).join('')}`:''}`
      : `<div class="empty"><b>예약내역이 없어요</b>마음에 드는 숙소를 찾아보세요.<br><button class="btn" data-a="tab" data-v="home">숙소 둘러보기</button></div>`}
  </section>${nav()}`;
};
async function loadMyBookings(){ try { myBookings = await api('GET','/api/me/bookings'); } catch { myBookings = []; } render(true); }

V.trip = ({code}) => {
  const b = V.trip.data && V.trip.data.code===code ? V.trip.data : null;
  if (!b) { api('GET', `/api/me/bookings/${encodeURIComponent(code)}`).then(x => { V.trip.data = x; render(true); }).catch(e => { toast(e.message); }); return `<section class="screen nonav">${top('예약 상세')}<div class="empty">불러오는 중…</div></section>`; }
  const st = set(), p = PL[b.place_id] || {};
  const canCancel = ['pending','wait','ok'].includes(b.status) && b.check_in > today();
  const paid = (b.payments||[]).find(x=>['paid','partial_cancelled','cancelled','refund_pending','kept'].includes(x.status) && x.method==='card');
  return `<section class="screen nonav">${top('예약 상세')}
    <div class="form">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">${stTag(b.status)}<span class="note tnum">예약번호 ${esc(b.code)}</span></div>
      <div class="sum"><div class="pn">${esc(b.place_name)}</div><div class="rn">${esc(b.room_name)}</div>
        <dl class="tnum"><dt>체크인</dt><dd>${fmtL(b.check_in)} ${esc(p.check_in||'')}</dd><dt>체크아웃</dt><dd>${fmtL(b.check_out)} ${esc(p.check_out||'')}</dd><dt>인원</dt><dd>성인 ${b.adults}${b.children?`, 아동 ${b.children}`:''}</dd>
        <dt>예약자</dt><dd>${esc(b.guest_name)} · ${esc(b.phone)}</dd><dt>방문</dt><dd>${esc(b.visit)}</dd></dl>
        ${b.request?`<p class="note" style="margin:12px 0 0;white-space:pre-wrap;line-height:1.6">요청사항: ${esc(b.request)}</p>`:''}</div>
      <h3>결제 정보</h3>
      <div class="lines tnum"><div><span>객실 요금</span><span>${won(b.total)}원</span></div>${b.points_used?`<div class="disc"><span>포인트 사용</span><span>-${won(b.points_used)}P</span></div>`:''}
        <div class="tot"><span>${PAY[b.pay_method]}</span><b>${won(b.amount_due)}원</b></div>
        ${b.points_earned?`<div><span>적립 포인트</span><span style="color:var(--brand)">+${won(b.points_earned)}P</span></div>`:''}
        ${b.status==='cancel'?`<div><span>환불 금액</span><span>${won(b.refund_amount)}원${b.refund_points?` · ${won(b.refund_points)}P 반환`:''}</span></div>`:''}</div>
      ${paid && paid.receipt_url?`<a class="linkbtn" href="${esc(paid.receipt_url)}" target="_blank" rel="noopener" style="margin-top:8px">카드 영수증 보기</a>`:''}
      ${b.status==='wait'?`<div class="bank"><b>입금 안내</b>${esc(st.bank||'입금 계좌는 고객센터로 문의해 주세요.')}\n입금액: ${won(b.amount_due)}원\n${esc(st.payDeadline)}</div>`:''}
      ${b.status==='cancel'?`<p class="note" style="margin-top:12px">취소 사유: ${esc(b.cancel_reason||'-')} · ${fmtDT(b.updated_at)}${b.refund_amount&&b.pay_method==='bank'?'\n무통장 환불은 확인 후 계좌로 보내드립니다.':''}</p>`:''}
      ${p.phone?`<p class="note" style="margin-top:12px">숙소 연락처 <span style="user-select:all">${esc(p.phone)}</span></p>`:''}
      ${b.status==='done' && !b.review ? `<button class="btn full" style="margin-top:20px" data-a="review" data-v="${esc(b.code)}">후기 쓰고 ${won(st.points.reviewBonus)}P 받기</button>`:''}
      ${canCancel ? `<button class="btn danger full" style="margin-top:20px" data-a="myCancel" data-v="${esc(b.code)}">예약 취소</button>` : ''}
      ${PL[b.place_id]?`<button class="btn ghost full" style="margin-top:12px" data-a="place" data-v="${b.place_id}">숙소 보기</button>`:''}
    </div></section>`;
};

V.review = ({code}) => `<section class="screen nonav">${top('후기 작성')}
  <form class="form" data-f="review" data-code="${esc(code)}">
    <h3>만족도</h3>
    <div class="seg">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}" ${n===5?'checked':''}><span>${'★'.repeat(n)}</span></label>`).join('')}</div>
    <label class="fl" for="rvText">후기 (10자 이상)</label><textarea class="in" id="rvText" name="text" required minlength="10" maxlength="1000" style="min-height:180px" placeholder="숙소 이용 경험을 남겨주세요."></textarea>
    <p class="note">이름은 첫 글자만 보이고 나머지는 *로 가려집니다.</p>
    <button class="btn full" type="submit" style="margin-top:18px">등록하고 ${won(set().points.reviewBonus)}P 받기</button>
  </form></section>`;

V.wish = () => {
  if (!me) return `<section class="screen">${top('찜',{back:false})}<div class="empty"><b>로그인하고 찜한 숙소를 모아보세요</b><button class="btn" data-a="login">로그인</button></div></section>${nav()}`;
  const ps = D.wish.map(id => PL[id]).filter(Boolean);
  return `<section class="screen">${top('찜',{back:false})}
    ${ps.length ? ps.map(placeCard).join('') : `<div class="empty"><b>찜한 숙소가 없어요</b>하트를 눌러 마음에 드는 숙소를 모아보세요.</div>`}
  </section>${nav()}`;
};

/* ----- 회원 ----- */
function socialButtons(){
  const L = D.login, nxt = encodeURIComponent((V.login.next)||'/');
  if (!L.google && !L.kakao) return '';
  return `<div class="social">${L.kakao?`<a class="sbtn kakao" href="/auth/kakao/start?next=${nxt}">${I.kakao}카카오로 시작하기</a>`:''}${L.google?`<a class="sbtn google" href="/auth/google/start?next=${nxt}">${I.google}Google로 시작하기</a>`:''}</div><div class="or">또는 이메일로</div>`;
}
V.login = () => `<section class="screen nonav">${top('로그인')}
  <form class="auth" data-f="login">
    <div class="logo"><i>${I.bolt}</i>${esc(set().brand)}</div>
    ${socialButtons()}
    <label class="fl" for="lgEmail">이메일</label><input class="in" id="lgEmail" name="email" type="email" autocomplete="email" required>
    <label class="fl" for="lgPw">비밀번호</label><input class="in" id="lgPw" name="password" type="password" autocomplete="current-password" required>
    <div class="err" id="lgErr" role="alert"></div>
    <button class="btn full" type="submit">로그인</button>
    <p class="swap">아직 회원이 아니신가요? <button type="button" data-a="signup">회원가입</button></p>
    <p class="note" style="text-align:center">비밀번호를 잊으셨다면 고객센터${set().phone?` (${esc(set().phone)})`:''}로 문의해 주세요.</p>
  </form></section>`;

const termsBlock = () => `<div class="terms" id="termsBox">
  <label class="all"><input type="checkbox" id="agAll"><span>전체 동의</span></label>
  <label><input type="checkbox" name="agreeTerms" required><span>[필수] 이용약관 동의</span><button type="button" class="view" data-a="terms" data-v="service">보기</button></label>
  <label><input type="checkbox" name="agreePrivacy" required><span>[필수] 개인정보 수집·이용 동의</span><button type="button" class="view" data-a="terms" data-v="privacy">보기</button></label>
  <label><input type="checkbox" name="agreeAge" required><span>[필수] 만 14세 이상입니다</span></label>
  <label><input type="checkbox" name="marketing"><span>[선택] 혜택·이벤트 알림 받기</span></label>
</div>`;
V.signup = () => `<section class="screen nonav">${top('회원가입')}
  <form class="auth" data-f="signup">
    <h2>${set().points.signupBonus?`가입하면 ${won(set().points.signupBonus)}P를 드려요`:'회원가입'}</h2>
    <p class="sub">숙박을 마치면 결제금액의 ${set().points.earnRate}%가 적립됩니다.</p>
    ${socialButtons()}
    <label class="fl" for="suEmail">이메일</label><input class="in" id="suEmail" name="email" type="email" autocomplete="email" required>
    <label class="fl" for="suPw">비밀번호 (영문·숫자 포함 8자 이상)</label><input class="in" id="suPw" name="password" type="password" autocomplete="new-password" required minlength="8">
    <label class="fl" for="suName">이름</label><input class="in" id="suName" name="name" autocomplete="name" required maxlength="30">
    <label class="fl" for="suPhone">휴대폰 번호</label><input class="in" id="suPhone" name="phone" inputmode="tel" autocomplete="tel" required placeholder="010-0000-0000">
    ${termsBlock()}
    <div class="err" id="suErr" role="alert"></div>
    <button class="btn full" type="submit">가입하기</button>
    <p class="swap">이미 회원이신가요? <button type="button" data-a="login">로그인</button></p>
  </form></section>`;
V.complete = () => `<section class="screen nonav">${top('가입 완료하기',{back:false})}
  <form class="auth" data-f="complete">
    <h2>거의 다 됐어요</h2>
    <p class="sub">예약 안내를 받을 휴대폰 번호와 약관 동의만 확인할게요.</p>
    <label class="fl" for="cpName">이름</label><input class="in" id="cpName" name="name" value="${esc(me && me.name)}" required maxlength="30">
    <label class="fl" for="cpPhone">휴대폰 번호</label><input class="in" id="cpPhone" name="phone" inputmode="tel" required placeholder="010-0000-0000">
    ${termsBlock()}
    <div class="err" id="cpErr" role="alert"></div>
    <button class="btn full" type="submit">가입 완료${set().points.signupBonus?` · ${won(set().points.signupBonus)}P 받기`:''}</button>
    <button class="btn ghost full" type="button" data-a="logout" style="margin-top:8px">나중에 하기 (로그아웃)</button>
  </form></section>`;
V.terms = ({kind}) => {
  if (!V.terms.cache || V.terms.cache.kind!==kind) { api('GET','/api/terms/'+kind).then(r=>{ V.terms.cache={kind, text:r.text}; render(true); }); return `<section class="screen nonav">${top(kind==='privacy'?'개인정보처리방침':'이용약관')}<div class="empty">불러오는 중…</div></section>`; }
  return `<section class="screen nonav">${top(kind==='privacy'?'개인정보처리방침':'이용약관')}<div class="termtext">${esc(V.terms.cache.text)}</div></section>`;
};

V.my = () => {
  if (!me) return V.login();
  const via = me.providers.length ? me.providers.map(p=>p==='kakao'?'카카오':'Google').join(', ') + ' 로그인' : '이메일 로그인';
  return `<section class="screen">${top('마이',{back:false})}
    <div class="mycard"><div class="nm">${esc(me.name)}님</div><div class="em">${esc(me.email||'')} · ${via}</div>
      <button class="pt" data-a="points"><span>보유 포인트</span><b class="tnum">${won(me.points)}P</b></button></div>
    <div class="menu2">
      <button data-a="tab" data-v="trips"><span>예약내역</span>${I.chev.replace('<svg','<svg style="width:16px;height:16px;color:var(--ink3)"')}</button>
      <button data-a="points"><span>포인트 내역</span><small class="tnum">${won(me.points)}P</small></button>
      <button data-a="tab" data-v="wish"><span>찜한 숙소</span><small>${D.wish.length}</small></button>
      <button data-a="profile"><span>내 정보 수정</span>${I.chev.replace('<svg','<svg style="width:16px;height:16px;color:var(--ink3)"')}</button>
      ${me.email?`<button data-a="password"><span>${me.hasPassword?'비밀번호 변경':'비밀번호 만들기'}</span>${I.chev.replace('<svg','<svg style="width:16px;height:16px;color:var(--ink3)"')}</button>`:''}
      ${me.role==='admin'?`<button data-a="admin"><span><b>관리자 콘솔</b></span>${I.chev.replace('<svg','<svg style="width:16px;height:16px;color:var(--ink3)"')}</button>`:''}
      <button data-a="terms" data-v="service"><span>이용약관</span></button>
      <button data-a="terms" data-v="privacy"><span>개인정보처리방침</span></button>
      <button data-a="logout"><span>로그아웃</span></button>
      <button data-a="withdraw"><span style="color:var(--ink3)">회원 탈퇴</span></button>
    </div>
    ${footer()}
  </section>${nav()}`;
};
V.points = () => {
  const d = V.points.data;
  if (!d) { api('GET','/api/me/points').then(x=>{ V.points.data=x; me.points=x.balance; render(true); }).catch(e=>toast(e.message)); return `<section class="screen nonav">${top('포인트')}<div class="empty">불러오는 중…</div></section>`; }
  const pol = set().points;
  return `<section class="screen nonav">${top('포인트')}
    <div class="ptsum tnum"><div><small>사용 가능</small><b>${won(d.balance)}P</b></div><div><small>30일 안에 소멸 예정</small><b>${won(d.expiringSoon)}P</b></div></div>
    <p class="note pad" style="line-height:1.7">숙박 완료 시 결제금액의 ${pol.earnRate}% 적립 · 후기 작성 ${won(pol.reviewBonus)}P · ${won(pol.minUse)}P부터 사용 · 적립 후 ${pol.expireDays}일 뒤 소멸</p>
    ${d.list.length ? d.list.map(x=>`<div class="ptl"><div><b>${esc(PKIND[x.kind]||x.kind)}</b> <span class="note">${esc(x.memo)}</span><small>${fmtDT(x.created_at)}${x.amount>0&&x.expires_at?` · ${fmtD(x.expires_at)} 소멸`:''}</small></div><b class="tnum ${x.amount>0?'plus':'minus'}">${x.amount>0?'+':''}${won(x.amount)}P</b></div>`).join('') : `<div class="empty">포인트 내역이 없습니다.</div>`}
  </section>`;
};
V.profile = () => `<section class="screen nonav">${top('내 정보 수정')}
  <form class="form" data-f="profile">
    <label class="fl">이메일</label><input class="in" value="${esc(me.email||'(없음)')}" disabled>
    <label class="fl" for="pfName">이름</label><input class="in" id="pfName" name="name" value="${esc(me.name)}" required maxlength="30">
    <label class="fl" for="pfPhone">휴대폰 번호</label><input class="in" id="pfPhone" name="phone" value="${esc(me.phone)}" required inputmode="tel">
    <label class="agree"><input type="checkbox" name="marketing" ${me.marketing?'checked':''}>혜택·이벤트 알림 받기</label>
    <button class="btn full" type="submit" style="margin-top:18px">저장</button>
  </form></section>`;
V.password = () => `<section class="screen nonav">${top(me.hasPassword?'비밀번호 변경':'비밀번호 만들기')}
  <form class="form" data-f="password">
    ${me.hasPassword?`<label class="fl" for="pwCur">현재 비밀번호</label><input class="in" id="pwCur" name="current" type="password" autocomplete="current-password" required>`:`<p class="note" style="line-height:1.6;margin-top:12px">비밀번호를 만들면 ${esc(me.email)} 로도 로그인할 수 있습니다.</p>`}
    <label class="fl" for="pwNew">새 비밀번호 (영문·숫자 포함 8자 이상)</label><input class="in" id="pwNew" name="next" type="password" autocomplete="new-password" required minlength="8">
    <button class="btn full" type="submit" style="margin-top:18px">저장</button>
  </form></section>`;
V.withdraw = () => `<section class="screen nonav">${top('회원 탈퇴')}
  <form class="form" data-f="withdraw">
    <div class="bank" style="background:var(--warn-soft);color:var(--ink)"><b>탈퇴 전에 확인해 주세요</b>보유 포인트 ${won(me.points)}P는 모두 사라지고 되돌릴 수 없습니다.\n진행 중인 예약이 있으면 탈퇴할 수 없습니다.\n거래 기록은 전자상거래법에 따라 5년간 보관됩니다.</div>
    ${me.hasPassword?`<label class="fl" for="wdPw">비밀번호 확인</label><input class="in" id="wdPw" name="password" type="password" required>`:''}
    <label class="agree"><input type="checkbox" required>위 내용을 확인했고 탈퇴합니다.</label>
    <button class="btn danger full" type="submit" style="margin-top:18px">회원 탈퇴</button>
  </form></section>`;

function gone(){ return `<section class="screen nonav">${top('')}<div class="empty"><b>찾을 수 없어요</b>삭제되었거나 판매가 끝난 항목입니다.</div></section>`; }

/* ===== 렌더 ===== */
const FORMS = ['book','review','signup','login','complete','profile','password','withdraw'];
let adminMode = false;
function render(fromData){
  if (adminMode) return;
  document.body.classList.remove('wide');
  const c = stack[stack.length-1];
  const name = c ? c.name : tab;
  if (fromData && (dirty || (c && FORMS.includes(c.name)))) return;
  const y = window.scrollY;
  $('#app').innerHTML = V[name](c ? c.p : {});
  if (fromData) window.scrollTo(0,y);
  const tr = $('#galTrack');
  if (tr) tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); const n = tr.children.length; $('#galCnt').textContent = `${Math.min(n,i+1)}/${n}`; }, {passive:true});
  const at = $('#adTrack');
  if (at) at.addEventListener('scroll', () => { const i = Math.round(at.scrollLeft / at.clientWidth), el = at.children[i]; if (el) markImp(+el.dataset.ad); const cn=$('#adCnt'); if (cn) cn.textContent = `${i+1}/${at.children.length}`; }, {passive:true});
  if (name==='book') bookUpdate();
}
const go = (name, p={}) => { stack.push({name,p}); dirty=false; render(); window.scrollTo(0,0); };
const back = () => { stack.pop(); dirty=false; render(); window.scrollTo(0,0); };
function needLogin(next){
  if (!me) { V.login.next = next || location.pathname; go('login'); return true; }
  if (!me.profileDone) { go('complete'); return true; }
  return false;
}

/* ===== 바텀시트 ===== */
function sheet(html, onMount){
  const d = document.createElement('div'); d.className='dim';
  d.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.addEventListener('click', e => { if (e.target===d || e.target.closest('[data-x="close"]')) close(); });
  onMount && onMount(d, close);
  return close;
}
function condSheet(){
  let a = cond.in, b = cond.out, ad = cond.adults, ch = cond.children;
  const draw = d => {
    const sb = $('.sb', d), t = today(), base = pd(t); base.setDate(1);
    let html = `<div class="cnt3"><div>성인<small>만 13세 이상</small></div><div class="step"><button type="button" data-s="a-" ${ad<=1?'disabled':''} aria-label="성인 빼기">−</button><b>${ad}</b><button type="button" data-s="a+" ${ad>=20?'disabled':''} aria-label="성인 더하기">+</button></div></div>
      <div class="cnt3"><div>아동<small>만 12세 이하</small></div><div class="step"><button type="button" data-s="c-" ${ch<=0?'disabled':''} aria-label="아동 빼기">−</button><b>${ch}</b><button type="button" data-s="c+" ${ch>=10?'disabled':''} aria-label="아동 더하기">+</button></div></div>
      <div class="cal"><div class="wk" style="margin-top:14px">${WD.map(w=>`<span>${w}</span>`).join('')}</div>`;
    for (let m=0; m<6; m++){
      const first = new Date(base.getFullYear(), base.getMonth()+m, 1), days = new Date(first.getFullYear(), first.getMonth()+1, 0).getDate();
      let cells = ''; for (let i=0;i<first.getDay();i++) cells += '<span></span>';
      for (let dd=1; dd<=days; dd++){
        const dt = new Date(first.getFullYear(), first.getMonth(), dd), s = ds(dt);
        const cls = [s===a?'s':'', s===b?'e':'', a&&b&&s>a&&s<b?'in':'', s===t?'today':'', dt.getDay()===0?'sun':''].join(' ');
        cells += `<button type="button" data-d="${s}" class="${cls}" ${s<t?'disabled':''} aria-label="${fmtL(s)}">${dd}</button>`;
      }
      html += `<div class="mo">${first.getFullYear()}년 ${first.getMonth()+1}월</div><div class="days">${cells}</div>`;
    }
    sb.innerHTML = html + '</div>';
    const ok = $('#condOk', d); ok.disabled = !(a && b);
    ok.textContent = a && b ? `${fmtS(a)} ~ ${fmtS(b)} · ${nightsOf(a,b)}박 적용` : '체크아웃 날짜를 선택하세요';
  };
  sheet(`<div class="sh"><h2>날짜, 인원 선택</h2><button class="ib" data-x="close" aria-label="닫기">${I.close}</button></div><div class="sb"></div><div class="sf"><button class="btn full tnum" id="condOk">적용</button></div>`, (d, close) => {
    draw(d);
    d.addEventListener('click', e => {
      const day = e.target.closest('[data-d]');
      if (day) { const s = day.dataset.d;
        if (!a || b || s <= a) { a = s; b = null; } else if (nightsOf(a,s) > 14) { toast('최대 14박까지 선택할 수 있어요.'); return; } else b = s;
        const sc = $('.sb',d).scrollTop; draw(d); $('.sb',d).scrollTop = sc; return; }
      const st = e.target.closest('[data-s]');
      if (st) { const k = st.dataset.s; if (k==='a-') ad--; if (k==='a+') ad++; if (k==='c-') ch--; if (k==='c+') ch++; const sc=$('.sb',d).scrollTop; draw(d); $('.sb',d).scrollTop=sc; return; }
      if (e.target.id==='condOk' && a && b) { Object.assign(cond, {in:a, out:b, adults:ad, children:ch}); saveCond(); close(); render(); }
    });
  });
}
function sortSheet(){
  sheet(`<div class="sh"><h2>정렬</h2><button class="ib" data-x="close" aria-label="닫기">${I.close}</button></div><div class="sb sorts">${SORTS.map(([k,l])=>`<button class="${filt.sort===k?'on':''}" data-sort="${k}">${l}${filt.sort===k?I.check:''}</button>`).join('')}</div>`, (d, close) => {
    d.addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if (b) { filt.sort = b.dataset.sort; close(); render(); } });
  });
}
function filterSheet(){
  sheet(`<div class="sh"><h2>필터</h2><button class="ib" data-x="close" aria-label="닫기">${I.close}</button></div>
    <form class="sb" id="fForm">
      <div class="fh">숙소 유형</div><div class="checks">${TYPES.map(t=>`<label><input type="checkbox" name="types" value="${esc(t)}" ${filt.types.includes(t)?'checked':''}><span>${esc(t)}</span></label>`).join('')}</div>
      <div class="fh">가격 <span class="note" style="font-weight:400">1박 기준, 만원</span></div>
      <div class="prng"><input class="in tnum" name="min" type="number" min="0" placeholder="최소" value="${esc(filt.min)}" aria-label="최소 가격(만원)"><span>~</span><input class="in tnum" name="max" type="number" min="0" placeholder="최대" value="${esc(filt.max)}" aria-label="최대 가격(만원)"></div>
      <div class="fh">편의시설</div><div class="checks">${AMEN.map(t=>`<label><input type="checkbox" name="amen" value="${esc(t)}" ${filt.amen.includes(t)?'checked':''}><span>${esc(t)}</span></label>`).join('')}</div>
      <div style="height:12px"></div>
    </form>
    <div class="sf"><button class="btn ghost" id="fReset">초기화</button><button class="btn" id="fApply">필터 적용하기</button></div>`, (d, close) => {
    d.addEventListener('click', e => {
      if (e.target.id==='fReset') $('#fForm',d).querySelectorAll('input').forEach(i=>{ if(i.type==='checkbox') i.checked=false; else i.value=''; });
      if (e.target.id==='fApply') { const fd = new FormData($('#fForm',d)); filt.types = fd.getAll('types'); filt.amen = fd.getAll('amen'); filt.min = fd.get('min')||''; filt.max = fd.get('max')||''; close(); render(); }
    });
  });
}

/* ===== 결제 진행 ===== */
async function startCardPayment(pay, code){
  if (pay.provider === 'mock') return go('mockpay', {pay, code});
  if (pay.provider === 'toss') {
    try {
      await loadScript('https://js.tosspayments.com/v2/standard');
      const tp = window.TossPayments(pay.clientKey);
      const payment = tp.payment({customerKey: pay.customerKey});
      lsSet('so_pending', {orderId: pay.orderId, code});
      await payment.requestPayment({method:'CARD', amount:{currency:'KRW', value: pay.amount}, orderId: pay.orderId, orderName: pay.orderName,
        successUrl: location.origin + '/pay/success', failUrl: location.origin + '/pay/fail', customerName: pay.customerName, customerEmail: pay.customerEmail,
        card: {useEscrow:false, flowMode:'DEFAULT', useCardPoint:false, useAppCardOnly:false}});
    } catch (e) {
      await api('POST','/api/payments/fail', {orderId: pay.orderId, message: e && e.message}).catch(()=>{});
      toast(e && e.code==='USER_CANCEL' ? '결제를 취소했습니다.' : '결제창을 열지 못했습니다. ' + ((e && e.message) || ''));
      await load(); stack=[]; tab='home'; render();
    }
    return;
  }
  toast('지원하지 않는 결제 방식입니다.');
}
function loadScript(src){ return new Promise((res, rej) => { if ([...document.scripts].some(s=>s.src===src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('결제 모듈을 불러오지 못했습니다.')); document.head.appendChild(s); }); }
async function finishPayment(orderId, paymentKey, amount){
  try {
    const r = await api('POST','/api/payments/confirm', {orderId, paymentKey, amount: +amount});
    await load(); myBookings = null; await loadMyBookingsQuiet();
    stack = [{name:'done', p:{code: r.booking.code}}]; render();
  } catch (e) {
    await load(); stack=[]; tab='trips'; myBookings=null; render();
    toast(e.message);
  }
}
async function loadMyBookingsQuiet(){ try { myBookings = await api('GET','/api/me/bookings'); } catch { myBookings = []; } }

/* ===== 이벤트 ===== */
document.addEventListener('input', e => {
  if (e.target.closest('form[data-f="book"]')) { bookUpdate(); return; }
  if (e.target.closest('form[data-f]') && !e.target.closest('form[data-f="kw"]')) dirty = true;
});
document.addEventListener('change', e => {
  if (e.target.closest('form[data-f="book"]')) bookUpdate();
  if (e.target.id === 'agAll') $('#termsBox').querySelectorAll('input[type=checkbox]').forEach(i => i.checked = e.target.checked);
  else if (e.target.closest('#termsBox')) { const all = [...$('#termsBox').querySelectorAll('input[type=checkbox]:not(#agAll)')]; $('#agAll').checked = all.every(i=>i.checked); }
});
document.addEventListener('click', async e => {
  if (adminMode) return;
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, v = t.dataset.v, c = stack[stack.length-1];
  if (a==='back') { if (dirty && !(await confirmBox('나가기','입력한 내용이 사라집니다. 나가시겠습니까?','나가기'))) return; return back(); }
  if (a==='tab') { stack=[]; tab=v; dirty=false; if (v==='trips') myBookings=null; if (v==='my' && me) refreshMe().then(()=>render(true)); render(); window.scrollTo(0,0); return; }
  if (a==='condSheet') return condSheet();
  if (a==='sortSheet') return sortSheet();
  if (a==='filterSheet') return filterSheet();
  if (a==='search') { cond.sido=''; cond.area=''; cond.keyword=($('#kwHome')||{}).value||''; saveCond(); return go('list'); }
  if (a==='type') { cond.sido=''; cond.area=''; cond.keyword=''; filt.types=[v]; return go('list'); }
  if (a==='all') { cond.sido=''; cond.area=''; cond.keyword=''; filt.types=[]; return go('list'); }
  if (a==='sido') { V.region.sido = v; return render(); }
  if (a==='area') { cond.sido = t.dataset.s; cond.area = v; cond.keyword=''; saveCond(); recent = [{sido:cond.sido, area:v}, ...recent.filter(r=>!(r.sido===cond.sido && r.area===v))].slice(0,6); lsSet('so_recent', recent); filt.types=[]; return go('list'); }
  if (a==='quick') { filt.quick = filt.quick.includes(v) ? filt.quick.filter(x=>x!==v) : [...filt.quick, v]; return render(); }
  if (a==='resetFilter') { filt = {types:[], min:'', max:'', amen:[], quick:[], sort:filt.sort}; return render(); }
  if (a==='wish') {
    e.stopPropagation(); if (needLogin()) return;
    try { const r = await api('POST', '/api/me/wish/'+v); const id = +v; D.wish = r.on ? [id, ...D.wish] : D.wish.filter(x=>x!==id); toast(r.on?'찜 목록에 담았어요.':'찜 목록에서 뺐어요.'); render(); } catch (er) { toast(er.message); }
    return;
  }
  if (a==='place') return go('place',{id:+v});
  if (a==='toRooms') { const r = $('#rooms'); if (r) window.scrollTo({top: r.offsetTop - 10, behavior:'smooth'}); return; }
  if (a==='copy') return copyText(v);
  if (a==='book') { if (needLogin()) return; await refreshMe(); return go('book',{rid:+v}); }
  if (a==='allPts') { const f = $('form[data-f="book"]'); f.points.value = v; bookUpdate(); return; }
  if (a==='mockOk') { const p = c.p.pay; t.disabled = true; return finishPayment(p.orderId, 'mock_' + Date.now(), p.amount); }
  if (a==='mockFail') { await api('POST','/api/payments/fail', {orderId: c.p.pay.orderId, message:'사용자 취소'}).catch(()=>{}); await load(); toast('결제를 취소했습니다. 객실 예약도 취소되었어요.'); stack=[]; tab='home'; return render(); }
  if (a==='trip') { V.trip.data = null; return go('trip',{code:v}); }
  if (a==='review') return go('review',{code:v});
  if (a==='delReview') { if (await confirmBox('후기 삭제','이 후기를 삭제할까요? 받은 포인트는 회수되지 않습니다.','삭제',true)) { try { await api('DELETE','/api/reviews/'+v); delete reviewCache[t.dataset.p]; await load(); render(); toast('삭제했습니다.'); } catch(er){ toast(er.message); } } return; }
  if (a==='myCancel') {
    let pv; try { pv = await api('GET', `/api/me/bookings/${encodeURIComponent(v)}/cancel-preview`); } catch (er) { return toast(er.message); }
    const msg = pv.paid ? `지금 취소하면 결제금액 ${won(pv.paid)}원 중 ${won(pv.refundCash)}원(${pv.rate}%)이 환불됩니다.${pv.manual?' 무통장 결제는 확인 후 계좌로 환불됩니다.':''}` : '아직 결제 전이라 바로 취소됩니다.';
    if (!(await confirmBox('예약 취소', msg + (pv.refundPoints?`\n사용한 포인트 중 ${won(pv.refundPoints)}P를 돌려드립니다.`:''), '예약 취소', true))) return;
    try { V.trip.data = await api('POST', `/api/me/bookings/${encodeURIComponent(v)}/cancel`, {}); await load(); myBookings = null; render(); toast('예약을 취소했습니다.'); } catch (er) { toast(er.message); }
    return;
  }
  if (a==='login') { V.login.next = location.pathname; return go('login'); }
  if (a==='signup') { if (c && c.name==='login') stack.pop(); return go('signup'); }
  if (a==='logout') { await api('POST','/api/auth/logout').catch(()=>{}); await load(); myBookings=null; stack=[]; tab='home'; render(); toast('로그아웃했습니다.'); return; }
  if (a==='points') { V.points.data = null; return go('points'); }
  if (a==='profile') return go('profile');
  if (a==='password') return go('password');
  if (a==='withdraw') return go('withdraw');
  if (a==='terms') return go('terms',{kind:v});
  if (a==='admin') return openAdmin();
});

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-f]'); if (!f || adminMode) return;
  e.preventDefault();
  const k = f.dataset.f, fd = new FormData(f), body = Object.fromEntries(fd);
  const btn = f.querySelector('[type="submit"]');
  if (k==='kw') { cond.keyword = (fd.get('kw')||'').trim(); cond.sido=''; cond.area=''; saveCond(); filt.types=[]; return go('list'); }
  const errBox = f.querySelector('.err');
  if (errBox) errBox.textContent = '';
  if (btn) btn.disabled = true;
  try {
    if (k==='login') {
      const r = await api('POST','/api/auth/login', {email: body.email, password: body.password});
      await load(); dirty=false; stack.pop(); render(); toast(`${r.me.name}님 반가워요.`); return;
    }
    if (k==='signup' || k==='complete') {
      const payload = {...body, agreeTerms: fd.has('agreeTerms'), agreePrivacy: fd.has('agreePrivacy'), agreeAge: fd.has('agreeAge'), marketing: fd.has('marketing')};
      await api('POST', k==='signup' ? '/api/auth/signup' : '/api/me/complete', payload);
      await load(); dirty=false; stack = []; tab = 'home'; render();
      toast(set().points.signupBonus ? `가입을 환영해요. ${won(set().points.signupBonus)}P를 드렸어요.` : '가입을 환영해요.'); return;
    }
    if (k==='book') {
      const pay = (f.querySelector('input[name=pay]:checked')||{}).value;
      const r = await api('POST','/api/bookings', {roomId: +f.dataset.r, checkIn: cond.in, checkOut: cond.out, adults: cond.adults, children: cond.children,
        guestName: body.guestName, phone: body.phone, visit: body.visit, request: body.request, payMethod: pay, points: +body.points || 0});
      dirty = false; await refreshMe();
      if (r.payment) { stack.pop(); return startCardPayment(r.payment, r.booking.code); }
      await load(); await loadMyBookingsQuiet(); stack = [{name:'done', p:{code: r.booking.code}}]; render(); return;
    }
    if (k==='review') {
      const r = await api('POST','/api/reviews', {code: f.dataset.code, rating: +body.rating, text: body.text});
      await load(); await refreshMe(); for (const kk in reviewCache) delete reviewCache[kk]; V.trip.data = null; dirty=false; back(); toast(r.bonus?`후기를 등록했어요. ${won(r.bonus)}P 적립!`:'후기를 등록했어요.'); return;
    }
    if (k==='profile') { await api('PATCH','/api/me', {name: body.name, phone: body.phone, marketing: fd.has('marketing')}); await refreshMe(); dirty=false; back(); toast('저장했습니다.'); return; }
    if (k==='password') { await api('POST','/api/me/password', body); await refreshMe(); dirty=false; back(); toast('비밀번호를 저장했습니다.'); return; }
    if (k==='withdraw') { await api('POST','/api/me/withdraw', {password: body.password}); await load(); stack=[]; tab='home'; dirty=false; render(); toast('탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.'); return; }
  } catch (er) {
    if (er.code==='soldout') { await load(); }
    if (er.code==='login') { await load(); V.login.next = location.pathname; stack.push({name:'login', p:{}}); render(); return toast(er.message); }
    if (errBox) errBox.textContent = er.message; else toast(er.message);
  } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});

/* ===== 관리자 ===== */
async function openAdmin(){
  if (!me || me.role!=='admin') return toast('관리자만 들어갈 수 있습니다.');
  try { await loadScript('/admin.js?v=1'); } catch { return toast('관리자 화면을 불러오지 못했습니다.'); }
  adminMode = true; history.replaceState(null, '', '/admin');
  window.SOAdmin.mount($('#app'), { api, toast, confirmBox, esc, won, I, set: () => D.settings, exit: async () => { adminMode = false; history.replaceState(null,'','/'); await load(); stack=[]; tab='my'; render(); } });
}

/* ===== 시작 ===== */
(async function boot(){
  $('#app').innerHTML = `<section class="screen"><div class="empty">불러오는 중…</div></section>`;
  try { await load(); } catch { $('#app').innerHTML = `<section class="screen"><div class="empty"><b>서버에 연결하지 못했어요</b>잠시 후 새로고침해 주세요.</div></section>`; return; }
  const u = new URL(location.href), path = u.pathname;
  if (path === '/pay/success') { const o = u.searchParams.get('orderId'), k = u.searchParams.get('paymentKey'), amt = u.searchParams.get('amount'); history.replaceState(null,'','/'); $('#app').innerHTML = `<section class="screen nonav"><div class="empty"><b>결제를 확인하고 있어요</b>잠시만 기다려 주세요.</div></section>`; return finishPayment(o, k, amt); }
  if (path === '/pay/fail') { const o = u.searchParams.get('orderId'), m = u.searchParams.get('message'); history.replaceState(null,'','/'); if (o) await api('POST','/api/payments/fail', {orderId:o, message:m}).catch(()=>{}); await load(); render(); return toast(m ? `결제하지 못했습니다: ${m}` : '결제를 취소했습니다.'); }
  if (u.searchParams.get('login_error')) { toast(u.searchParams.get('login_error')); history.replaceState(null,'','/'); }
  if (me && !me.profileDone) { history.replaceState(null,'','/'); stack = [{name:'complete', p:{}}]; return render(); }
  if (path === '/admin' && me && me.role==='admin') return openAdmin();
  if (path !== '/') history.replaceState(null,'','/');
  render();
})();
})();
