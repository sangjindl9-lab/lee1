// Hikvision ISAPI 클라이언트 (HTTP Digest/Basic 인증)
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const ARRAY_TAGS = new Set([
  'InputProxyChannel', 'InputProxyChannelStatus', 'StreamingChannel', 'VideoInputChannel',
  'searchMatchItem', 'PTZPreset', 'hdd', 'nas',
]);

export const xml = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function parseChallenge(header) {
  const out = { scheme: header.split(' ')[0].toLowerCase() };
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

export class IsapiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export class IsapiClient {
  // base: 'http://192.168.0.64:80'
  constructor({ base, username, password }) {
    this.base = base.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.challenge = null;
    this.nc = 0;
  }

  authHeader(method, path) {
    const c = this.challenge;
    if (!c) return null;
    if (c.scheme === 'basic') {
      return 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');
    }
    const nc = (++this.nc).toString(16).padStart(8, '0');
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${this.username}:${c.realm}:${this.password}`);
    const ha2 = md5(`${method}:${path}`);
    const qop = c.qop ? 'auth' : null;
    const response = qop
      ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : md5(`${ha1}:${c.nonce}:${ha2}`);
    let h = `Digest username="${this.username}", realm="${c.realm}", nonce="${c.nonce}", uri="${path}", algorithm=MD5, response="${response}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (c.opaque) h += `, opaque="${c.opaque}"`;
    return h;
  }

  // 원시 응답(Response)을 돌려준다. 401이면 인증 정보를 갱신해 한 번 재시도.
  async raw(method, path, { body, timeout = 8000, signal, contentType = 'application/xml' } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = {};
      const auth = this.authHeader(method, path);
      if (auth) headers.Authorization = auth;
      if (body) headers['Content-Type'] = contentType;
      const res = await fetch(this.base + path, {
        method, headers, body,
        signal: signal ?? AbortSignal.timeout(timeout),
      });
      if (res.status === 401 && attempt === 0) {
        const www = res.headers.get('www-authenticate');
        await res.arrayBuffer().catch(() => {});
        if (!www) break;
        this.challenge = parseChallenge(www);
        this.nc = 0;
        continue;
      }
      if (res.status === 401) {
        await res.arrayBuffer().catch(() => {});
        throw new IsapiError('장비 아이디 또는 비밀번호가 틀렸습니다', 401);
      }
      return res;
    }
    throw new IsapiError('장비 인증에 실패했습니다', 401);
  }

  async request(method, path, opts = {}) {
    let res;
    try {
      res = await this.raw(method, path, opts);
    } catch (e) {
      if (e instanceof IsapiError) throw e;
      throw new IsapiError(e.name === 'TimeoutError' ? '장비 응답 시간 초과' : `장비에 연결할 수 없습니다 (${e.cause?.code || e.message})`, 504);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = `ISAPI 오류 ${res.status}`;
      try {
        const r = xml.parse(text).ResponseStatus;
        if (r?.subStatusCode || r?.statusString) msg += ` (${r.subStatusCode || r.statusString})`;
      } catch {}
      throw new IsapiError(msg, res.status);
    }
    return text;
  }

  async get(path, opts) { return xml.parse(await this.request('GET', path, opts)); }
  async put(path, body, opts) { return xml.parse(await this.request('PUT', path, { ...opts, body })); }
  async post(path, body, opts) { return xml.parse(await this.request('POST', path, { ...opts, body })); }

  async binary(path) {
    const res = await this.raw('GET', path, { timeout: 10000 });
    if (!res.ok) throw new IsapiError(`ISAPI 오류 ${res.status}`, res.status);
    return { type: res.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await res.arrayBuffer()) };
  }
}
