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
};

const dayKey = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10); // 한국 시간 기준 날짜

export function createCore({ data, save = () => {}, hook = () => {}, adminPassword = '', verifyPurchase = null } = {}) {
  const busy = new Set(); // 검증 중인 결제 토큰
  const db = Object.assign({ users: {}, talks: [], convs: {}, rooms: {}, posts: [], reports: [], ledger: [], orders: [], seq: 1 }, data || {});
  db.config = { ...DEFAULT_CONFIG, ...(db.config || {}) };
  const cfg = () => db.config;
  const admins = new Set(); // 관리자로 로그인한 연결
  const socks = new Map(); // uid -> Set(send)
  const nid = () => (db.seq++).toString(36) + Math.random().toString(36).slice(2, 5);
  const line = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const multi = (s, n) => String(s ?? '').trim().slice(0, n);
  const fail = (msg) => { throw new Error(msg); };

  const pub = (u) => ({
    id: u.id, nick: u.gone ? '(탈퇴한 회원)' : u.nick, gender: u.gender, age: u.age, region: u.region,
    intro: u.gone ? '' : u.intro, online: !u.gone && (socks.has(u.id) || !!u.bot), lastSeen: u.lastSeen, gone: !!u.gone,
  });
  const sendTo = (uid, m) => { const s = socks.get(uid); if (s) for (const f of s) f(m); };
  const all = (m) => { for (const uid of socks.keys()) sendTo(uid, m); };

  const pushUsers = () => all({ t: 'users', users: Object.values(db.users).map(pub) });
  const pushMe = (uid) => {
    const u = db.users[uid]; if (!u) return;
    const { token, ...me } = u;
    sendTo(uid, { t: 'me', me: { ...me, ledger: db.ledger.filter((l) => l.uid === uid).slice(0, 50), orders: db.orders.filter((o) => o.uid === uid).slice(0, 20) } });
  };
  const pubConfig = () => { const { banWords, ...c } = cfg(); return c; };
  const pushConfig = () => all({ t: 'config', config: pubConfig() });
  // 포인트 증감은 반드시 이 함수로 — 내역(ledger)이 함께 남는다.
  const addPoints = (u, delta, reason) => {
    u.points += delta;
    db.ledger.unshift({ id: nid(), uid: u.id, delta, balance: u.points, reason, at: Date.now() });
    if (db.ledger.length > 5000) db.ledger.length = 5000;
  };
  const checkWords = (...texts) => { for (const w of cfg().banWords) if (w && texts.some((t) => t.includes(w))) fail('사용할 수 없는 단어가 포함되어 있습니다.'); };
  const talkList = () => {
    const now = Date.now();
    return db.talks.slice().sort((a, b) => ((b.pinUntil > now) - (a.pinUntil > now)) || b.at - a.at).slice(0, 200);
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
        const cost = cfg().requestCost;
        if (u.points < cost) fail(`포인트가 부족합니다. (대화 신청 ${cost}P)`);
        if (cost > 0) addPoints(u, -cost, `대화 신청 (${to.nick})`);
        c = { cost, id: nid(), a: u.id, b: to.id, status: 'pending', msgs: [{ id: nid(), uid: u.id, text, at: Date.now() }], read: { [u.id]: Date.now() }, left: [], at: Date.now() };
        db.convs[c.id] = c;
        hook({ type: 'conv.request', conv: c });
      }
      c.left = c.left.filter((x) => x !== u.id);
      pushMe(u.id); pushConvs(c.a, c.b); sendTo(u.id, { t: 'goto', view: { type: 'chat', id: c.id } });
    },
    'conv.accept'(u, m) {
      const c = db.convs[m.id];
      if (!c || c.b !== u.id || c.status !== 'pending') return;
      c.status = 'open'; c.msgs.push(sysMsg('대화가 시작되었습니다.')); pushConvs(c.a, c.b);
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
      db.reports.push({ id: nid(), by: u.id, uid: m.uid, reason: line(m.reason, 30), memo: multi(m.memo, 300), ref: line(m.ref, 60), at: Date.now() });
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
        db.orders.unshift({ id: nid(), uid: u.id, productId: p.id, sku: p.sku, name: p.name, points: p.points, bonus: p.bonus, price: p.price, token, orderId: r?.orderId || '', test: !!r?.test, status: 'paid', at: Date.now(), doneAt: Date.now() });
        addPoints(u, p.points + p.bonus, `포인트 충전 (${p.name})`);
        pushMe(u.id); sendTo(u.id, { t: 'iap.done', token }); toast(u.id, `${(p.points + p.bonus).toLocaleString()}P가 충전되었습니다.`);
        save(db); pushAdmin();
      }).catch((e) => { sendTo(u.id, { t: 'iap.fail', token }); toast(u.id, e?.message || '결제를 확인하지 못했습니다.'); })
        .finally(() => busy.delete(token));
    },
    quit(u) {
      u.gone = true; u.token = null; db.talks = db.talks.filter((t) => t.uid !== u.id);
      Object.values(db.rooms).forEach((r) => r.members.includes(u.id) && handlers['room.leave'](u, { id: r.id }));
      sendTo(u.id, { t: 'bye' }); pushTalks(); pushUsers();
    },
  };

  function act(uid, m) {
    const u = db.users[uid];
    if (!u || u.gone) return;
    if (u.banned) return toast(uid, '이용이 정지된 계정입니다. 문의는 운영자에게 해 주세요.');
    try { const h = handlers[m?.t]; if (h) { h(u, m); save(db); } } catch (e) { toast(uid, e.message || '처리하지 못했습니다.'); }
    pushAdmin();
  }

  /* ---------- 관리자 ---------- */
  const nickOf = (id) => db.users[id]?.nick || '(알 수 없음)';
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
      };
      pushConfig();
    },
    // Google 에서 환불된 결제를 반영: 지급했던 포인트를 회수한다(보유분 한도).
    'admin.refund'(m) {
      const o = db.orders.find((x) => x.id === m.id && x.status === 'paid');
      if (!o) fail('환불 처리할 수 없는 결제입니다.');
      const u = db.users[o.uid];
      o.status = 'refunded'; o.doneAt = Date.now();
      if (u) { const back = Math.min(u.points, o.points + o.bonus); if (back > 0) addPoints(u, -back, `결제 환불 회수 (${o.name})`); pushMe(u.id); }
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
  };

  function addUser(profile, token, extra = {}) {
    const u = { id: nid(), token, ...checkProfile(profile), points: 0, attend: { last: '', streak: 0 }, friends: [], blocks: [], at: Date.now(), lastSeen: Date.now(), ...extra };
    db.users[u.id] = u; if (cfg().startPoints > 0) addPoints(u, cfg().startPoints, '가입 축하 포인트'); save(db); return u;
  }

  function connect(send) {
    let uid = null; let isAdmin = false; let tries = 0;
    const sync = () => {
      pushUsers(); pushMe(uid); send({ t: 'config', config: pubConfig() });
      send({ t: 'talks', talks: talkList() }); send({ t: 'convs', convs: convsOf(uid) });
      send({ t: 'rooms', rooms: roomList() }); send({ t: 'posts', posts: db.posts });
      Object.values(db.rooms).forEach((r) => { if (r.members.includes(uid)) { const { pw, ...room } = r; send({ t: 'room', room }); } });
      send({ t: 'ready' });
    };
    return {
      recv(m) {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'admin.login') {
          if (adminPassword && ++tries <= 5 && m.pw === adminPassword) { isAdmin = true; admins.add(send); send({ t: 'admin.ok' }); send({ t: 'admin.data', data: adminData() }); } else send({ t: 'admin.fail', off: !adminPassword });
          return;
        }
        if (typeof m.t === 'string' && m.t.startsWith('admin.')) {
          if (!isAdmin) return;
          try { adminHandlers[m.t]?.(m); save(db); } catch (e) { send({ t: 'toast', msg: e.message }); }
          pushAdmin(); return;
        }
        if (m.t === 'hello') {
          if (uid || typeof m.token !== 'string' || m.token.length < 16) return;
          let u = Object.values(db.users).find((x) => x.token === m.token);
          if (!u) {
            if (!m.profile) return send({ t: 'need_profile' });
            try { u = addUser(m.profile, m.token); } catch (e) { return send({ t: 'toast', msg: e.message }); }
          }
          uid = u.id; u.lastSeen = Date.now();
          if (!socks.has(uid)) socks.set(uid, new Set());
          socks.get(uid).add(send); sync();
        } else if (uid) act(uid, m);
      },
      close() {
        admins.delete(send);
        if (!uid) return;
        const s = socks.get(uid); s?.delete(send);
        if (s && !s.size) socks.delete(uid);
        if (db.users[uid]) db.users[uid].lastSeen = Date.now();
        pushUsers(); save(db);
      },
    };
  }

  return { db, connect, act, addUser };
}
