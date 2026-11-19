// 이음챗 공용 로직 — 서버(Node)와 체험판(브라우저)이 같은 코드를 쓴다.
export const REGIONS = ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
export const AGES = ['20대', '30대', '40대', '50대 이상'];
export const CATS = ['자유', '고민', '유머', '동네'];
export const TOPICS = ['수다', '취미', '운동', '게임', '음악', '맛집', '여행', '동네'];
export const REPORT_REASONS = ['아동 안전 위협·미성년자', '욕설·비방', '음란·선정성', '광고·홍보', '사기·피싱 의심', '개인정보 요구', '기타'];
// 운영 설정 기본값 — 관리자 화면에서 바꿀 수 있다.
export const DEFAULT_CONFIG = {
  startPoints: 100, attend: 10, bonus3: 20, bonus7: 50, pinCost: 30, pinMin: 30, requestCost: 10,
  products: [
    // sku = Google Play Console 에 등록한 인앱 상품 ID 와 같아야 한다.
    { id: 'p1', sku: 'point_100', name: '라이트', points: 100, bonus: 0, price: 1100 },
    { id: 'p2', sku: 'point_500', name: '베이직', points: 500, bonus: 50, price: 5500 },
    { id: 'p3', sku: 'point_1000', name: '플러스', points: 1000, bonus: 150, price: 11000 },
    { id: 'p4', sku: 'point_3000', name: '프리미엄', points: 3000, bonus: 600, price: 33000 },
  ],
  banWords: [], notice: '',
  // 마케팅 보상
  inviteJoin: 50, // 초대 코드로 가입한 친구에게
  inviteReward: 100, // 초대한 사람에게(친구가 첫 출석하면)
  inviteMonthMax: 30, // 초대 보상 월 최대 인원
  inviteMilestone: 5, inviteMilestoneBonus: 200, // N명 달성할 때마다 추가 보너스
  firstBuyPct: 50, // 첫 충전 보너스(%)
  comebackDays: 14, comebackPoints: 30, // N일 이상 쉬다 돌아오면
  // 수익 상품
  boostCost: 50, boostMin: 30, // 프로필 부스트: 포인트, 지속 시간(분)
  vipSku: 'vip_monthly', vipPrice: 9900, vipPoints: 500, vipRequestPct: 50, vipFreeBoost: 1, // VIP 월 구독
  giftMin: 10, giftMax: 5000, giftDayMax: 20000, // 선물하기
  visitorCost: 30, visitorHours: 24, // 방문자 목록 열람(VIP 무료)
  pickCount: 3, pickHour: 19, // 오늘의 추천 친구: 인원, 알림 시각(한국 시간)

  // 수사 협조용 보관 기간(일). 관리자 화면에서 바꾸되 90일 아래로는 줄일 수 없다.
  keepLogsDays: 180, keepTrailDays: 180, keepReportsDays: 365,
};
const KEEP_MIN_DAYS = 90;
// 활동 기록에 남길 입력값(방 비밀번호처럼 수사와 무관한 값은 남기지 않는다)
const TRAIL_FIELDS = ['text', 'title', 'body', 'name', 'intro', 'topic', 'cat', 'to', 'id', 'mid', 'cid', 'uid', 'reason', 'memo', 'ref', 'pin', 'productId', 'code'];
const NO_TRAIL = new Set(['profile.view', 'conv.read', 'push.sub', 'push.unsub', 'notify.set', 'room.mute']);
// 알림 설정 기본값: push = 휴대폰 알림(앱이 닫혀 있을 때), 나머지는 종류별 켜기/끄기
// event = 이벤트·혜택(광고성) 알림: 법에 따라 본인이 켜야만 보낸다(기본 꺼짐)
export const DEFAULT_NOTIFY = { push: true, request: true, msg: true, room: true, comment: true, pick: true, event: false, preview: true, quiet: false, mutedRooms: [] };
const NOTIFY_KEYS = ['push', 'request', 'msg', 'room', 'comment', 'pick', 'event', 'preview', 'quiet'];
// 방해 금지: 한국 시간 밤 10시 ~ 오전 8시
const quietNow = () => { const h = new Date(Date.now() + 9 * 3600e3).getUTCHours(); return h >= 22 || h < 8; };

const INVITE_ENTER_DAYS = 7; // 가입 후 초대 코드를 등록할 수 있는 기간
const dayKey = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10); // 한국 시간 기준 날짜

export function createCore({ data, save = () => {}, hook = () => {}, adminPassword = '', verifyPurchase = null, verifySubscription = null, sendPush = null, pushKey = '' } = {}) {
  const busy = new Set(); // 검증 중인 결제 토큰
  const db = Object.assign({ users: {}, talks: [], convs: {}, rooms: {}, posts: [], reports: [], ledger: [], orders: [], logs: [], trail: [], holds: {}, disclosures: [], invites: [], coupons: [], notices: [], seq: 1 }, data || {});
  db.config = { ...DEFAULT_CONFIG, ...(db.config || {}) };
  const cfg = () => db.config;
  const admins = new Set(); // 관리자로 로그인한 연결
  const socks = new Map(); // uid -> Set(send)
  const visible = new Map(); // send -> 화면에 앱이 보이는지
  const nid = () => (db.seq++).toString(36) + Math.random().toString(36).slice(2, 5);
  const line = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const multi = (s, n) => String(s ?? '').trim().slice(0, n);
  const fail = (msg) => { throw new Error(msg); };

  const pub = (u) => ({
    id: u.id, nick: u.gone ? '(탈퇴한 회원)' : u.nick, gender: u.gender, age: u.age, region: u.region,
    intro: u.gone ? '' : u.intro, online: !u.gone && (socks.has(u.id) || !!u.bot), lastSeen: u.lastSeen, gone: !!u.gone,
    vip: isVip(u), boostUntil: u.boostUntil || 0,
  });
  const isVip = (u) => !!u && (u.vip?.until || 0) > Date.now();
  const sendTo = (uid, m) => { const s = socks.get(uid); if (s) for (const f of s) f(m); };
  const all = (m) => { for (const uid of socks.keys()) sendTo(uid, m); };

  const pushUsers = () => all({ t: 'users', users: Object.values(db.users).map(pub) });
  const pushMe = (uid) => {
    const u = db.users[uid]; if (!u) return;
    const { token, subs, couponFails, visitors, vip, ...me } = u;
    codeOf(u);
    const mine = db.invites.filter((x) => x.by === uid);
    const invite = {
      code: u.code, by: u.invitedBy ? nickOf(u.invitedBy) : '', canEnter: !u.invitedBy && Date.now() - u.at < INVITE_ENTER_DAYS * 86400e3,
      list: mine.slice(-50).reverse().map((x) => ({ id: x.id, nick: nickOf(x.uid), at: x.at, status: x.status, reward: x.reward || 0 })),
      count: mine.length, paid: mine.filter((x) => x.status === 'paid').length, earned: mine.reduce((n, x) => n + (x.reward || 0) + (x.bonus || 0), 0),
    };
    const now = Date.now(); const open = isVip(u) || (u.visitOpenUntil || 0) > now;
    const vs = (visitors || []).filter((v) => db.users[v.uid] && !db.users[v.uid].gone && !u.blocks.includes(v.uid));
    const visit = {
      today: vs.filter((v) => dayKey(v.at) === dayKey(now)).length, week: vs.filter((v) => now - v.at < 7 * 86400e3).length,
      open, openUntil: u.visitOpenUntil || 0, list: open ? vs.slice(0, 50) : [],
    };
    const vipInfo = { on: isVip(u), until: vip?.until || 0, freeBoostLeft: isVip(u) ? Math.max(0, cfg().vipFreeBoost - (vip?.boostDay === dayKey(now) ? vip.boostUsed || 0 : 0)) : 0 };
    sendTo(uid, { t: 'me', me: { notify: nf(u), pushOn: !!subs?.length, ...me, code: u.code, invite, visit, vipInfo, picks: u.picks?.day === dayKey(now) ? u.picks.ids.filter((id) => db.users[id] && !db.users[id].gone) : [], firstBuy: !db.orders.some((o) => o.uid === uid && o.status === 'paid'), ledger: db.ledger.filter((l) => l.uid === uid).slice(0, 50), orders: db.orders.filter((o) => o.uid === uid).slice(0, 20) } });
  };
  const pubConfig = () => { const { banWords, ...c } = cfg(); return c; };
  const pushConfig = () => all({ t: 'config', config: pubConfig() });
  // 포인트 증감은 반드시 이 함수로 — 내역(ledger)이 함께 남는다.
  const addPoints = (u, delta, reason) => {
    u.points += delta;
    db.ledger.unshift({ id: nid(), uid: u.id, delta, balance: u.points, reason, at: Date.now() });
    if (db.ledger.length > 5000) db.ledger.length = 5000;
  };
  const nickOf = (id) => db.users[id]?.nick || '(알 수 없음)';
  // 초대 코드: 헷갈리는 글자(0,O,1,I,L)를 뺀 6자리
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const codeOf = (u) => {
    if (u.code) return u.code;
    let c;
    do { c = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (Object.values(db.users).some((x) => x.code === c));
    u.code = c; return c;
  };
  const monthKey = (t) => dayKey(t).slice(0, 7);
  // 초대 코드 등록: 가입한 친구는 바로, 초대한 사람은 친구가 첫 출석하면 보상(가짜 계정 남용 방지)
  function applyInvite(u, raw, meta = {}) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (!code) return;
    if (u.invitedBy) fail('이미 초대 코드를 등록했습니다.');
    if (Date.now() - u.at > INVITE_ENTER_DAYS * 86400e3) fail(`초대 코드는 가입 후 ${INVITE_ENTER_DAYS}일 안에만 등록할 수 있습니다.`);
    const by = Object.values(db.users).find((x) => x.code === code);
    if (!by || by.gone || by.banned || by.bot) fail('초대 코드를 찾을 수 없습니다. 다시 확인해 주세요.');
    if (by.id === u.id) fail('내 초대 코드는 등록할 수 없습니다.');
    if (by.invitedBy === u.id) fail('내가 초대한 친구의 코드는 등록할 수 없습니다.');
    if (by.at > u.at) fail('나보다 늦게 가입한 친구의 코드는 등록할 수 없습니다.');
    u.invitedBy = by.id;
    // 초대한 사람과 같은 접속지(IP)에서 가입하면 초대한 사람 보상은 주지 않는다(혼자 여러 계정 만들기 방지)
    const sameIp = !!meta.ip && meta.ip !== '체험판' && db.logs.some((l) => l.uid === by.id && l.ip === meta.ip);
    db.invites.push({ id: nid(), by: by.id, uid: u.id, at: Date.now(), status: sameIp ? 'blocked' : 'pending', ip: line(meta.ip, 64) });
    if (cfg().inviteJoin > 0) addPoints(u, cfg().inviteJoin, `친구 초대 가입 보너스 (${by.nick} 님 초대)`);
    pushMe(u.id); pushMe(by.id);
    toast(u.id, cfg().inviteJoin > 0 ? `초대 코드가 등록되어 ${cfg().inviteJoin}P를 받았습니다.` : '초대 코드가 등록되었습니다.');
    if (!sameIp) toast(by.id, `${u.nick} 님이 내 초대로 가입했어요. 친구가 첫 출석하면 ${cfg().inviteReward}P를 드려요.`);
  }
  // 초대받은 친구가 첫 출석하면 초대한 사람에게 보상
  function settleInvite(u) {
    const inv = db.invites.find((x) => x.uid === u.id && x.status === 'pending');
    const by = inv && db.users[inv.by];
    if (!inv || !by || by.gone) return;
    const c = cfg(); const month = monthKey(Date.now());
    const paidMonth = db.invites.filter((x) => x.by === by.id && x.status === 'paid' && monthKey(x.paidAt) === month).length;
    if (c.inviteMonthMax > 0 && paidMonth >= c.inviteMonthMax) { inv.status = 'capped'; inv.paidAt = Date.now(); pushMe(by.id); return; }
    inv.status = 'paid'; inv.paidAt = Date.now(); inv.reward = c.inviteReward;
    if (c.inviteReward > 0) addPoints(by, c.inviteReward, `친구 초대 보상 (${u.nick})`);
    const total = db.invites.filter((x) => x.by === by.id && x.status === 'paid').length;
    let extra = '';
    if (c.inviteMilestone > 0 && c.inviteMilestoneBonus > 0 && total % c.inviteMilestone === 0) {
      inv.bonus = c.inviteMilestoneBonus; addPoints(by, c.inviteMilestoneBonus, `친구 초대 ${total}명 달성 보너스`); extra = ` · ${total}명 달성 보너스 +${c.inviteMilestoneBonus}P`;
    }
    pushMe(by.id); toast(by.id, `${u.nick} 님이 첫 출석해서 초대 보상 ${c.inviteReward}P를 받았어요${extra}`);
  }
  // 구독 확인: 새 결제 주기(주문번호)가 보이면 VIP 포인트를 지급한다.
  async function checkVip(u, token) {
    const c = cfg();
    const r = await verifySubscription({ sku: c.vipSku, token });
    const was = isVip(u);
    u.vip = { ...(u.vip || {}), token, until: r.expiry, checkedAt: Date.now(), active: r.active };
    if (r.active && r.orderId && !(u.vip.orders || []).includes(r.orderId)) {
      u.vip.orders = [...(u.vip.orders || []), r.orderId].slice(-36);
      db.orders.unshift({ id: nid(), uid: u.id, productId: 'vip', sku: c.vipSku, name: 'VIP 월 구독', points: c.vipPoints, bonus: 0, price: c.vipPrice, token, orderId: r.orderId, test: !!r.test, status: 'paid', kind: 'sub', at: Date.now(), doneAt: Date.now() });
      if (c.vipPoints > 0) addPoints(u, c.vipPoints, 'VIP 월 구독 포인트');
      toast(u.id, was ? `VIP가 연장되었습니다. ${c.vipPoints}P를 드렸어요.` : `VIP가 시작되었습니다! ${c.vipPoints}P를 드렸어요.`);
    }
    save(db); pushMe(u.id); if (was !== isVip(u)) pushUsers(); pushAdmin();
    return r.active;
  }
  // 오늘의 추천 친구: 같은 지역 → 같은 나이대 → 최근 접속 순으로, 이미 대화했거나 차단한 사람은 빼고
  function makePicks(u) {
    const today = dayKey(Date.now());
    if (u.picks?.day === today && (u.picks.sent || u.picks.ids.length >= cfg().pickCount)) return u.picks.ids;
    const talked = new Set(Object.values(db.convs).filter((c) => c.a === u.id || c.b === u.id).map((c) => (c.a === u.id ? c.b : c.a)));
    const pool = Object.values(db.users).filter((x) => x.id !== u.id && !x.gone && !x.banned && !talked.has(x.id) && !blockedEither(u.id, x.id) && Date.now() - (x.lastSeen || x.at) < 30 * 86400e3);
    const score = (x) => (x.region === u.region ? 4 : 0) + (x.age === u.age ? 2 : 0) + (x.gender !== u.gender ? 1 : 0) + Math.random() * 1.5;
    const ids = pool.sort((a, b) => score(b) - score(a)).slice(0, cfg().pickCount).map((x) => x.id);
    u.picks = { day: today, ids, sent: false };
    return ids;
  }
  // 주기 작업(서버가 몇 분마다 호출): 추천 친구 알림, 만료 임박 구독 재확인
  let lastTick = 0;
  function tick() {
    const now = Date.now(); if (now - lastTick < 60e3) return; lastTick = now;
    const h = new Date(now + 9 * 3600e3).getUTCHours(); const c = cfg();
    let changed = false;
    if (c.pickCount > 0 && h >= c.pickHour && h < 22) {
      for (const u of Object.values(db.users)) {
        if (u.gone || u.banned || u.bot || now - (u.lastSeen || u.at) > 30 * 86400e3) continue;
        const ids = makePicks(u);
        if (u.picks.sent || !ids.length) continue;
        u.picks.sent = true; changed = true;
        const names = ids.map((id) => db.users[id].nick).join(', ');
        notify(u.id, 'pick', { title: '오늘의 추천 친구가 도착했어요', body: `${names} 님과 이야기해 보세요.`, view: { type: 'picks', id: 'today' }, tag: 'picks' });
        pushMe(u.id);
      }
    }
    if (verifySubscription) {
      for (const u of Object.values(db.users)) {
        if (!u.vip?.token || u.gone) continue;
        const dueSoon = u.vip.until - now < 3600e3 && now - u.vip.until < 7 * 86400e3; // 만료 1시간 전 ~ 만료 후 7일
        if (dueSoon && now - (u.vip.checkedAt || 0) > 6 * 3600e3 && !busy.has(u.vip.token)) {
          busy.add(u.vip.token); const t = u.vip.token;
          checkVip(u, t).catch(() => { u.vip.checkedAt = Date.now(); }).finally(() => busy.delete(t));
        }
      }
    }
    if (changed) save(db);
  }
  const checkWords = (...texts) => { for (const w of cfg().banWords) if (w && texts.some((t) => t.includes(w))) fail('사용할 수 없는 단어가 포함되어 있습니다.'); };
  const talkList = () => {
    const now = Date.now();
    const top = (t) => t.pinUntil > now || (db.users[t.uid]?.boostUntil || 0) > now;
    return db.talks.slice().sort((a, b) => (top(b) - top(a)) || b.at - a.at).slice(0, 200);
  };
  const pushTalks = () => all({ t: 'talks', talks: talkList() });
  const convsOf = (uid) => Object.values(db.convs).filter((c) => (c.a === uid || c.b === uid) && !c.left.includes(uid));
  const pushConvs = (...uids) => uids.forEach((uid) => sendTo(uid, { t: 'convs', convs: convsOf(uid) }));
  const roomList = () => Object.values(db.rooms).map((r) => ({
    id: r.id, name: r.name, topic: r.topic, intro: r.intro, max: r.max, locked: !!r.pw, owner: r.owner, count: r.members.length, members: r.members, last: r.msgs.at(-1)?.at || r.at,
  }));
  const pushRooms = () => all({ t: 'rooms', rooms: roomList() });
  const pushRoom = (r) => { const { pw, ...room } = r; r.members.forEach((uid) => sendTo(uid, { t: 'room', room })); };
  const pushPosts = () => all({ t: 'posts', posts: db.posts });
  const toast = (uid, msg) => sendTo(uid, { t: 'toast', msg });
  const nf = (u) => ({ ...DEFAULT_NOTIFY, ...(u.notify || {}) });
  const isVisible = (uid) => [...(socks.get(uid) || [])].some((f) => visible.get(f) !== false);
  // 알림: 앱 화면이 보이면 화면 위 팝업, 아니면 휴대폰 알림(웹 푸시)
  function notify(uid, kind, { title, body, view, tag, from }) {
    const u = db.users[uid];
    if (!u || u.gone || u.banned || u.bot) return;
    if (from && (u.blocks.includes(from) || db.users[from]?.blocks.includes(uid))) return;
    const n = nf(u);
    if (!n[kind]) return;
    if (kind === 'room' && n.mutedRooms.includes(view?.id)) return;
    if (isVisible(uid)) return sendTo(uid, { t: 'notify', kind, title, body, view });
    if (!sendPush || !n.push || !u.subs?.length || (n.quiet && quietNow())) return;
    const payload = { title, body: n.preview ? body.slice(0, 120) : '새 알림이 도착했습니다.', view, tag };
    for (const sub of u.subs) {
      Promise.resolve().then(() => sendPush(sub, payload)).catch((e) => {
        if (e?.statusCode === 404 || e?.statusCode === 410) { u.subs = u.subs.filter((x) => x.endpoint !== sub.endpoint); save(db); }
      });
    }
  }

  function checkProfile(p, selfId) {
    const nick = line(p?.nick, 10);
    if (nick.length < 2) fail('닉네임은 2~10자로 입력해 주세요.');
    if (Object.values(db.users).some((u) => u.id !== selfId && !u.gone && u.nick === nick)) fail('이미 사용 중인 닉네임입니다.');
    if (!['M', 'F'].includes(p.gender)) fail('성별을 선택해 주세요.');
    if (!AGES.includes(p.age)) fail('나이대를 선택해 주세요.');
    if (!REGIONS.includes(p.region)) fail('지역을 선택해 주세요.');
    return { nick, gender: p.gender, age: p.age, region: p.region, intro: line(p.intro, 40) };
  }

  const blockedEither = (a, b) => db.users[a].blocks.includes(b) || db.users[b].blocks.includes(a);
  const sysMsg = (text) => ({ id: nid(), sys: true, text, at: Date.now() });
  const other = (c, uid) => (c.a === uid ? c.b : c.a);

  const handlers = {
    profile(u, m) { Object.assign(u, checkProfile(m.profile, u.id)); pushMe(u.id); pushUsers(); toast(u.id, '프로필을 저장했습니다.'); },

    'talk.add'(u, m) {
      const text = line(m.text, 100);
      if (text.length < 2) fail('토크 내용을 2자 이상 적어 주세요.');
      checkWords(text);
      const last = db.talks.find((t) => t.uid === u.id && Date.now() - t.at < 20e3);
      if (last) fail('토크는 20초에 한 번만 등록할 수 있습니다.');
      let pinUntil = 0;
      if (m.pin) {
        if (u.points < cfg().pinCost) fail(`포인트가 부족합니다. (상단 고정 ${cfg().pinCost}P)`);
        addPoints(u, -cfg().pinCost, '토크 상단 고정'); pinUntil = Date.now() + cfg().pinMin * 60e3;
      }
      db.talks.unshift({ id: nid(), uid: u.id, text, at: Date.now(), pinUntil });
      db.talks.length = Math.min(db.talks.length, 500);
      pushTalks(); pushMe(u.id); toast(u.id, '토크가 등록되었습니다.');
    },
    'talk.del'(u, m) { db.talks = db.talks.filter((t) => !(t.id === m.id && t.uid === u.id)); pushTalks(); },

    'conv.request'(u, m) {
      const to = db.users[m.to];
      if (!to || to.gone || to.id === u.id) fail('대화를 신청할 수 없는 상대입니다.');
      if (blockedEither(u.id, to.id)) fail('차단 관계인 상대에게는 대화를 신청할 수 없습니다.');
      let c = Object.values(db.convs).find((x) => [x.a, x.b].includes(u.id) && [x.a, x.b].includes(to.id) && x.status !== 'closed');
      if (!c) {
        const text = multi(m.text, 200) || '안녕하세요! 대화 나눠요.';
        checkWords(text);
        const cost = isVip(u) ? Math.floor((cfg().requestCost * (100 - cfg().vipRequestPct)) / 100) : cfg().requestCost;
        if (u.points < cost) fail(`포인트가 부족합니다. (대화 신청 ${cost}P)`);
        if (cost > 0) addPoints(u, -cost, `대화 신청 (${to.nick})`);
        c = { cost, id: nid(), a: u.id, b: to.id, status: 'pending', msgs: [{ id: nid(), uid: u.id, text, at: Date.now() }], read: { [u.id]: Date.now() }, left: [], at: Date.now() };
        db.convs[c.id] = c;
        hook({ type: 'conv.request', conv: c });
        notify(to.id, 'request', { title: `${u.nick} 님의 대화 신청`, body: text, view: { type: 'chat', id: c.id }, tag: `conv-${c.id}`, from: u.id });
      }
      c.left = c.left.filter((x) => x !== u.id);
      pushMe(u.id); pushConvs(c.a, c.b); sendTo(u.id, { t: 'goto', view: { type: 'chat', id: c.id } });
    },
    'conv.accept'(u, m) {
      const c = db.convs[m.id];
      if (!c || c.b !== u.id || c.status !== 'pending') return;
      c.status = 'open'; c.msgs.push(sysMsg('대화가 시작되었습니다.')); pushConvs(c.a, c.b);
      notify(c.a, 'msg', { title: `${u.nick} 님이 대화를 수락했어요`, body: '지금 대화를 시작해 보세요.', view: { type: 'chat', id: c.id }, tag: `conv-${c.id}`, from: u.id });
    },
    'conv.reject'(u, m) {
      const c = db.convs[m.id];
      if (!c || c.b !== u.id || c.status !== 'pending') return;
      c.status = 'closed'; c.left.push(u.id); c.msgs.push(sysMsg('상대가 대화 신청을 거절했습니다.'));
      if (c.cost > 0 && db.users[c.a]) { addPoints(db.users[c.a], c.cost, '대화 신청 거절 환불'); pushMe(c.a); }
      pushConvs(c.a, c.b);
    },
    'conv.send'(u, m) {
      const c = db.convs[m.id];
      if (!c || ![c.a, c.b].includes(u.id)) return;
      if (c.status !== 'open') fail(c.status === 'pending' ? '상대가 수락하면 대화를 시작할 수 있습니다.' : '종료된 대화입니다.');
      if (blockedEither(c.a, c.b)) fail('차단 관계에서는 메시지를 보낼 수 없습니다.');
      const text = multi(m.text, 1000);
      if (!text) return;
      checkWords(text);
      const msg = { id: nid(), uid: u.id, text, at: Date.now() };
      c.msgs.push(msg); if (c.msgs.length > 500) c.msgs.splice(0, c.msgs.length - 500);
      c.read[u.id] = msg.at; c.at = msg.at;
      pushConvs(c.a, c.b); hook({ type: 'conv.msg', conv: c, msg });
      notify(other(c, u.id), 'msg', { title: u.nick, body: text, view: { type: 'chat', id: c.id }, tag: `conv-${c.id}`, from: u.id });
    },
    'conv.read'(u, m) {
      const c = db.convs[m.id];
      if (!c || ![c.a, c.b].includes(u.id)) return;
      c.read[u.id] = Date.now(); pushConvs(c.a, c.b);
    },
    'conv.leave'(u, m) {
      const c = db.convs[m.id];
      if (!c || ![c.a, c.b].includes(u.id)) return;
      if (!c.left.includes(u.id)) c.left.push(u.id);
      if (c.status !== 'closed') { c.status = 'closed'; c.msgs.push(sysMsg('상대방이 대화방을 나갔습니다.')); }
      if (c.left.length >= 2) delete db.convs[c.id];
      pushConvs(c.a, c.b);
    },
    'msg.del'(u, m) {
      const c = db.convs[m.id]; const msg = c?.msgs.find((x) => x.id === m.mid);
      if (!msg || msg.uid !== u.id) return;
      msg.text = ''; msg.deleted = true; pushConvs(c.a, c.b);
    },

    'friend.toggle'(u, m) {
      if (!db.users[m.uid] || m.uid === u.id) return;
      const on = !u.friends.includes(m.uid);
      u.friends = on ? [...u.friends, m.uid] : u.friends.filter((x) => x !== m.uid);
      pushMe(u.id); toast(u.id, on ? '친구로 등록했습니다.' : '친구를 해제했습니다.');
    },
    'block.toggle'(u, m) {
      if (!db.users[m.uid] || m.uid === u.id) return;
      const on = !u.blocks.includes(m.uid);
      u.blocks = on ? [...u.blocks, m.uid] : u.blocks.filter((x) => x !== m.uid);
      if (on) u.friends = u.friends.filter((x) => x !== m.uid);
      pushMe(u.id); toast(u.id, on ? '차단했습니다.' : '차단을 해제했습니다.');
    },
    report(u, m) {
      if (!db.users[m.uid] || m.uid === u.id) return;
      db.reports.push({ id: nid(), by: u.id, uid: m.uid, reason: line(m.reason, 30), memo: multi(m.memo, 300), ref: line(m.ref, 60), at: Date.now(), snapshot: snapshot(u.id, m.uid) });
      if (!u.blocks.includes(m.uid)) u.blocks.push(m.uid);
      u.friends = u.friends.filter((x) => x !== m.uid);
      pushMe(u.id); toast(u.id, '신고가 접수되었습니다. 해당 사용자는 함께 차단됩니다.');
    },

    'room.create'(u, m) {
      const name = line(m.name, 20);
      if (name.length < 2) fail('방 이름을 2자 이상 입력해 주세요.');
      if (!TOPICS.includes(m.topic)) fail('주제를 선택해 주세요.');
      const max = Math.min(100, Math.max(2, Number(m.max) || 20));
      const r = { id: nid(), name, topic: m.topic, intro: line(m.intro, 60), max, pw: line(m.pw, 12), owner: u.id, members: [u.id], banned: [], msgs: [sysMsg(`${u.nick} 님이 방을 만들었습니다.`)], at: Date.now() };
      db.rooms[r.id] = r; pushRooms(); pushRoom(r); sendTo(u.id, { t: 'goto', view: { type: 'room', id: r.id } });
    },
    'room.join'(u, m) {
      const r = db.rooms[m.id];
      if (!r) fail('없는 채팅방입니다.');
      if (!r.members.includes(u.id)) {
        if (r.banned.includes(u.id)) fail('강퇴된 방에는 다시 들어갈 수 없습니다.');
        if (r.members.length >= r.max) fail('정원이 가득 찬 방입니다.');
        if (r.pw && r.pw !== String(m.pw ?? '')) fail('비밀번호가 맞지 않습니다.');
        r.members.push(u.id); r.msgs.push(sysMsg(`${u.nick} 님이 들어왔습니다.`)); pushRooms();
      }
      pushRoom(r); sendTo(u.id, { t: 'goto', view: { type: 'room', id: r.id } });
    },
    'room.leave'(u, m) {
      const r = db.rooms[m.id];
      if (!r || !r.members.includes(u.id)) return;
      r.members = r.members.filter((x) => x !== u.id);
      sendTo(u.id, { t: 'room_gone', id: r.id });
      if (!r.members.length) delete db.rooms[r.id];
      else {
        r.msgs.push(sysMsg(`${u.nick} 님이 나갔습니다.`));
        if (r.owner === u.id) { r.owner = r.members[0]; r.msgs.push(sysMsg(`${db.users[r.owner].nick} 님이 방장이 되었습니다.`)); }
        pushRoom(r);
      }
      pushRooms();
    },
    'room.send'(u, m) {
      const r = db.rooms[m.id];
      if (!r || !r.members.includes(u.id)) fail('참여 중인 방이 아닙니다.');
      const text = multi(m.text, 500);
      if (!text) return;
      checkWords(text);
      const msg = { id: nid(), uid: u.id, text, at: Date.now() };
      r.msgs.push(msg); if (r.msgs.length > 300) r.msgs.splice(0, r.msgs.length - 300);
      pushRoom(r); hook({ type: 'room.msg', room: r, msg });
      r.members.filter((x) => x !== u.id).forEach((x) => notify(x, 'room', { title: r.name, body: `${u.nick}: ${text}`, view: { type: 'room', id: r.id }, tag: `room-${r.id}`, from: u.id }));
    },
    'room.kick'(u, m) {
      const r = db.rooms[m.id];
      if (!r || r.owner !== u.id || m.uid === u.id || !r.members.includes(m.uid)) return;
      r.members = r.members.filter((x) => x !== m.uid); r.banned.push(m.uid);
      r.msgs.push(sysMsg(`${db.users[m.uid].nick} 님이 강퇴되었습니다.`));
      sendTo(m.uid, { t: 'room_gone', id: r.id }); toast(m.uid, `'${r.name}' 방에서 강퇴되었습니다.`);
      pushRoom(r); pushRooms();
    },

    'post.add'(u, m) {
      const title = line(m.title, 40); const body = multi(m.body, 2000);
      if (title.length < 2 || !body) fail('제목과 내용을 입력해 주세요.');
      if (!CATS.includes(m.cat)) fail('분류를 선택해 주세요.');
      checkWords(title, body);
      db.posts.unshift({ id: nid(), uid: u.id, cat: m.cat, title, body, at: Date.now(), likes: [], comments: [] });
      db.posts.length = Math.min(db.posts.length, 500); pushPosts(); toast(u.id, '글이 등록되었습니다.');
    },
    'post.del'(u, m) { db.posts = db.posts.filter((p) => !(p.id === m.id && p.uid === u.id)); pushPosts(); },
    'post.like'(u, m) {
      const p = db.posts.find((x) => x.id === m.id); if (!p) return;
      p.likes = p.likes.includes(u.id) ? p.likes.filter((x) => x !== u.id) : [...p.likes, u.id]; pushPosts();
    },
    'post.comment'(u, m) {
      const p = db.posts.find((x) => x.id === m.id); const text = line(m.text, 300);
      if (!p || !text) return;
      p.comments.push({ id: nid(), uid: u.id, text, at: Date.now() }); pushPosts();
      if (p.uid !== u.id) notify(p.uid, 'comment', { title: '내 글에 새 댓글', body: `${u.nick}: ${text}`, view: { type: 'post', id: p.id }, tag: `post-${p.id}`, from: u.id });
    },
    'comment.del'(u, m) {
      const p = db.posts.find((x) => x.id === m.id); if (!p) return;
      p.comments = p.comments.filter((c) => !(c.id === m.cid && c.uid === u.id)); pushPosts();
    },

    attend(u) {
      const today = dayKey(Date.now());
      if (u.attend.last === today) fail('출석은 하루 1회만 가능합니다.');
      u.attend.streak = u.attend.last === dayKey(Date.now() - 86400e3) ? u.attend.streak + 1 : 1;
      u.attend.last = today;
      let gain = cfg().attend; let extra = '';
      if (u.attend.streak % 7 === 0) { gain += cfg().bonus7; extra = ` (7일 연속 보너스 +${cfg().bonus7}P)`; } else if (u.attend.streak % 7 === 3) { gain += cfg().bonus3; extra = ` (3일 연속 보너스 +${cfg().bonus3}P)`; }
      addPoints(u, gain, `출석체크 ${u.attend.streak}일째`); pushMe(u.id); toast(u.id, `출석 완료! ${gain}P 적립${extra}`);
      settleInvite(u);
    },
    // 포인트 충전: 앱에서 Google Play 결제 → 결제 토큰을 서버가 Google 에 검증 → 자동 지급.
    'iap.verify'(u, m) {
      const p = cfg().products.find((x) => x.id === m.productId);
      const token = String(m.token || '');
      if (!p || token.length < 10 || token.length > 2000) fail('결제 정보가 올바르지 않습니다.');
      const done = db.orders.find((o) => o.token === token);
      if (done) { if (done.uid !== u.id) fail('이미 사용된 결제입니다.'); return sendTo(u.id, { t: 'iap.done', token }); }
      if (busy.has(token)) return;
      if (!verifyPurchase) { sendTo(u.id, { t: 'iap.fail', token }); fail('서버에 Google 결제 검증이 설정되지 않았습니다.'); }
      busy.add(token);
      Promise.resolve().then(() => verifyPurchase({ sku: p.sku, token, uid: u.id })).then((r) => {
        const first = !db.orders.some((o) => o.uid === u.id && o.status === 'paid');
        const firstBonus = first && cfg().firstBuyPct > 0 ? Math.floor((p.points * cfg().firstBuyPct) / 100) : 0;
        db.orders.unshift({ firstBonus, id: nid(), uid: u.id, productId: p.id, sku: p.sku, name: p.name, points: p.points, bonus: p.bonus, price: p.price, token, orderId: r?.orderId || '', test: !!r?.test, status: 'paid', at: Date.now(), doneAt: Date.now() });
        addPoints(u, p.points + p.bonus, `포인트 충전 (${p.name})`);
        if (firstBonus) addPoints(u, firstBonus, `첫 충전 보너스 (+${cfg().firstBuyPct}%)`);
        pushMe(u.id); sendTo(u.id, { t: 'iap.done', token }); toast(u.id, `${(p.points + p.bonus + firstBonus).toLocaleString()}P가 충전되었습니다.${firstBonus ? ' (첫 충전 보너스 포함)' : ''}`);
        save(db); pushAdmin();
      }).catch((e) => { sendTo(u.id, { t: 'iap.fail', token }); toast(u.id, e?.message || '결제를 확인하지 못했습니다.'); })
        .finally(() => busy.delete(token));
    },
    // 프로필 부스트: 정해진 시간 동안 토크 목록·주변 사람 맨 위에 노출. VIP 는 하루 무료 횟수가 있다.
    boost(u) {
      const c = cfg(); const now = Date.now(); const today = dayKey(now);
      if (!u.vip || u.vip.boostDay !== today) { if (u.vip) { u.vip.boostDay = today; u.vip.boostUsed = 0; } }
      const free = isVip(u) && (u.vip.boostUsed || 0) < c.vipFreeBoost;
      if (!free) {
        if (u.points < c.boostCost) fail(`포인트가 부족합니다. (부스트 ${c.boostCost}P)`);
        addPoints(u, -c.boostCost, `프로필 부스트 ${c.boostMin}분`);
      } else u.vip.boostUsed = (u.vip.boostUsed || 0) + 1;
      u.boostUntil = Math.max(now, u.boostUntil || 0) + c.boostMin * 60e3;
      pushMe(u.id); pushUsers(); pushTalks();
      toast(u.id, `${free ? 'VIP 무료 부스트! ' : ''}${c.boostMin}분 동안 내 프로필이 맨 위에 보입니다.`);
    },
    // 포인트 선물: 대화 중인 상대에게만
    gift(u, m) {
      const c = cfg(); const to = db.users[m.to]; const amt = Math.floor(Number(m.amount) || 0);
      if (!to || to.gone || to.id === u.id) fail('선물할 수 없는 상대입니다.');
      if (blockedEither(u.id, to.id)) fail('차단 관계에서는 선물할 수 없습니다.');
      const conv = Object.values(db.convs).find((x) => [x.a, x.b].includes(u.id) && [x.a, x.b].includes(to.id) && x.status === 'open');
      if (!conv) fail('대화 중인 상대에게만 선물할 수 있습니다.');
      if (amt < c.giftMin || amt > c.giftMax) fail(`선물은 ${c.giftMin}P ~ ${c.giftMax.toLocaleString()}P 사이로 보낼 수 있습니다.`);
      if (u.points < amt) fail('포인트가 부족합니다.');
      const today = dayKey(Date.now());
      const sent = db.ledger.filter((l) => l.uid === u.id && l.gift && dayKey(l.at) === today).reduce((n, l) => n - l.delta, 0);
      if (c.giftDayMax > 0 && sent + amt > c.giftDayMax) fail(`선물은 하루 ${c.giftDayMax.toLocaleString()}P까지 보낼 수 있습니다.`);
      addPoints(u, -amt, `선물 보냄 (${to.nick})`); db.ledger[0].gift = true;
      addPoints(to, amt, `선물 받음 (${u.nick})`);
      const msg = { id: nid(), uid: u.id, text: `${amt.toLocaleString()}P를 선물했습니다.`, gift: amt, at: Date.now() };
      conv.msgs.push(msg); conv.read[u.id] = msg.at; conv.at = msg.at;
      pushMe(u.id); pushMe(to.id); pushConvs(conv.a, conv.b);
      notify(to.id, 'msg', { title: `${u.nick} 님의 선물`, body: `${amt.toLocaleString()}P를 선물 받았어요!`, view: { type: 'chat', id: conv.id }, tag: `conv-${conv.id}`, from: u.id });
    },
    // 프로필 방문 기록(같은 사람은 최근 1번만)
    'profile.view'(u, m) {
      const to = db.users[m.uid];
      if (!to || to.gone || to.bot || to.id === u.id || blockedEither(u.id, to.id)) return;
      to.visitors = [{ uid: u.id, at: Date.now() }, ...(to.visitors || []).filter((v) => v.uid !== u.id)].slice(0, 100);
      pushMe(to.id);
    },
    'visit.open'(u) {
      const c = cfg();
      if (isVip(u)) return;
      if ((u.visitOpenUntil || 0) > Date.now()) return;
      if (u.points < c.visitorCost) fail(`포인트가 부족합니다. (방문자 보기 ${c.visitorCost}P)`);
      addPoints(u, -c.visitorCost, `방문자 보기 ${c.visitorHours}시간`);
      u.visitOpenUntil = Date.now() + c.visitorHours * 3600e3; pushMe(u.id);
    },
    // VIP 월 구독: Google Play 정기결제를 서버가 확인 → 기간 연장 + 매달 포인트
    'vip.verify'(u, m) {
      const token = String(m.token || '');
      if (token.length < 10 || token.length > 2000) fail('결제 정보가 올바르지 않습니다.');
      const owner = Object.values(db.users).find((x) => x.vip?.token === token);
      if (owner && owner.id !== u.id) fail('다른 계정에서 사용 중인 구독입니다.');
      if (!verifySubscription) { sendTo(u.id, { t: 'iap.fail', token }); fail('서버에 Google 결제 검증이 설정되지 않았습니다.'); }
      if (busy.has(token)) return;
      busy.add(token);
      checkVip(u, token).then((ok) => sendTo(u.id, { t: ok ? 'iap.done' : 'iap.fail', token }))
        .catch((e) => { sendTo(u.id, { t: 'iap.fail', token }); toast(u.id, e?.message || '구독을 확인하지 못했습니다.'); })
        .finally(() => busy.delete(token));
    },
    'invite.use'(u, m, meta) { if (!String(m.code || '').trim()) fail('초대 코드를 입력해 주세요.'); applyInvite(u, m.code, meta); },
    // 쿠폰(이벤트 코드): 관리자가 만든 코드를 입력하면 포인트 지급. 틀린 입력은 하루 10번까지.
    'coupon.use'(u, m) {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
      const today = dayKey(Date.now());
      if (u.couponFails?.day === today && u.couponFails.n >= 10) fail('오늘은 쿠폰 입력 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요.');
      const c = db.coupons.find((x) => x.code === code);
      const bad = (msg) => { u.couponFails = { day: today, n: (u.couponFails?.day === today ? u.couponFails.n : 0) + 1 }; fail(msg); };
      if (!code || !c || !c.on) bad('사용할 수 없는 쿠폰입니다.');
      if (c.until && Date.now() > c.until) bad('기간이 끝난 쿠폰입니다.');
      if (c.used.includes(u.id)) fail('이미 사용한 쿠폰입니다.');
      if (c.max > 0 && c.used.length >= c.max) fail('선착순 수량이 모두 소진된 쿠폰입니다.');
      if (c.newDays > 0 && Date.now() - u.at > c.newDays * 86400e3) fail(`가입 ${c.newDays}일 이내 회원만 쓸 수 있는 쿠폰입니다.`);
      c.used.push(u.id);
      addPoints(u, c.points, `쿠폰 ${c.code}${c.memo ? ` (${c.memo})` : ''}`); pushMe(u.id);
      toast(u.id, `쿠폰이 적용되어 ${c.points.toLocaleString()}P를 받았습니다.`);
    },
    'notify.set'(u, m) {
      const n = nf(u);
      for (const k of NOTIFY_KEYS) if (typeof m[k] === 'boolean') n[k] = m[k];
      if (typeof m.event === 'boolean') { u.adConsent = { on: m.event, at: Date.now() }; toast(u.id, `${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 이벤트·혜택 알림 수신에 ${m.event ? '동의' : '동의 철회'}하셨습니다.`); }
      u.notify = n; pushMe(u.id);
    },
    'room.mute'(u, m) {
      const n = nf(u); const on = !n.mutedRooms.includes(m.id);
      n.mutedRooms = on ? [...n.mutedRooms, line(m.id, 20)].slice(-100) : n.mutedRooms.filter((x) => x !== m.id);
      u.notify = n; pushMe(u.id); toast(u.id, on ? '이 방의 알림을 껐습니다.' : '이 방의 알림을 켰습니다.');
    },
    // 휴대폰 알림 구독 정보(브라우저가 만든 주소와 키). 기기마다 하나, 최대 5개.
    'push.sub'(u, m) {
      const sub = m.sub || {};
      const endpoint = String(sub.endpoint || '');
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') fail('알림 등록 정보가 올바르지 않습니다.');
      const clean = { endpoint, keys: { p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) } };
      u.subs = [...(u.subs || []).filter((x) => x.endpoint !== endpoint), clean].slice(-5);
      u.notify = { ...nf(u), push: true }; pushMe(u.id);
    },
    'push.unsub'(u, m) {
      u.subs = (u.subs || []).filter((x) => x.endpoint !== m.endpoint);
      u.notify = { ...nf(u), push: false }; pushMe(u.id);
    },
    quit(u) {
      u.subs = [];
      u.gone = true; u.goneAt = Date.now(); u.token = null; db.talks = db.talks.filter((t) => t.uid !== u.id);
      Object.values(db.rooms).forEach((r) => r.members.includes(u.id) && handlers['room.leave'](u, { id: r.id }));
      sendTo(u.id, { t: 'bye' }); pushTalks(); pushUsers();
    },
  };

  /* ---------- 수사 협조용 기록 ----------
   * logs  : 접속 기록(가입·접속·종료, IP, 기기 정보)
   * trail : 사용자가 한 모든 작성·변경 행위의 원본(화면에서 지워도 여기엔 남는다)
   * 보관 기간이 지나면 자동 파기하되, 보존 조치(holds)된 회원 관련 기록은 남긴다. */
  const addLog = (type, uid, meta = {}) => {
    db.logs.push({ id: nid(), type, uid: uid || null, ip: line(meta.ip, 64), ua: line(meta.ua, 200), at: Date.now() });
  };
  const peerOf = (uid, m) => {
    if (m.t === 'conv.request') return { peer: m.to || null };
    if (m.t?.startsWith('conv.') || m.t === 'msg.del') { const c = db.convs[m.id]; return c ? { peer: other(c, uid), conv: c.id } : {}; }
    if (m.t?.startsWith('room.')) return { room: m.id || null };
    if (['friend.toggle', 'block.toggle', 'report'].includes(m.t)) return { peer: m.uid || null };
    return {};
  };
  const addTrail = (uid, m, meta, extra) => {
    const data = {};
    for (const k of TRAIL_FIELDS) if (m[k] !== undefined && m[k] !== '') data[k] = typeof m[k] === 'string' ? m[k].slice(0, 2000) : m[k];
    if (m.profile) data.profile = { nick: line(m.profile.nick, 20), gender: m.profile.gender, age: m.profile.age, region: m.profile.region, intro: line(m.profile.intro, 60) };
    db.trail.push({ id: nid(), uid, t: m.t, ...peerOf(uid, m), ...extra, data, ip: line(meta.ip, 64), at: Date.now() });
  };
  const held = (uid) => !!(uid && db.holds[uid]);
  let lastPrune = 0;
  function prune(force) {
    const now = Date.now();
    if (!force && now - lastPrune < 3600e3) return;
    lastPrune = now;
    const day = 86400e3; const c = cfg();
    const keep = (at, days, ...uids) => now - at < days * day || uids.some(held);
    db.logs = db.logs.filter((l) => keep(l.at, c.keepLogsDays, l.uid));
    db.trail = db.trail.filter((t) => keep(t.at, c.keepTrailDays, t.uid, t.peer));
    db.reports = db.reports.filter((r) => keep(r.at, c.keepReportsDays, r.uid, r.by));
    // 친구 초대 기록은 관련 회원이 탈퇴한 지 1년이 지나면 파기
    const goneLong = (id) => { const x = db.users[id]; return !x || (x.gone && now - (x.goneAt || 0) > 365 * day); };
    db.invites = db.invites.filter((x) => !(goneLong(x.uid) || goneLong(x.by)) || held(x.uid) || held(x.by));
  }
  // 신고 순간의 증거 보존: 두 사람 사이의 기록과 신고 대상의 최근 활동·접속 기록을 그대로 복사해 둔다.
  function snapshot(by, uid) {
    const since = Date.now() - 30 * 86400e3;
    const u = db.users[uid];
    return {
      at: Date.now(),
      user: u ? { id: u.id, nick: u.nick, gender: u.gender, age: u.age, region: u.region, intro: u.intro, joined: u.at, gone: !!u.gone } : null,
      between: db.trail.filter((t) => t.at >= since && ((t.uid === uid && t.peer === by) || (t.uid === by && t.peer === uid))).slice(-300),
      recent: db.trail.filter((t) => t.uid === uid && t.at >= since).slice(-300),
      logs: db.logs.filter((l) => l.uid === uid).slice(-50),
    };
  }

  function act(uid, m, meta = {}) {
    const u = db.users[uid];
    if (!u || u.gone) return;
    if (u.banned) return toast(uid, '이용이 정지된 계정입니다. 문의는 운영자에게 해 주세요.');
    const before = m?.t === 'msg.del' ? db.convs[m.id]?.msgs.find((x) => x.id === m.mid)?.text : undefined;
    try {
      const h = handlers[m?.t];
      if (h) {
        h(u, m, meta);
        if (!NO_TRAIL.has(m.t)) addTrail(uid, m, meta, before !== undefined ? { deletedText: before } : undefined);
        prune(); save(db);
      }
    } catch (e) { toast(uid, e.message || '처리하지 못했습니다.'); }
    pushAdmin();
  }

  /* ---------- 관리자 ---------- */
  const num = (v, max = 1e7) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
  function adminData() {
    const today = dayKey(Date.now()); const isToday = (t) => dayKey(t) === today;
    const real = Object.values(db.users).filter((u) => !u.bot);
    const paid = db.orders.filter((o) => o.status === 'paid');
    return {
      stats: {
        users: real.filter((u) => !u.gone).length, online: socks.size, banned: real.filter((u) => u.banned).length,
        joinedToday: real.filter((u) => isToday(u.at)).length, talksToday: db.talks.filter((t) => isToday(t.at)).length,
        paidToday: paid.filter((o) => isToday(o.doneAt)).length, reportsOpen: db.reports.filter((r) => !r.done).length,
        salesTotal: paid.reduce((n, o) => n + o.price, 0), salesToday: paid.filter((o) => isToday(o.doneAt)).reduce((n, o) => n + o.price, 0),
        pointsHeld: real.reduce((n, u) => n + u.points, 0),
      },
      config: cfg(),
      orders: db.orders.slice(0, 200).map((o) => ({ ...o, nick: nickOf(o.uid) })),
      reports: db.reports.slice(-200).reverse().map((r) => ({ ...r, byNick: nickOf(r.by), nick: nickOf(r.uid) })),
      users: Object.values(db.users).filter((u) => !u.gone).sort((a, b) => !!a.bot - !!b.bot || b.at - a.at)
        .map((u) => ({ id: u.id, nick: u.nick, gender: u.gender, age: u.age, region: u.region, points: u.points, banned: !!u.banned, bot: !!u.bot, at: u.at, lastSeen: u.lastSeen, online: socks.has(u.id) })),
      talks: db.talks.slice(0, 100).map((t) => ({ id: t.id, nick: nickOf(t.uid), text: t.text, at: t.at })),
      posts: db.posts.slice(0, 100).map((p) => ({ id: p.id, nick: nickOf(p.uid), text: p.title, at: p.at })),
      rooms: Object.values(db.rooms).map((r) => ({ id: r.id, nick: nickOf(r.owner), text: `${r.name} (${r.members.length}명)`, at: r.at })),
      ledger: db.ledger.filter((l) => !db.users[l.uid]?.bot).slice(0, 100).map((l) => ({ ...l, nick: nickOf(l.uid) })),
      holds: Object.entries(db.holds).map(([uid, h]) => ({ uid, nick: nickOf(uid), ...h })),
      disclosures: db.disclosures.slice(-200).reverse(),
      marketing: marketingData(),
      notices: db.notices.slice(0, 30),
      revenue: {
        vip: Object.values(db.users).filter((u) => !u.bot && isVip(u)).length,
        eventOn: Object.values(db.users).filter((u) => !u.bot && !u.gone && nf(u).event).length,
        boostsToday: db.ledger.filter((l) => l.reason.startsWith('프로필 부스트') && dayKey(l.at) === dayKey(Date.now())).length,
        giftsToday: db.ledger.filter((l) => l.gift && dayKey(l.at) === dayKey(Date.now())).reduce((n, l) => n - l.delta, 0),
        visitOpens: db.ledger.filter((l) => l.reason.startsWith('방문자 보기')).length,
      },
      evidence: { logs: db.logs.length, trail: db.trail.length, oldest: Math.min(db.logs[0]?.at || Date.now(), db.trail[0]?.at || Date.now()) },
    };
  }
  function marketingData() {
    const month = monthKey(Date.now()); const inv = db.invites;
    const by = {};
    inv.forEach((x) => { const b = (by[x.by] ||= { uid: x.by, nick: nickOf(x.by), total: 0, paid: 0, blocked: 0 }); b.total += 1; if (x.status === 'paid') b.paid += 1; if (x.status === 'blocked') b.blocked += 1; });
    const cnt = (st) => inv.filter((x) => x.status === st).length;
    return {
      invites: { total: inv.length, month: inv.filter((x) => monthKey(x.at) === month).length, paid: cnt('paid'), pending: cnt('pending'), blocked: cnt('blocked'), capped: cnt('capped'),
        points: inv.reduce((n, x) => n + (x.reward || 0) + (x.bonus || 0), 0) },
      top: Object.values(by).sort((a, b) => b.paid - a.paid || b.total - a.total).slice(0, 20),
      recent: inv.slice(-100).reverse().map((x) => ({ id: x.id, by: nickOf(x.by), nick: nickOf(x.uid), at: x.at, status: x.status, ip: x.ip })),
      coupons: db.coupons.map(({ used, ...c }) => ({ ...c, usedCount: used.length })),
      firstBuyers: db.orders.filter((o) => o.firstBonus > 0).length,
      comebacks: db.ledger.filter((l) => l.reason.includes('복귀 보너스')).length,
    };
  }
  function pushAdmin() { if (admins.size) { const d = { t: 'admin.data', data: adminData() }; admins.forEach((f) => f(d)); } }
  const adminHandlers = {
    'admin.config'(m) {
      const c = m.config || {};
      const products = (Array.isArray(c.products) ? c.products : []).slice(0, 12)
        .map((p) => ({ id: line(p.id, 12) || nid(), sku: line(p.sku, 40), name: line(p.name, 16), points: num(p.points), bonus: num(p.bonus), price: num(p.price, 1e9) }))
        .filter((p) => p.name && p.points > 0);
      db.config = {
        startPoints: num(c.startPoints), attend: num(c.attend), bonus3: num(c.bonus3), bonus7: num(c.bonus7),
        pinCost: num(c.pinCost), pinMin: Math.max(1, num(c.pinMin, 1440)), requestCost: num(c.requestCost), products,
        banWords: (Array.isArray(c.banWords) ? c.banWords : []).map((w) => line(w, 20)).filter(Boolean).slice(0, 200),
        notice: line(c.notice, 100),
        inviteJoin: num(c.inviteJoin, 100000), inviteReward: num(c.inviteReward, 100000), inviteMonthMax: num(c.inviteMonthMax, 10000),
        inviteMilestone: num(c.inviteMilestone, 1000), inviteMilestoneBonus: num(c.inviteMilestoneBonus, 100000), firstBuyPct: num(c.firstBuyPct, 300),
        comebackDays: num(c.comebackDays, 365), comebackPoints: num(c.comebackPoints, 100000),
        boostCost: num(c.boostCost, 100000), boostMin: Math.max(1, num(c.boostMin, 1440)),
        vipSku: line(c.vipSku, 40) || 'vip_monthly', vipPrice: num(c.vipPrice, 1e7), vipPoints: num(c.vipPoints, 100000), vipRequestPct: num(c.vipRequestPct, 100), vipFreeBoost: num(c.vipFreeBoost, 10),
        giftMin: Math.max(1, num(c.giftMin, 100000)), giftMax: Math.max(1, num(c.giftMax, 1e6)), giftDayMax: num(c.giftDayMax, 1e7),
        visitorCost: num(c.visitorCost, 100000), visitorHours: Math.max(1, num(c.visitorHours, 720)),
        pickCount: num(c.pickCount, 10), pickHour: Math.min(21, num(c.pickHour, 21)),
        keepLogsDays: Math.max(KEEP_MIN_DAYS, num(c.keepLogsDays, 3650)), keepTrailDays: Math.max(KEEP_MIN_DAYS, num(c.keepTrailDays, 3650)), keepReportsDays: Math.max(KEEP_MIN_DAYS, num(c.keepReportsDays, 3650)),
      };
      pushConfig();
    },
    // Google 에서 환불된 결제를 반영: 지급했던 포인트를 회수한다(보유분 한도).
    'admin.refund'(m) {
      const o = db.orders.find((x) => x.id === m.id && x.status === 'paid');
      if (!o) fail('환불 처리할 수 없는 결제입니다.');
      const u = db.users[o.uid];
      o.status = 'refunded'; o.doneAt = Date.now();
      if (u) { const back = Math.min(u.points, o.points + o.bonus + (o.firstBonus || 0)); if (back > 0) addPoints(u, -back, `결제 환불 회수 (${o.name})`); pushMe(u.id); }
    },
    'admin.point'(m) {
      const u = db.users[m.uid]; const delta = Math.trunc(Number(m.delta) || 0);
      if (!u || !delta || Math.abs(delta) > 1e6) fail('지급·차감할 포인트를 확인해 주세요.');
      if (u.points + delta < 0) fail('보유 포인트보다 많이 차감할 수 없습니다.');
      addPoints(u, delta, `${delta > 0 ? '관리자 지급' : '관리자 차감'}${m.memo ? `: ${line(m.memo, 30)}` : ''}`);
      pushMe(u.id); toast(u.id, `포인트가 ${delta > 0 ? '지급' : '차감'}되었습니다. (${delta > 0 ? '+' : ''}${delta.toLocaleString()}P)`);
    },
    'admin.ban'(m) { const u = db.users[m.uid]; if (!u) return; u.banned = !!m.on; pushMe(u.id); pushUsers(); },
    'admin.del'(m) {
      if (m.kind === 'talks') { db.talks = db.talks.filter((t) => t.id !== m.id); pushTalks(); }
      if (m.kind === 'posts') { db.posts = db.posts.filter((p) => p.id !== m.id); pushPosts(); }
      if (m.kind === 'rooms' && db.rooms[m.id]) { db.rooms[m.id].members.forEach((uid) => sendTo(uid, { t: 'room_gone', id: m.id })); delete db.rooms[m.id]; pushRooms(); }
    },
    'admin.report'(m) { const r = db.reports.find((x) => x.id === m.id); if (r) r.done = !r.done; },

    // 회원 찾기: 탈퇴한 회원도 실제 닉네임·ID로 찾는다.
    'admin.lookup'(m, send) {
      const q = line(m.q, 40);
      if (!q) return;
      const list = Object.values(db.users).filter((u) => !u.bot && (u.id === q || u.nick.includes(q))).slice(0, 20).map((u) => {
        const logs = db.logs.filter((l) => l.uid === u.id);
        return {
          id: u.id, nick: u.nick, gender: u.gender, age: u.age, region: u.region, joined: u.at, lastSeen: u.lastSeen, gone: !!u.gone, banned: !!u.banned,
          held: db.holds[u.id] || null, trail: db.trail.filter((t) => t.uid === u.id).length, reported: db.reports.filter((r) => r.uid === u.id).length,
          logs: logs.slice(-30).reverse(),
        };
      });
      send({ t: 'admin.lookup', q, list });
    },
    // 보존 조치: 수사기관 요청 등으로 자동 파기를 멈춘다.
    'admin.hold'(m) {
      const u = db.users[m.uid]; if (!u) fail('없는 회원입니다.');
      if (m.on) {
        const reason = line(m.reason, 100);
        if (!reason) fail('보존 사유를 입력해 주세요.');
        db.holds[u.id] = { reason, agency: line(m.agency, 50), at: Date.now() };
      } else delete db.holds[u.id];
    },
    // 자료 추출: 회원·기간을 정해 기록을 한 파일로 만들고 해시값과 제공 이력을 남긴다.
    async 'admin.export'(m, send, meta) {
      const u = db.users[m.uid]; if (!u) fail('없는 회원입니다.');
      const purpose = m.purpose === 'agency' ? 'agency' : 'internal';
      const agency = line(m.agency, 50); const docType = line(m.docType, 30); const docNo = line(m.docNo, 60);
      if (purpose === 'agency' && (!agency || !docType || !docNo)) fail('수사기관 제공은 기관명, 근거 문서 종류, 문서 번호를 모두 입력해야 합니다.');
      const from = Number(new Date(m.from + 'T00:00:00+09:00')) || 0;
      const to = (Number(new Date(m.to + 'T00:00:00+09:00')) || Date.now()) + 86400e3 - 1;
      const inRange = (x) => x.at >= from && x.at <= to;
      const mine = db.trail.filter((t) => inRange(t) && t.uid === u.id);
      const rooms = new Set(mine.map((t) => t.room).filter(Boolean));
      const related = db.trail.filter((t) => inRange(t) && t.uid !== u.id && (t.peer === u.id || (t.room && rooms.has(t.room))));
      const nicks = {};
      [...mine, ...related].forEach((t) => { for (const x of [t.uid, t.peer]) if (x && !nicks[x]) nicks[x] = nickOf(x); });
      const pkg = {
        title: '이음챗 회원 자료',
        service: '이음챗 (kr.eumsoft.eumchat) / 운영 이음소프트웨어',
        createdAt: new Date().toISOString(),
        timezone: '모든 시각은 UTC 밀리초(at) 기준이며 화면 표기는 한국 시간(UTC+9)',
        request: { purpose: purpose === 'agency' ? '수사기관 제공' : '내부 검토', agency, docType, docNo, memo: line(m.memo, 200), from: m.from || null, to: m.to || null },
        subject: { id: u.id, nick: u.nick, gender: u.gender, age: u.age, region: u.region, intro: u.intro, joined: u.at, lastSeen: u.lastSeen, withdrawn: !!u.gone, banned: !!u.banned, points: u.points },
        accessLogs: db.logs.filter((l) => l.uid === u.id && inRange(l)),
        activity: mine,
        counterpartActivity: related,
        reportsAgainst: db.reports.filter((r) => r.uid === u.id && inRange(r)),
        reportsBy: db.reports.filter((r) => r.by === u.id && inRange(r)).map(({ snapshot, ...r }) => r),
        purchases: db.orders.filter((o) => o.uid === u.id && inRange(o)).map(({ token, ...o }) => o),
        nicknames: nicks,
      };
      const text = JSON.stringify(pkg, null, 2);
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const sha256 = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const name = `eumchat_${u.id}_${(m.from || 'all')}_${(m.to || 'now')}.json`;
      db.disclosures.push({
        id: nid(), at: Date.now(), uid: u.id, nick: u.nick, ...pkg.request, file: name, sha256, adminIp: line(meta?.ip, 64),
        counts: { accessLogs: pkg.accessLogs.length, activity: mine.length, counterpart: related.length, reports: pkg.reportsAgainst.length },
      });
      save(db);
      send({ t: 'admin.export', name, sha256, text });
    },
    'admin.prune'() { prune(true); },
    'admin.coupon'(m) {
      const c = m.coupon || {};
      const code = String(c.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
      if (code.length < 4) fail('쿠폰 코드는 영문·숫자 4자 이상으로 입력해 주세요.');
      const points = num(c.points, 100000); if (points < 1) fail('지급 포인트를 입력해 주세요.');
      const until = /^\d{4}-\d{2}-\d{2}$/.test(c.until || '') ? Date.parse(`${c.until}T23:59:59+09:00`) : 0;
      const old = db.coupons.find((x) => x.code === code);
      const v = { code, points, max: num(c.max, 1e7), until, newDays: num(c.newDays, 365), memo: line(c.memo, 30), on: c.on !== false };
      if (old) Object.assign(old, v); else db.coupons.unshift({ ...v, used: [], at: Date.now() });
    },
    // 단체 알림: 이벤트·혜택 알림을 켠(광고 수신 동의) 회원에게만. 밤 9시~아침 8시는 보낼 수 없다.
    'admin.broadcast'(m, send) {
      const title = line(m.title, 40); const body = multi(m.body, 300);
      if (!title || !body) fail('제목과 내용을 입력해 주세요.');
      const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
      if (h >= 21 || h < 8) fail('광고성 알림은 밤 9시부터 아침 8시까지 보낼 수 없습니다.');
      const region = REGIONS.includes(m.region) ? m.region : '';
      const n = { id: nid(), title, body, region, at: Date.now(), sent: 0 };
      db.notices.unshift(n); db.notices.length = Math.min(db.notices.length, 50);
      for (const u of Object.values(db.users)) {
        if (u.gone || u.banned || u.bot || !nf(u).event || (region && u.region !== region)) continue;
        n.sent += 1;
        notify(u.id, 'event', { title: `(광고) ${title}`, body: `${body}\n수신거부: MY > 알림 설정`, view: { type: 'notice', id: n.id }, tag: `notice-${n.id}` });
      }
      all({ t: 'notices', list: db.notices.slice(0, 20) });
      send({ t: 'toast', msg: `알림을 ${n.sent}명에게 보냈습니다.` });
    },
    'admin.coupon.del'(m) { db.coupons = db.coupons.filter((x) => x.code !== m.code); },
  };

  function addUser(profile, token, extra = {}) {
    const u = { id: nid(), token, ...checkProfile(profile), points: 0, attend: { last: '', streak: 0 }, friends: [], blocks: [], at: Date.now(), lastSeen: Date.now(), ...extra };
    codeOf(u); db.users[u.id] = u; if (cfg().startPoints > 0) addPoints(u, cfg().startPoints, '가입 축하 포인트'); save(db); return u;
  }

  function connect(send, meta = {}) {
    let uid = null; let isAdmin = false; let tries = 0;
    const sync = () => {
      pushUsers(); pushMe(uid); send({ t: 'config', config: pubConfig() }); send({ t: 'push.key', key: sendPush ? pushKey : '' });
      send({ t: 'talks', talks: talkList() }); send({ t: 'convs', convs: convsOf(uid) });
      send({ t: 'rooms', rooms: roomList() }); send({ t: 'posts', posts: db.posts }); send({ t: 'notices', list: db.notices.slice(0, 20) });
      Object.values(db.rooms).forEach((r) => { if (r.members.includes(uid)) { const { pw, ...room } = r; send({ t: 'room', room }); } });
      send({ t: 'ready' });
    };
    return {
      recv(m) {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'vis') { visible.set(send, m.v !== 'hidden'); return; }
        if (m.t === 'admin.login') {
          if (adminPassword && ++tries <= 5 && m.pw === adminPassword) { isAdmin = true; admins.add(send); addLog('admin.login', null, meta); send({ t: 'admin.ok' }); send({ t: 'admin.data', data: adminData() }); } else { addLog('admin.fail', null, meta); send({ t: 'admin.fail', off: !adminPassword }); }
          save(db); return;
        }
        if (typeof m.t === 'string' && m.t.startsWith('admin.')) {
          if (!isAdmin) return;
          Promise.resolve().then(() => adminHandlers[m.t]?.(m, send, meta))
            .then(() => { save(db); pushAdmin(); })
            .catch((e) => send({ t: 'toast', msg: e.message || '처리하지 못했습니다.' }));
          return;
        }
        if (m.t === 'hello') {
          let joinNote = '';
          if (uid || typeof m.token !== 'string' || m.token.length < 16) return;
          let u = Object.values(db.users).find((x) => x.token === m.token);
          if (!u) {
            if (!m.profile) return send({ t: 'need_profile' });
            try { u = addUser(m.profile, m.token); } catch (e) { return send({ t: 'toast', msg: e.message }); }
            addLog('join', u.id, meta); addTrail(u.id, { t: 'join', profile: m.profile }, meta);
            if (m.adConsent === true) { u.notify = { ...nf(u), event: true }; u.adConsent = { on: true, at: Date.now() }; }
            if (m.ref) { try { applyInvite(u, m.ref, meta); if (u.invitedBy && cfg().inviteJoin > 0) joinNote = `친구 초대 보너스 ${cfg().inviteJoin}P를 받았어요!`; addTrail(u.id, { t: 'invite.use', code: String(m.ref).slice(0, 10) }, meta); } catch (e) { joinNote = e.message; } }
          } else if (!u.gone && !u.banned && cfg().comebackDays > 0 && cfg().comebackPoints > 0 && Date.now() - (u.lastSeen || u.at) >= cfg().comebackDays * 86400e3) {
            addPoints(u, cfg().comebackPoints, `${cfg().comebackDays}일 만의 복귀 보너스`);
            joinNote = `다시 오신 걸 환영해요! 복귀 보너스 ${cfg().comebackPoints}P를 드렸어요.`;
          }
          uid = u.id; u.lastSeen = Date.now(); makePicks(u);
          addLog('login', uid, meta); prune(); save(db);
          if (!socks.has(uid)) socks.set(uid, new Set());
          socks.get(uid).add(send); sync();
          if (joinNote) send({ t: 'toast', msg: joinNote });
        } else if (uid) act(uid, m, meta);
      },
      close() {
        admins.delete(send); visible.delete(send);
        if (!uid) return;
        const s = socks.get(uid); s?.delete(send);
        if (s && !s.size) socks.delete(uid);
        if (db.users[uid]) db.users[uid].lastSeen = Date.now();
        addLog('logout', uid, meta);
        pushUsers(); save(db);
      },
    };
  }

  return { db, connect, act, addUser, tick };
}
