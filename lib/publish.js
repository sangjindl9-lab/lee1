// 채널별 발행 — 각 서비스가 공식으로 제공하는 API만 사용한다
const crypto = require('crypto');
const { getSetting } = require('./db');
const { SHORT_LIMITS } = require('./generate');

// 자동 발행 가능한 채널 (공식 API)
const CHANNEL_TYPES = {
  blogger: {
    label: '구글 블로거', format: 'blog', oauth: 'google',
    help: '구글 계정으로 연결합니다. 먼저 설정 > 구글 연결에 클라이언트 ID와 비밀을 넣어야 합니다.',
    fields: [],
  },
  wordpress: {
    label: '워드프레스', format: 'blog',
    help: '워드프레스 관리자 > 사용자 > 프로필 맨 아래 "애플리케이션 비밀번호"에서 새 비밀번호를 만들어 넣습니다.',
    fields: [
      { key: 'site', label: '사이트 주소', placeholder: 'https://myblog.com' },
      { key: 'username', label: '사용자 이름' },
      { key: 'appPassword', label: '애플리케이션 비밀번호', secret: true },
    ],
  },
  telegram: {
    label: '텔레그램 채널', format: 'short',
    help: '@BotFather에서 봇을 만들어 토큰을 받고, 그 봇을 내 채널의 관리자로 추가합니다. 채널 ID는 @채널이름 형식입니다.',
    fields: [
      { key: 'token', label: '봇 토큰', secret: true },
      { key: 'chatId', label: '채널 ID', placeholder: '@mychannel' },
    ],
  },
  discord: {
    label: '디스코드', format: 'short',
    help: '서버 설정 > 연동 > 웹후크에서 새 웹후크를 만들고 주소를 복사해 넣습니다.',
    fields: [{ key: 'webhook', label: '웹후크 주소', secret: true }],
  },
  bluesky: {
    label: '블루스카이', format: 'short',
    help: '설정 > 개인정보 및 보안 > 앱 비밀번호에서 새 비밀번호를 만들어 넣습니다. 계정 비밀번호를 그대로 넣지 마세요.',
    fields: [
      { key: 'handle', label: '핸들', placeholder: 'name.bsky.social' },
      { key: 'appPassword', label: '앱 비밀번호', secret: true },
    ],
  },
  mastodon: {
    label: '마스토돈', format: 'short',
    help: '환경설정 > 개발 > 새 애플리케이션에서 write:statuses 권한으로 만들고 액세스 토큰을 넣습니다.',
    fields: [
      { key: 'instance', label: '서버 주소', placeholder: 'https://mastodon.social' },
      { key: 'token', label: '액세스 토큰', secret: true },
    ],
  },
  x: {
    label: 'X (트위터)', format: 'short',
    help: 'developer.x.com에서 앱을 만들고 읽기+쓰기 권한으로 키 4개를 발급받습니다. X API는 요금제에 따라 글쓰기 한도와 비용이 다르니 먼저 확인하세요.',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true },
      { key: 'apiSecret', label: 'API Key Secret', secret: true },
      { key: 'accessToken', label: 'Access Token', secret: true },
      { key: 'accessSecret', label: 'Access Token Secret', secret: true },
    ],
  },
};

// 공식 글쓰기 API가 없어 직접 붙여 넣어야 하는 곳 (복사 도우미 제공)
const MANUAL_TARGETS = {
  naver: { label: '네이버 블로그', format: 'blog', writeUrl: 'https://blog.naver.com/GoBlogWrite.naver' },
  tistory: { label: '티스토리', format: 'blog', writeUrl: 'https://www.tistory.com/' },
  instagram: { label: '인스타그램', format: 'short', writeUrl: 'https://www.instagram.com/' },
  threads: { label: '스레드', format: 'short', writeUrl: 'https://www.threads.net/' },
  facebook: { label: '페이스북', format: 'short', writeUrl: 'https://www.facebook.com/' },
  community: { label: '카페·커뮤니티', format: 'short', writeUrl: '' },
  youtube: { label: '유튜브 쇼츠', format: 'short', writeUrl: 'https://studio.youtube.com/' },
  etc: { label: '기타(복사해서 사용)', format: 'short', writeUrl: '' },
};

async function jsonFetch(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (!r.ok) {
    const msg = data?.error?.message || data?.error_description || data?.message || data?.description || data?.error || raw.slice(0, 200);
    throw new Error(`${r.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data ?? raw;
}

// ----- 구글 블로거 -----
async function googleAccessToken(refreshToken) {
  const g = getSetting('google', {});
  if (!g.clientId || !g.clientSecret) throw new Error('설정에 구글 클라이언트 ID가 없습니다');
  const j = await jsonFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  return j.access_token;
}
async function bloggerBlogs(refreshToken) {
  const token = await googleAccessToken(refreshToken);
  const j = await jsonFetch('https://www.googleapis.com/blogger/v3/users/self/blogs', { headers: { authorization: `Bearer ${token}` } });
  return (j.items || []).map((b) => ({ id: b.id, name: b.name, url: b.url }));
}
async function publishBlogger(cfg, post) {
  if (!cfg.refreshToken) throw new Error('구글 계정 연결이 필요합니다');
  if (!cfg.blogId) throw new Error('글을 올릴 블로그를 선택하세요');
  const token = await googleAccessToken(cfg.refreshToken);
  const j = await jsonFetch(`https://www.googleapis.com/blogger/v3/blogs/${cfg.blogId}/posts/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'blogger#post', title: post.title, content: post.body_html, labels: (post.tags || []).slice(0, 8) }),
  });
  return { url: j.url || '' };
}

// ----- 워드프레스 -----
function wpBase(cfg) { return String(cfg.site || '').replace(/\/+$/, ''); }
function wpAuth(cfg) { return `Basic ${Buffer.from(`${cfg.username}:${String(cfg.appPassword || '').replace(/\s+/g, ' ')}`).toString('base64')}`; }
async function publishWordpress(cfg, post) {
  const j = await jsonFetch(`${wpBase(cfg)}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: { authorization: wpAuth(cfg), 'content-type': 'application/json' },
    body: JSON.stringify({ title: post.title, content: post.body_html, status: 'publish' }),
  });
  return { url: j.link || '' };
}

// ----- 짧은 글 채널 -----
function shortText(post, type) {
  const limit = SHORT_LIMITS[type] || 500;
  let t = post.body_text || '';
  if (post.title && !t.startsWith(post.title)) t = `${post.title}\n\n${t}`;
  const chars = [...t];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : t;
}
async function publishTelegram(cfg, post) {
  const j = await jsonFetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text: shortText(post, 'telegram') }),
  });
  const username = j.result?.chat?.username;
  return { url: username ? `https://t.me/${username}/${j.result.message_id}` : '' };
}
async function publishDiscord(cfg, post) {
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(cfg.webhook || '')) throw new Error('디스코드 웹후크 주소가 아닙니다');
  await jsonFetch(cfg.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: shortText(post, 'discord') }) });
  return { url: '' };
}
async function blueskySession(cfg) {
  return jsonFetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: String(cfg.handle || '').replace(/^@/, ''), password: cfg.appPassword }),
  });
}
async function publishBluesky(cfg, post) {
  const s = await blueskySession(cfg);
  const text = shortText(post, 'bluesky');
  // 링크·해시태그가 눌리도록 바이트 위치를 계산해 표시
  const facets = [];
  const enc = (str) => Buffer.byteLength(str, 'utf8');
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    facets.push({ index: { byteStart: enc(text.slice(0, m.index)), byteEnd: enc(text.slice(0, m.index + m[0].length)) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  for (const m of text.matchAll(/#([^\s#]+)/g)) {
    facets.push({ index: { byteStart: enc(text.slice(0, m.index)), byteEnd: enc(text.slice(0, m.index + m[0].length)) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }] });
  }
  const j = await jsonFetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.accessJwt}` },
    body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, facets, createdAt: new Date().toISOString() } }),
  });
  const rkey = String(j.uri || '').split('/').pop();
  return { url: rkey ? `https://bsky.app/profile/${s.handle}/post/${rkey}` : '' };
}
async function publishMastodon(cfg, post) {
  const j = await jsonFetch(`${String(cfg.instance || '').replace(/\/+$/, '')}/api/v1/statuses`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({ status: shortText(post, 'mastodon') }),
  });
  return { url: j.url || '' };
}

// ----- X (OAuth 1.0a 서명) -----
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function oauth1Header(method, url, cfg) {
  const p = {
    oauth_consumer_key: cfg.apiKey, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: cfg.accessToken, oauth_version: '1.0',
  };
  const base = [method, pct(url), pct(Object.keys(p).sort().map((k) => `${pct(k)}=${pct(p[k])}`).join('&'))].join('&');
  p.oauth_signature = crypto.createHmac('sha1', `${pct(cfg.apiSecret)}&${pct(cfg.accessSecret)}`).update(base).digest('base64');
  return `OAuth ${Object.keys(p).sort().map((k) => `${pct(k)}="${pct(p[k])}"`).join(', ')}`;
}
async function publishX(cfg, post) {
  const url = 'https://api.twitter.com/2/tweets';
  const j = await jsonFetch(url, {
    method: 'POST', headers: { authorization: oauth1Header('POST', url, cfg), 'content-type': 'application/json' },
    body: JSON.stringify({ text: post.body_text }),
  });
  return { url: j.data?.id ? `https://x.com/i/status/${j.data.id}` : '' };
}

const PUBLISHERS = { blogger: publishBlogger, wordpress: publishWordpress, telegram: publishTelegram, discord: publishDiscord, bluesky: publishBluesky, mastodon: publishMastodon, x: publishX };

async function publish(channel, post) {
  const fn = PUBLISHERS[channel.type];
  if (!fn) throw new Error('자동 발행을 지원하지 않는 채널입니다');
  return fn(channel.config || {}, post);
}

// 연결 확인 — 글을 올리지 않고 인증만 점검한다
async function testChannel(channel) {
  const c = channel.config || {};
  switch (channel.type) {
    case 'blogger': {
      if (!c.refreshToken) throw new Error('구글 계정 연결이 필요합니다');
      const blogs = await bloggerBlogs(c.refreshToken);
      return `연결됨 — 블로그 ${blogs.length}개`;
    }
    case 'wordpress': {
      const me = await jsonFetch(`${wpBase(c)}/wp-json/wp/v2/users/me`, { headers: { authorization: wpAuth(c) } });
      return `연결됨 — ${me.name || c.username}`;
    }
    case 'telegram': {
      const me = await jsonFetch(`https://api.telegram.org/bot${c.token}/getMe`);
      const chat = await jsonFetch(`https://api.telegram.org/bot${c.token}/getChat?chat_id=${encodeURIComponent(c.chatId)}`);
      return `연결됨 — 봇 @${me.result?.username}, 채널 ${chat.result?.title || c.chatId}`;
    }
    case 'discord': {
      const hook = await jsonFetch(c.webhook);
      return `연결됨 — ${hook.name || '웹후크'}`;
    }
    case 'bluesky': {
      const s = await blueskySession(c);
      return `연결됨 — @${s.handle}`;
    }
    case 'mastodon': {
      const me = await jsonFetch(`${String(c.instance || '').replace(/\/+$/, '')}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${c.token}` } });
      return `연결됨 — @${me.acct}`;
    }
    case 'x': {
      const url = 'https://api.twitter.com/2/users/me';
      const me = await jsonFetch(url, { headers: { authorization: oauth1Header('GET', url, c) } });
      return `연결됨 — @${me.data?.username}`;
    }
    default: throw new Error('알 수 없는 채널입니다');
  }
}

module.exports = { CHANNEL_TYPES, MANUAL_TARGETS, publish, testChannel, bloggerBlogs, jsonFetch };
