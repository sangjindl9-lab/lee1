'use strict';
/**
 * 라이선스 (CCTV 공사 설계 · CCTV 설치 제안서 공용 — 두 프로그램에 같은 파일)
 *  - 판매자(CCTV 라이선스 관리)가 Ed25519 로 서명한 라이선스만 인정: <base64url(JSON)>.<base64url(서명)>
 *  - 라이선스가 없으면 처음 실행한 날부터 30일 무료 체험
 *  - 체험 종료·만료·사용 중지면 보기 전용 (저장·수정·출력 차단, 로그인·라이선스 등록은 가능)
 *  - 라이선스 사용자 수만큼만 사용 중 계정을 둘 수 있음
 *  - 설치 코드 + 사업자등록번호로 판매자 서버에서 6시간마다 자동 갱신, 인터넷이 없으면 라이선스 문자열 붙여넣기
 * 환경변수: LICENSE_SERVER(판매자 서버 주소), LICENSE_CODE, LICENSE_BIZ_NO (처음 값)
 */
const crypto = require('crypto');

const VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbbkSKUeHhNc/F94/IDKqej0TjWHBMzo3KQTnb4mmqO0=
-----END PUBLIC KEY-----`;
const TRIAL_DAYS = 30;
const TRIAL_USERS = 5;
const PRODUCTS = { design: 'CCTV 공사 설계', proposal: 'CCTV 설치 제안서' };
const DEFAULT_SERVER = 'https://cctv-license-production.up.railway.app';

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// 만료일 당일 밤 12시가 지나면 음수 (Math.ceil 의 -0 을 -1 로)
const daysLeft = ymd => { const ms = new Date(ymd + 'T23:59:59+09:00').getTime() - Date.now(); return Math.ceil(ms / 86400000) || (ms < 0 ? -1 : 0); };
const normBiz = v => String(v ?? '').replace(/[^0-9]/g, '');

function verify(text, key = VENDOR_PUBLIC_KEY) {
  const [body, sig] = String(text || '').trim().split('.');
  if (!body || !sig) return null;
  try {
    if (!crypto.verify(null, Buffer.from(body), crypto.createPublicKey(key), Buffer.from(sig, 'base64url'))) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch { return null; }
}

module.exports = function mountLicense(app, { product, appVersion, getSetting, setSetting, countActiveUsers, auth, admin, publicKey }) {
  const KEY = publicKey || VENDOR_PUBLIC_KEY;
  if (!getSetting('trial_start', null)) setSetting('trial_start', kstToday());
  const conf = () => getSetting('license', {}) || {};
  if (!conf().code && process.env.LICENSE_CODE) setSetting('license', { ...conf(), code: process.env.LICENSE_CODE.trim().toUpperCase(), bizNo: normBiz(process.env.LICENSE_BIZ_NO) });
  const server = () => (process.env.LICENSE_SERVER || DEFAULT_SERVER).replace(/\/+$/, '');

  /** 지금 상태 — mode: licensed | trial | expired | suspended | trial_ended */
  function status() {
    const c = conf(); const p = c.text ? verify(c.text, KEY) : null;
    const base = { product, productName: PRODUCTS[product], code: c.code || '', bizNo: c.bizNo || '', checkedAt: c.checkedAt || null, lastError: c.lastError || null, server: server() };
    if (p && p.product === product && (!c.bizNo || normBiz(p.bizRegNo) === c.bizNo)) {
      const left = daysLeft(p.expiresAt);
      // 사용 중지 = 발급일(한국 날짜)보다 이른 만료일로 다시 발급된 라이선스
      const suspended = left < 0 && p.issuedAt && p.expiresAt < new Date(new Date(p.issuedAt).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
      const mode = left >= 0 ? 'licensed' : suspended ? 'suspended' : 'expired';
      return { ...base, mode, writable: mode === 'licensed', licensee: p.licensee, bizRegNo: p.bizRegNo, maxUsers: p.maxUsers, expiresAt: p.expiresAt, daysLeft: left, licenseId: p.licenseId, edition: p.edition };
    }
    const start = getSetting('trial_start', kstToday()); const end = addDays(start, TRIAL_DAYS - 1); const left = daysLeft(end);
    return { ...base, mode: left >= 0 ? 'trial' : 'trial_ended', writable: left >= 0, maxUsers: TRIAL_USERS, expiresAt: end, daysLeft: left, invalid: !!(c.text && !p) || !!(p && p.product !== product) };
  }
  const blockedMsg = s => ({ expired: `라이선스가 ${s.expiresAt}에 만료되어 보기 전용입니다. 연장 후 [라이선스]에서 '지금 확인'을 누르세요.`, suspended: '라이선스 사용이 중지되어 보기 전용입니다. 공급사에 문의하세요.', trial_ended: '무료 체험 기간이 끝나 보기 전용입니다. 라이선스를 등록하세요.' }[s.mode]);

  /** 판매자 서버에서 최신 라이선스 받기 */
  async function check() {
    const c = conf();
    if (!c.code) throw Object.assign(new Error('설치 코드를 먼저 입력하세요.'), { status: 400 });
    let r, body;
    try {
      r = await fetch(server() + '/api/v1/check', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ code: c.code, bizRegNos: c.bizNo ? [c.bizNo] : [], product, activeUsers: countActiveUsers(), appVersion, serverUrl: process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : undefined) }) });
      body = await r.json().catch(() => ({}));
    } catch (e) { setSetting('license', { ...conf(), lastError: '라이선스 서버에 연결하지 못했습니다.' }); throw Object.assign(new Error('라이선스 서버에 연결하지 못했습니다. 인터넷 연결을 확인하거나 라이선스 문자열을 붙여 넣으세요.'), { status: 502 }); }
    if (!r.ok) { setSetting('license', { ...conf(), lastError: body.message || '확인 실패' }); throw Object.assign(new Error(body.message || '라이선스 확인에 실패했습니다.'), { status: 400 }); }
    const next = { ...conf(), checkedAt: new Date().toISOString(), lastError: body.license ? null : '아직 이 제품의 라이선스가 발급되지 않았습니다.' };
    if (body.license) { const p = verify(body.license, KEY); if (!p || p.product !== product) throw Object.assign(new Error('받은 라이선스가 올바르지 않습니다.'), { status: 400 }); next.text = body.license; }
    setSetting('license', next);
    return status();
  }
  const auto = () => { if (conf().code) check().catch(() => {}); };
  setTimeout(auto, 5000).unref?.(); setInterval(auto, 6 * 3600e3).unref?.();

  // 보기 전용·사용자 수 제한 — 모든 /api 요청 앞에서
  const OPEN = /^\/(login|logout|me\/password|license(\/.*)?)$/;
  const OUTPUT = /\/(pdf|preview|export|backup)(\/|$|\?)/;
  app.use('/api', (req, res, next) => {
    if (OPEN.test(req.path)) return next();
    const s = status();
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (!s.writable && (write || OUTPUT.test(req.path))) return res.status(403).json({ error: blockedMsg(s), license: s.mode });
    const activating = (req.method === 'POST' && req.path === '/users') || (req.method === 'PUT' && /^\/users\/[^/]+$/.test(req.path) && req.body && (req.body.active === true || req.body.active === 1));
    if (activating && countActiveUsers() >= s.maxUsers) return res.status(403).json({ error: `라이선스 사용자 수(${s.maxUsers}명)를 넘을 수 없습니다. 쓰지 않는 계정을 중지하거나 사용자 수를 늘리세요.`, license: 'users' });
    next();
  });

  app.get('/api/license', auth, (req, res) => res.json({ ...status(), activeUsers: countActiveUsers() }));
  app.put('/api/license', auth, admin, async (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase(); const bizNo = normBiz(req.body?.bizNo);
    if (!/^[A-Z0-9-]{8,40}$/.test(code)) return res.status(400).json({ error: '설치 코드 형식이 올바르지 않습니다.' });
    if (bizNo.length !== 10) return res.status(400).json({ error: '사업자등록번호 10자리를 입력하세요.' });
    setSetting('license', { ...conf(), code, bizNo });
    try { res.json(await check()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/license/check', auth, admin, async (req, res) => { try { res.json(await check()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.post('/api/license/text', auth, admin, (req, res) => {
    const text = String(req.body?.text || '').trim(); const p = verify(text, KEY);
    if (!p) return res.status(400).json({ error: '라이선스 문자열이 올바르지 않습니다(서명 확인 실패).' });
    if (p.product !== product) return res.status(400).json({ error: `이 라이선스는 ${PRODUCTS[p.product] || p.product}용입니다.` });
    const bizNo = conf().bizNo || normBiz(p.bizRegNo);
    if (normBiz(p.bizRegNo) !== bizNo) return res.status(400).json({ error: '입력한 사업자등록번호와 라이선스의 사업자등록번호가 다릅니다.' });
    setSetting('license', { ...conf(), text, bizNo, checkedAt: new Date().toISOString(), lastError: null });
    res.json(status());
  });
  return { status, check };
};
module.exports.verify = verify;
