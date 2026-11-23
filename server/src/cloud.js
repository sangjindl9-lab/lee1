// 외부 클라우드 연동 (Google Drive · Dropbox · OneDrive)
// - 앱 키/시크릿은 서버 환경변수에만 둡니다. 없으면 "연동 준비 필요"로 표시합니다.
// - 사용자 토큰은 AES-256-GCM으로 암호화해 저장합니다 (TOKEN_ENC_KEY).
// - 파일 내용은 서버에 저장하지 않고 스트림으로만 중계합니다.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { q, one } from './db.js';

const PUBLIC_URL = () => (process.env.PUBLIC_URL || 'https://fm2.ieumerp.kr').replace(/\/$/, '');
const redirectUri = (p) => `${PUBLIC_URL()}/api/cloud/${p}/callback`;

// ---------- 토큰 암호화 ----------
function encKey() {
  const k = process.env.TOKEN_ENC_KEY ? Buffer.from(process.env.TOKEN_ENC_KEY, 'base64') : null;
  return k && k.length === 32 ? k : null;
}
export function encrypt(obj) {
  const key = encKey(); if (!key) throw Object.assign(new Error('TOKEN_ENC_KEY 미설정'), { status: 503 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function decrypt(s) {
  const key = encKey(); if (!key || !s) return null;
  const [iv, tag, data] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

class CloudError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }

async function j(r, what) {
  const t = await r.text();
  let body; try { body = t ? JSON.parse(t) : {}; } catch { body = { raw: t.slice(0, 300) }; }
  if (!r.ok) {
    const msg = body?.error_description || body?.error?.message || body?.error_summary || (typeof body?.error === 'string' ? body.error : '') || t.slice(0, 200);
    if (r.status === 401) throw new CloudError(401, 'cloud_auth', '클라우드 인증이 만료되었습니다. 다시 연결해 주세요');
    if (r.status === 404 || /not_found/.test(msg)) throw new CloudError(404, 'not_found', '파일을 찾을 수 없습니다');
    throw new CloudError(r.status >= 500 ? 502 : 400, 'cloud_error', `${what} 실패: ${msg}`);
  }
  return body;
}
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

// 들어오는 요청 본문을 고정 크기 조각으로 읽기 (대용량 업로드 세션용)
async function* chunked(stream, size) {
  let buf = []; let len = 0;
  for await (const c of stream) {
    let b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    while (b.length) {
      const take = Math.min(size - len, b.length);
      buf.push(b.subarray(0, take)); len += take; b = b.subarray(take);
      if (len === size) { yield Buffer.concat(buf); buf = []; len = 0; }
    }
  }
  if (len) yield Buffer.concat(buf);
}

// ---------- 공급자 ----------
const PROVIDERS = {
  gdrive: {
    label: 'Google Drive',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    authUrl: (state, challenge) => 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri('gdrive'), response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive openid email', access_type: 'offline', prompt: 'consent', state,
      code_challenge: challenge, code_challenge_method: 'S256' }),
    async exchange(code, verifier) {
      return j(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form({
        code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri('gdrive'), grant_type: 'authorization_code', code_verifier: verifier }) }), '토큰 발급');
    },
    async refresh(rt) {
      return j(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form({
        refresh_token: rt, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) }), '토큰 갱신');
    },
    async revoke(t) { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.refresh || t.access), { method: 'POST' }).catch(() => {}); },
    async account(at) {
      const b = await j(await fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + at } }), '계정 확인');
      return { label: b.user?.emailAddress || b.user?.displayName || 'Google Drive', id: b.user?.permissionId || '' };
    },
    root: 'root',
    async list(at, id) {
      const items = []; let pageToken;
      do {
        const u = 'https://www.googleapis.com/drive/v3/files?' + form({
          q: `'${String(id || 'root').replace(/'/g, "\\'")}' in parents and trashed=false`, pageSize: 1000, pageToken,
          fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)', orderBy: 'folder,name' });
        const b = await j(await fetch(u, { headers: { Authorization: 'Bearer ' + at } }), '목록');
        for (const f of b.files || []) {
          const dir = f.mimeType === 'application/vnd.google-apps.folder';
          const gdoc = !dir && f.mimeType.startsWith('application/vnd.google-apps.');
          items.push({ id: f.id, name: f.name, dir, size: Number(f.size || 0), mtime: Date.parse(f.modifiedTime) || 0, ...(gdoc ? { native: true } : {}) });
        }
        pageToken = b.nextPageToken;
      } while (pageToken && items.length < 20000);
      return items;
    },
    async stat(at, id) {
      const f = await j(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime`, { headers: { Authorization: 'Bearer ' + at } }), '파일 확인');
      return { id: f.id, name: f.name, dir: f.mimeType === 'application/vnd.google-apps.folder', size: Number(f.size || 0), mtime: Date.parse(f.modifiedTime) || 0 };
    },
    async download(at, id, range) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: 'Bearer ' + at, ...(range ? { Range: range } : {}) } });
      if (!r.ok) await j(r, '받기');
      return r;
    },
    async upload(at, parent, name, size, body) {
      const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,modifiedTime', {
        method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size) },
        body: JSON.stringify({ name, parents: [parent || 'root'] }) });
      if (!init.ok) await j(init, '올리기 준비');
      const loc = init.headers.get('location');
      const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Length': String(size) }, body: Readable.toWeb(body), duplex: 'half' });
      const f = await j(r, '올리기');
      return { id: f.id, name: f.name, size: Number(f.size || size) };
    },
    async mkdir(at, parent, name) {
      const f = await j(await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent || 'root'] }) }), '폴더 만들기');
      return { id: f.id, name: f.name, dir: true };
    },
    async rename(at, id, name) {
      await j(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }), '이름 변경');
    },
    async remove(at, id) {
      await j(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }), '삭제');
    },
  },

  dropbox: {
    label: 'Dropbox',
    env: ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET'],
    authUrl: (state, challenge) => 'https://www.dropbox.com/oauth2/authorize?' + form({
      client_id: process.env.DROPBOX_APP_KEY, redirect_uri: redirectUri('dropbox'), response_type: 'code', token_access_type: 'offline', state,
      code_challenge: challenge, code_challenge_method: 'S256' }),
    async exchange(code, verifier) {
      return j(await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: form({
        code, grant_type: 'authorization_code', client_id: process.env.DROPBOX_APP_KEY, client_secret: process.env.DROPBOX_APP_SECRET,
        redirect_uri: redirectUri('dropbox'), code_verifier: verifier }) }), '토큰 발급');
    },
    async refresh(rt) {
      return j(await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: form({
        refresh_token: rt, grant_type: 'refresh_token', client_id: process.env.DROPBOX_APP_KEY, client_secret: process.env.DROPBOX_APP_SECRET }) }), '토큰 갱신');
    },
    async revoke(t) { await fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t.access } }).catch(() => {}); },
    async account(at) {
      const b = await j(await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: 'Bearer ' + at } }), '계정 확인');
      return { label: b.email || b.name?.display_name || 'Dropbox', id: b.account_id || '' };
    },
    root: '',
    async rpc(at, ep, body, what) {
      return j(await fetch('https://api.dropboxapi.com/2/' + ep, { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), what);
    },
    map(e) { return { id: e.path_display || e.path_lower, name: e.name, dir: e['.tag'] === 'folder', size: Number(e.size || 0), mtime: Date.parse(e.server_modified || e.client_modified) || 0 }; },
    async list(at, id) {
      const items = [];
      let b = await this.rpc(at, 'files/list_folder', { path: id || '', limit: 2000 }, '목록');
      items.push(...b.entries.map((e) => this.map(e)));
      while (b.has_more && items.length < 20000) { b = await this.rpc(at, 'files/list_folder/continue', { cursor: b.cursor }, '목록'); items.push(...b.entries.map((e) => this.map(e))); }
      return items.sort((a, b2) => (a.dir === b2.dir ? a.name.localeCompare(b2.name) : a.dir ? -1 : 1));
    },
    async stat(at, id) { return this.map(await this.rpc(at, 'files/get_metadata', { path: id }, '파일 확인')); },
    async download(at, id, range) {
      const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Dropbox-API-Arg': dbxArg({ path: id }), ...(range ? { Range: range } : {}) } });
      if (!r.ok) await j(r, '받기');
      return r;
    },
    async upload(at, parent, name, size, body) {
      const path = (parent || '') + '/' + name;
      const CH = 8 * 1024 * 1024;
      const hdr = (arg) => ({ Authorization: 'Bearer ' + at, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dbxArg(arg) });
      if (size <= CH) {
        const buf = Buffer.concat(await arrayFrom(body));
        const f = await j(await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: hdr({ path, mode: 'add', autorename: true }), body: buf }), '올리기');
        return { id: f.path_display, name: f.name, size: f.size };
      }
      let session = null; let off = 0;
      for await (const piece of chunked(body, CH)) {
        if (!session) {
          session = (await j(await fetch('https://content.dropboxapi.com/2/files/upload_session/start', { method: 'POST', headers: hdr({ close: false }), body: piece }), '올리기 시작')).session_id;
        } else if (off + piece.length < size) {
          await j(await fetch('https://content.dropboxapi.com/2/files/upload_session/append_v2', { method: 'POST', headers: hdr({ cursor: { session_id: session, offset: off }, close: false }), body: piece }), '올리기');
        } else {
          const f = await j(await fetch('https://content.dropboxapi.com/2/files/upload_session/finish', { method: 'POST',
            headers: hdr({ cursor: { session_id: session, offset: off }, commit: { path, mode: 'add', autorename: true } }), body: piece }), '올리기 마무리');
          return { id: f.path_display, name: f.name, size: f.size };
        }
        off += piece.length;
      }
      throw new CloudError(400, 'incomplete', '파일이 끝까지 전송되지 않았습니다');
    },
    async mkdir(at, parent, name) {
      const b = await this.rpc(at, 'files/create_folder_v2', { path: (parent || '') + '/' + name, autorename: true }, '폴더 만들기');
      return { id: b.metadata.path_display, name: b.metadata.name, dir: true };
    },
    async rename(at, id, name) {
      await this.rpc(at, 'files/move_v2', { from_path: id, to_path: id.slice(0, id.lastIndexOf('/')) + '/' + name, autorename: true }, '이름 변경');
    },
    async remove(at, id) { await this.rpc(at, 'files/delete_v2', { path: id }, '삭제'); },
  },

  onedrive: {
    label: 'OneDrive',
    env: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
    authUrl: (state, challenge) => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + form({
      client_id: process.env.MS_CLIENT_ID, redirect_uri: redirectUri('onedrive'), response_type: 'code', response_mode: 'query',
      scope: 'offline_access Files.ReadWrite User.Read', state, code_challenge: challenge, code_challenge_method: 'S256' }),
    async exchange(code, verifier) {
      return j(await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', body: form({
        code, client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, redirect_uri: redirectUri('onedrive'),
        grant_type: 'authorization_code', code_verifier: verifier, scope: 'offline_access Files.ReadWrite User.Read' }) }), '토큰 발급');
    },
    async refresh(rt) {
      return j(await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', body: form({
        refresh_token: rt, client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, grant_type: 'refresh_token',
        scope: 'offline_access Files.ReadWrite User.Read' }) }), '토큰 갱신');
    },
    async revoke() {},
    async account(at) {
      const b = await j(await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + at } }), '계정 확인');
      return { label: b.mail || b.userPrincipalName || b.displayName || 'OneDrive', id: b.id || '' };
    },
    root: 'root',
    item(id) { return `https://graph.microsoft.com/v1.0/me/drive/${!id || id === 'root' ? 'root' : 'items/' + encodeURIComponent(id)}`; },
    map(f) { return { id: f.id, name: f.name, dir: !!f.folder, size: Number(f.size || 0), mtime: Date.parse(f.lastModifiedDateTime) || 0 }; },
    async list(at, id) {
      const items = []; let u = this.item(id) + '/children?$top=999&$select=id,name,size,folder,file,lastModifiedDateTime';
      while (u && items.length < 20000) {
        const b = await j(await fetch(u, { headers: { Authorization: 'Bearer ' + at } }), '목록');
        items.push(...b.value.map((f) => this.map(f))); u = b['@odata.nextLink'];
      }
      return items.sort((a, b2) => (a.dir === b2.dir ? a.name.localeCompare(b2.name) : a.dir ? -1 : 1));
    },
    async stat(at, id) { return this.map(await j(await fetch(this.item(id), { headers: { Authorization: 'Bearer ' + at } }), '파일 확인')); },
    async download(at, id, range) {
      const r = await fetch(this.item(id) + '/content', { headers: { Authorization: 'Bearer ' + at, ...(range ? { Range: range } : {}) } });
      if (!r.ok) await j(r, '받기');
      return r;
    },
    async upload(at, parent, name, size, body) {
      const s = await j(await fetch(`${this.item(parent)}:/${encodeURIComponent(name)}:/createUploadSession`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }) }), '올리기 준비');
      const CH = 320 * 1024 * 32; // 10 MiB (320KiB 배수)
      let off = 0; let last;
      if (size === 0) throw new CloudError(400, 'empty', 'OneDrive에는 빈 파일을 올릴 수 없습니다');
      for await (const piece of chunked(body, CH)) {
        const r = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(piece.length), 'Content-Range': `bytes ${off}-${off + piece.length - 1}/${size}` }, body: piece });
        last = await j(r, '올리기'); off += piece.length;
      }
      return { id: last?.id, name: last?.name || name, size: Number(last?.size || size) };
    },
    async mkdir(at, parent, name) {
      const f = await j(await fetch(this.item(parent) + '/children', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }) }), '폴더 만들기');
      return this.map(f);
    },
    async rename(at, id, name) {
      await j(await fetch(this.item(id), { method: 'PATCH', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }), '이름 변경');
    },
    async remove(at, id) {
      const r = await fetch(this.item(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + at } });
      if (!r.ok && r.status !== 204) await j(r, '삭제');
    },
  },
};

function dbxArg(o) { return JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); }
async function arrayFrom(stream) { const a = []; for await (const c of stream) a.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return a; }

export const configured = (p) => !!PROVIDERS[p] && PROVIDERS[p].env.every((k) => process.env[k]) && !!encKey();
export const providerList = () => Object.entries(PROVIDERS).map(([id, p]) => ({
  id, label: p.label, ready: configured(id),
  missing: [...p.env.filter((k) => !process.env[k]), ...(encKey() ? [] : ['TOKEN_ENC_KEY'])],
}));

/** 연결 하나의 유효한 access token (만료 시 자동 갱신) */
export async function accessFor(userId, connId) {
  const c = await one('SELECT * FROM cloud_connections WHERE id=$1 AND user_id=$2', [connId, userId]);
  if (!c) throw new CloudError(404, 'not_found', '클라우드 연결을 찾을 수 없습니다');
  const P = PROVIDERS[c.provider];
  if (!configured(c.provider)) throw new CloudError(503, 'not_configured', `${P?.label || c.provider} 연동 준비가 필요합니다 (관리자 설정)`);
  let t = decrypt(c.token_enc);
  if (!t) throw new CloudError(401, 'cloud_auth', '다시 연결해 주세요');
  if (t.exp && Date.now() > t.exp - 60e3 && t.refresh) {
    const n = await P.refresh(t.refresh);
    t = { access: n.access_token, refresh: n.refresh_token || t.refresh, exp: Date.now() + (n.expires_in || 3600) * 1000 };
    await q('UPDATE cloud_connections SET token_enc=$1, updated_at=now() WHERE id=$2', [encrypt(t), c.id]);
  }
  return { at: t.access, P, conn: c };
}

export function registerCloud(app, { auth, wrap, limit, log, ipOf }) {
  const fail = (res, e) => res.status(e.status || 500).json({ error: e.code || 'server_error', message: e.message });
  const guard = (fn) => wrap(async (req, res) => { try { await fn(req, res); } catch (e) { if (e instanceof CloudError || e.status) { if (!res.headersSent) fail(res, e); else res.destroy(); } else throw e; } });

  app.get('/api/cloud/providers', (req, res) => res.json(providerList().map(({ id, label, ready }) => ({ id, label, ready }))));

  app.get('/api/cloud', auth, wrap(async (req, res) => {
    const rows = await q('SELECT id, provider, account_label, created_at, updated_at FROM cloud_connections WHERE user_id=$1 ORDER BY created_at', [req.ctx.user_id]);
    res.json(rows.map((r) => ({ id: r.id, provider: r.provider, label: PROVIDERS[r.provider]?.label || r.provider, account: r.account_label, ready: configured(r.provider), createdAt: r.created_at })));
  }));

  // 1) 연결 시작: 브라우저로 열 인증 주소를 돌려줌
  app.post('/api/cloud/:p/start', auth, limit(30, 3600e3), guard(async (req, res) => {
    const p = req.params.p;
    if (!PROVIDERS[p]) throw new CloudError(404, 'unknown', '지원하지 않는 클라우드');
    if (!configured(p)) throw new CloudError(503, 'not_configured', `${PROVIDERS[p].label} 연동 준비가 필요합니다. 운영자가 앱 키를 등록해야 사용할 수 있습니다`);
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await q(`INSERT INTO oauth_states(state, user_id, device_id, provider, verifier, expires_at) VALUES ($1,$2,$3,$4,$5, now()+interval '15 minutes')`,
      [state, req.ctx.user_id, req.ctx.device_id, p, verifier]);
    await q(`DELETE FROM oauth_states WHERE expires_at < now()`);
    res.json({ url: PROVIDERS[p].authUrl(state, challenge), state });
  }));

  // 2) 공급자 → 서버 콜백
  app.get('/api/cloud/:p/callback', wrap(async (req, res) => {
    const page = (ok, msg) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>파일 관리자 2</title>
      <body style="font-family:system-ui,'Malgun Gothic';display:grid;place-items:center;height:90vh;background:#f6f7fb"><div style="background:#fff;padding:32px 36px;border-radius:18px;max-width:420px;text-align:center;box-shadow:0 10px 40px #0001">
      <div style="font-size:42px">${ok ? '✅' : '⚠️'}</div><h2>${ok ? '연결되었습니다' : '연결하지 못했습니다'}</h2><p style="color:#555">${escapeHtml(msg)}</p></div></body>`);
    const p = req.params.p;
    const st = await one(`DELETE FROM oauth_states WHERE state=$1 AND provider=$2 AND expires_at > now() RETURNING *`, [String(req.query.state || ''), p]);
    if (!st) return page(false, '요청이 만료되었거나 올바르지 않습니다. 프로그램에서 다시 시도해 주세요.');
    if (req.query.error) return page(false, '사용자가 취소했거나 권한이 거부되었습니다.');
    try {
      const P = PROVIDERS[p];
      const tok = await P.exchange(String(req.query.code || ''), st.verifier);
      const t = { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 };
      const acc = await P.account(t.access);
      await q(`INSERT INTO cloud_connections(user_id, provider, account_label, account_id, token_enc) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (user_id, provider, account_id) DO UPDATE SET token_enc=EXCLUDED.token_enc, account_label=EXCLUDED.account_label, updated_at=now()`,
        [st.user_id, p, acc.label, acc.id, encrypt(t)]);
      await log(st.user_id, st.device_id, 'cloud_connected', `${P.label} ${acc.label}`, ipOf(req));
      page(true, `${P.label} (${acc.label}) 계정이 연결되었습니다. 이 창을 닫고 프로그램으로 돌아가세요.`);
    } catch (e) {
      console.error('oauth', p, e.message);
      page(false, e.message);
    }
  }));

  app.delete('/api/cloud/:id', auth, guard(async (req, res) => {
    const c = await one('DELETE FROM cloud_connections WHERE id=$1 AND user_id=$2 RETURNING *', [req.params.id, req.ctx.user_id]);
    if (!c) throw new CloudError(404, 'not_found', '연결을 찾을 수 없습니다');
    const t = decrypt(c.token_enc); if (t) PROVIDERS[c.provider]?.revoke(t);
    await q(`UPDATE shared_links SET revoked=TRUE WHERE user_id=$1 AND target->>'kind'='cloud' AND target->>'connId'=$2`, [req.ctx.user_id, c.id]);
    await log(req.ctx.user_id, req.ctx.device_id, 'cloud_disconnected', c.provider, ipOf(req));
    res.json({ ok: true });
  }));

  app.get('/api/cloud/:id/list', auth, guard(async (req, res) => {
    const { at, P } = await accessFor(req.ctx.user_id, req.params.id);
    const id = req.query.id === undefined || req.query.id === '' ? P.root : String(req.query.id);
    res.json({ id, items: await P.list(at, id) });
  }));

  app.get('/api/cloud/:id/download', auth, guard(async (req, res) => {
    const { at, P, conn } = await accessFor(req.ctx.user_id, req.params.id);
    const id = String(req.query.id || '');
    const r = await P.download(at, id, req.headers.range);
    res.status(r.status === 206 ? 206 : 200);
    for (const h of ['content-length', 'content-range', 'content-type']) if (r.headers.get(h)) res.setHeader(h, r.headers.get(h));
    if (!req.headers.range) q(`INSERT INTO file_transfers(user_id, from_device, to_device, direction, path, size) VALUES ($1,NULL,$2,'cloud_to_pc',$3,$4)`,
      [req.ctx.user_id, req.ctx.device_id, `${conn.provider}:${id}`.slice(0, 500), Number(r.headers.get('content-length') || 0)]).catch(() => {});
    Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
  }));

  // 본문(원시 바이트)을 그대로 공급자로 흘려보냄 — 서버 디스크에 저장하지 않음
  app.post('/api/cloud/:id/upload', auth, guard(async (req, res) => {
    const { at, P, conn } = await accessFor(req.ctx.user_id, req.params.id);
    const size = Number(req.headers['content-length']);
    const name = String(req.query.name || '').trim();
    if (!name || /[\\/]/.test(name)) throw new CloudError(400, 'bad_name', '파일 이름이 올바르지 않습니다');
    if (!Number.isFinite(size) || size < 0) throw new CloudError(411, 'length_required', '파일 크기가 필요합니다');
    const parent = req.query.parent === undefined || req.query.parent === '' ? P.root : String(req.query.parent);
    const f = await P.upload(at, parent, name, size, req);
    q(`INSERT INTO file_transfers(user_id, from_device, to_device, direction, path, size) VALUES ($1,$2,NULL,'pc_to_cloud',$3,$4)`,
      [req.ctx.user_id, req.ctx.device_id, `${conn.provider}:${name}`.slice(0, 500), size]).catch(() => {});
    res.json(f);
  }));

  app.post('/api/cloud/:id/mkdir', auth, guard(async (req, res) => {
    const { at, P } = await accessFor(req.ctx.user_id, req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name || /[\\/]/.test(name)) throw new CloudError(400, 'bad_name', '폴더 이름이 올바르지 않습니다');
    res.json(await P.mkdir(at, req.body?.parent === undefined || req.body?.parent === '' ? P.root : String(req.body.parent), name));
  }));
  app.post('/api/cloud/:id/rename', auth, guard(async (req, res) => {
    const { at, P } = await accessFor(req.ctx.user_id, req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name || /[\\/]/.test(name)) throw new CloudError(400, 'bad_name', '이름이 올바르지 않습니다');
    await P.rename(at, String(req.body?.id), name); res.json({ ok: true });
  }));
  app.post('/api/cloud/:id/delete', auth, guard(async (req, res) => {
    const { at, P, conn } = await accessFor(req.ctx.user_id, req.params.id);
    await P.remove(at, String(req.body?.id));
    await log(req.ctx.user_id, req.ctx.device_id, 'cloud_delete', `${conn.provider}:${req.body?.id}`, ipOf(req));
    res.json({ ok: true });
  }));
}

export { PROVIDERS, CloudError };
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
