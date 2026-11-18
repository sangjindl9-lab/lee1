// 체험판: 서버 없이 브라우저 안에서 같은 로직을 돌리고, 가상의 상대가 답한다.
import { createCore } from '../shared/core.js';

const BOTS = [
  { nick: '한강산책러', gender: 'F', age: '20대', region: '서울', intro: '저녁 산책 좋아해요', talk: '오늘 한강 바람 좋네요. 같이 걸을 분?' },
  { nick: '주말등산', gender: 'M', age: '30대', region: '경기', intro: '주말엔 산으로', talk: '이번 주 북한산 가시는 분 계신가요' },
  { nick: '커피한잔', gender: 'F', age: '30대', region: '부산', intro: '카페 투어가 취미', talk: '광안리 조용한 카페 추천 받아요' },
  { nick: '야근탈출', gender: 'M', age: '20대', region: '서울', intro: '퇴근하고 수다 떨어요', talk: '퇴근했습니다. 저녁 뭐 드셨어요?' },
  { nick: '책읽는밤', gender: 'F', age: '40대', region: '대전', intro: '요즘 읽는 책 얘기해요', talk: '요즘 재밌게 읽은 소설 있으면 알려주세요' },
  { nick: '기타치는곰', gender: 'M', age: '40대', region: '인천', intro: '통기타 15년차', talk: '기타 배우고 싶은 분 질문 받습니다' },
];
const REPLIES = ['반가워요! 오늘 하루 어떠셨어요?', '오 그렇군요. 저도 비슷해요.', '재밌네요, 조금 더 얘기해 주세요.', '저는 요즘 날씨가 좋아서 자주 걸어요.', '그건 처음 들어봐요. 어떤 건가요?', '맞아요, 공감합니다.', '주말에는 보통 뭐 하세요?', '좋은 생각이네요!'];
const ROOM_LINES = ['안녕하세요~', '오늘 다들 뭐 하세요?', '저는 방금 저녁 먹었어요', '새로 오신 분 환영합니다', '이 방 분위기 좋네요'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function startDemo() {
  let data;
  try { data = JSON.parse(localStorage.getItem('eum_demo_db')); } catch { data = null; }
  let t = null;
  const save = (db) => {
    clearTimeout(t);
    t = setTimeout(() => { try { localStorage.setItem('eum_demo_db', JSON.stringify(db)); } catch { /* 무시 */ } }, 400);
  };

  let core;
  const isBot = (id) => !!core.db.users[id]?.bot;
  const later = (fn, ms) => setTimeout(fn, ms + Math.random() * 800);
  const hook = (e) => {
    if (e.type === 'conv.request' && isBot(e.conv.b)) {
      later(() => core.act(e.conv.b, { t: 'conv.accept', id: e.conv.id }), 1200);
      later(() => core.act(e.conv.b, { t: 'conv.send', id: e.conv.id, text: '안녕하세요! 신청 주셔서 감사해요.' }), 2400);
    } else if (e.type === 'conv.msg' && !isBot(e.msg.uid)) {
      const bot = e.conv.a === e.msg.uid ? e.conv.b : e.conv.a;
      if (!isBot(bot)) return;
      later(() => core.act(bot, { t: 'conv.read', id: e.conv.id }), 700);
      later(() => core.act(bot, { t: 'conv.send', id: e.conv.id, text: pick(REPLIES) }), 1800);
    } else if (e.type === 'room.msg' && !isBot(e.msg.uid)) {
      const bots = e.room.members.filter(isBot);
      if (bots.length) later(() => core.act(pick(bots), { t: 'room.send', id: e.room.id, text: pick(ROOM_LINES) }), 1500);
    }
  };

  // 체험판은 실제 결제 없이 1초 뒤 성공으로 처리한다.
  const verifyPurchase = () => new Promise((ok) => setTimeout(() => ok({ orderId: 'TEST-' + Date.now().toString(36).toUpperCase(), test: true }), 900));
  core = createCore({ data: data || undefined, save, hook, adminPassword: 'admin', verifyPurchase });

  if (!data) {
    const bots = BOTS.map((b) => core.addUser(b, null, { bot: true }));
    bots.forEach((b, i) => { core.db.talks.push({ id: 't' + i, uid: b.id, text: BOTS[i].talk, at: Date.now() - (i * 7 + 2) * 60e3, pinUntil: i === 2 ? Date.now() + 20 * 60e3 : 0 }); });
    const room = (name, topic, intro, members, pw = '') => {
      const id = 'r' + Object.keys(core.db.rooms).length;
      core.db.rooms[id] = { id, name, topic, intro, max: 30, pw, owner: members[0].id, members: members.map((m) => m.id), banned: [], at: Date.now(), msgs: [{ id: id + 'm', uid: members[0].id, text: '어서 오세요! 편하게 얘기해요.', at: Date.now() - 30 * 60e3 }] };
    };
    room('퇴근 후 수다방', '수다', '하루 마무리 수다 떠는 방', [bots[3], bots[0], bots[2]]);
    room('주말 등산 모임', '운동', '수도권 산행 정보 나눠요', [bots[1], bots[5]]);
    room('통기타 연습실', '음악', '비밀번호는 1234', [bots[5], bots[4]], '1234');
    const post = (b, cat, title, body, likes, comments) => core.db.posts.push({ id: 'p' + core.db.posts.length, uid: b.id, cat, title, body, at: Date.now() - (core.db.posts.length + 1) * 3600e3, likes: likes.map((x) => x.id), comments: comments.map(([c, text], i) => ({ id: 'c' + i, uid: c.id, text, at: Date.now() - 1800e3 })) });
    post(bots[2], '동네', '광안리 근처 조용한 카페 정리', '주말에 세 군데 다녀왔어요.\n창가 자리 넓은 곳 위주로 골랐습니다. 궁금하신 분은 댓글 주세요.', [bots[0], bots[4]], [[bots[0], '저장해 둘게요!']]);
    post(bots[4], '고민', '퇴근 후 시간을 어떻게 쓰시나요', '집에 오면 휴대폰만 보다 자게 되네요.\n다들 어떻게 보내시는지 궁금합니다.', [bots[3]], [[bots[3], '저는 30분 산책부터 시작했어요'], [bots[1], '운동 하나 등록해 보세요']]);
    post(bots[3], '유머', '회의가 메일 한 통이면 됐던 날', '한 시간 회의 끝에 결론: "메일로 정리해서 공유하겠습니다."', [bots[0], bots[1], bots[5]], []);
    save(core.db);
  }
  return core;
}
