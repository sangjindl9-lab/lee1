'use strict';
/**
 * 이음ERP 라이선스 발급 관리 (판매자 전용)
 *
 * 환경변수
 *   DATABASE_URL         PostgreSQL 주소
 *   LICENSE_PRIVATE_KEY  판매자 서명 비밀키 (Ed25519 PEM 을 base64 로 인코딩). 유출되면 누구나 라이선스를 만들 수 있다
 *   ADMIN_PASSWORD       처음 관리자 비밀번호 (화면 '설정'에서 바꾸면 그 뒤로는 바뀐 비밀번호만 쓰임)
 *   SESSION_SECRET       로그인 쿠키 서명용 무작위 문자열 (32자 이상)
 *   PORT                 기본 8080
 */
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { createPool, migrate } = require('./lib/db');
const L = require('./lib/license');
const R = require('./lib/railway');
const G = require('./lib/github');
const B = require('./lib/backup');

const env = (k, d) => (process.env[k] ?? d);
const PORT = Number(env('PORT', 8080));
const PROD = env('NODE_ENV') === 'production';

function buildApp({ pool, privateKey, adminPassword, sessionSecret, railwayEndpoint, railwaySleep, railwayWaitMs, githubEndpoint, githubTokenEnv = env('GITHUB_TOKEN'), publicUrl = env('PUBLIC_URL', 'https://ss-license-production.up.railway.app') }) {
  const publicKey = crypto.createPublicKey(privateKey);
  const publicPem = L.publicKeyPem(privateKey);
  // ── 관리자 비밀번호 ──
  //  처음에는 ADMIN_PASSWORD 환경변수로 로그인하고, 화면에서 바꾸면 DB에 저장된 값(scrypt)을 쓴다.
  //  비밀번호를 바꾸면 세션 버전이 올라가 다른 곳에 로그인된 세션은 모두 끊긴다.
  const envHash = crypto.scryptSync(adminPassword, 'ss-license-portal', 32);
  const hashPw = (pw) => {
    const salt = crypto.randomBytes(16);
    return `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(pw, salt, 32).toString('base64url')}`;
  };
  const checkPw = (pw, stored) => {
    if (!stored) return crypto.timingSafeEqual(crypto.scryptSync(String(pw), 'ss-license-portal', 32), envHash);
    const [, salt, hash] = stored.split('$');
    const given = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), 32);
    const want = Buffer.from(hash, 'base64url');
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  };
  let authCache = null;
  const auth = async () => {
    if (authCache) return authCache;
    const rows = (await pool.query(`select key, value from portal_setting where key in ('admin_password', 'session_version')`)).rows;
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    authCache = { stored: m.admin_password ?? null, ver: Number(m.session_version ?? 0), changedAt: null };
    return authCache;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // 수정 요청·댓글은 첨부 파일(base64)을 함께 받으므로 그 두 경로만 본문 한도를 크게 둔다
  const smallJson = express.json({ limit: '64kb' });
  const bigJson = express.json({ limit: '40mb' });
  const isUpload = (req) => req.method === 'POST' && (/^\/api\/admin\/(customers\/[^/]+\/requests|requests|requests\/[^/]+\/comments)$/.test(req.path) || req.path === '/api/v1/support');
  app.use((req, res, next) => (isUpload(req) ? bigJson : smallJson)(req, res, next));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'");
    next();
  });

  const q = (text, params) => pool.query(text, params);
  const audit = (req, action, summary) => q('insert into audit_log(action, summary, ip) values ($1,$2,$3)', [action, summary, req.ip ?? null]).catch(() => undefined);

  // ── 로그인 (관리자 1명) ─────────────────────────────────────────
  const SESSION_HOURS = 12;
  const signSession = (data) => {
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    const mac = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
    return `${body}.${mac}`;
  };
  const readSession = (raw) => {
    if (!raw) return null;
    const [body, mac] = raw.split('.');
    if (!body || !mac) return null;
    const expect = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
    if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  };
  const cookie = (req, name) => {
    const m = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(name + '='));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
  };
  const setSessionCookie = (res, value, maxAgeSec) => {
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${PROD ? '; Secure' : ''}`);
  };

  // 로그인 실패 제한: 같은 IP 15분에 5회
  const fails = new Map();
  const tooMany = (ip) => {
    const f = fails.get(ip);
    return f && f.n >= 5 && Date.now() - f.at < 15 * 60_000;
  };

  app.post('/api/admin/login', async (req, res) => {
    const ip = req.ip ?? '';
    if (tooMany(ip)) return res.status(429).json({ message: '로그인 실패가 많아 15분 동안 잠겼습니다' });
    const a = await auth();
    if (!checkPw(req.body?.password ?? '', a.stored)) {
      const f = fails.get(ip) ?? { n: 0, at: Date.now() };
      fails.set(ip, { n: f.n + 1, at: Date.now() });
      audit(req, 'LOGIN_FAIL', '관리자 로그인 실패');
      return res.status(401).json({ message: '비밀번호가 맞지 않습니다' });
    }
    fails.delete(ip);
    setSessionCookie(res, signSession({ exp: Date.now() + SESSION_HOURS * 3600_000, v: a.ver }), SESSION_HOURS * 3600);
    audit(req, 'LOGIN', '관리자 로그인');
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    setSessionCookie(res, '', 0);
    res.json({ ok: true });
  });

  // 관리자 API: 로그인 쿠키 + (변경 요청은) 사용자 지정 헤더 — 다른 사이트에서 위조 요청을 보낼 수 없게
  const admin = express.Router();
  admin.use(async (req, res, next) => {
    const sess = readSession(cookie(req, 'sid'));
    if (!sess || (sess.v ?? 0) !== (await auth()).ver) return res.status(401).json({ message: '로그인이 필요합니다' });
    if (req.method !== 'GET' && req.get('x-portal') !== '1') return res.status(403).json({ message: '요청이 올바르지 않습니다' });
    next();
  });
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === '23505') return res.status(409).json({ message: '이미 등록된 사업자등록번호입니다' });
    console.error(e);
    res.status(500).json({ message: '처리 중 오류가 발생했습니다' });
  });
  const bad = (message, status = 400) => Object.assign(new Error(message), { status });

  admin.get('/me', wrap(async (req, res) => {
    const a = await auth();
    const [row] = (await q(`select updated_at from portal_setting where key = 'admin_password'`)).rows;
    res.json({ ok: true, publicKey: publicPem, passwordChangedAt: row?.updated_at ?? null });
  }));

  /** 관리자 비밀번호 변경 — 현재 비밀번호 확인, 변경 후 다른 세션은 모두 로그아웃 */
  admin.post('/password', wrap(async (req, res) => {
    const a = await auth();
    const current = String(req.body?.current ?? '');
    const next = String(req.body?.next ?? '');
    if (!checkPw(current, a.stored)) {
      audit(req, 'PASSWORD_FAIL', '비밀번호 변경 실패 (현재 비밀번호 불일치)');
      throw bad('현재 비밀번호가 맞지 않습니다');
    }
    if (next.length < 12) throw bad('새 비밀번호는 12자 이상이어야 합니다');
    if (next.length > 200) throw bad('새 비밀번호가 너무 깁니다');
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(next)).length;
    if (kinds < 3) throw bad('영문 대문자·소문자·숫자·특수문자 중 3가지 이상을 섞어 주세요');
    if (next === current) throw bad('지금과 다른 비밀번호를 입력해 주세요');
    const ver = a.ver + 1;
    await q(
      `insert into portal_setting(key, value) values ('admin_password', $1), ('session_version', $2)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [hashPw(next), String(ver)],
    );
    authCache = null;
    audit(req, 'PASSWORD_CHANGE', '관리자 비밀번호 변경');
    // 지금 쓰는 화면은 새 세션으로 이어서 사용
    setSessionCookie(res, signSession({ exp: Date.now() + SESSION_HOURS * 3600_000, v: ver }), SESSION_HOURS * 3600);
    res.json({ ok: true });
  }));

  /** 고객별 최신 라이선스와 상태 */
  const CUSTOMER_STATE_SQL = `
    select c.*, l.id as lic_row_id, l.license_id, l.kind as lic_kind, l.max_users, l.storage_mb, l.modules as lic_modules, l.expires_at, l.issued_at as lic_issued_at
    from customer c
    left join lateral (select * from license where customer_id = c.id order by issued_at desc limit 1) l on true`;
  const ymd = (d) => (d ? (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
  const stateOf = (r) => {
    if (!r.license_id) return 'NONE';
    if (r.lic_kind === 'SUSPEND') return 'SUSPENDED';
    const d = L.daysUntil(ymd(r.expires_at));
    if (d < 0) return 'EXPIRED';
    if (d <= 30) return 'EXPIRING';
    return 'ACTIVE';
  };
  const shapeCustomer = (r) => ({
    id: r.id, name: r.name, bizRegNo: r.biz_reg_no, ceoName: r.ceo_name, contactName: r.contact_name, phone: r.phone, email: r.email,
    deployment: r.deployment, serverUrl: r.server_url, activationCode: r.activation_code, memo: r.memo,
    createdAt: r.created_at, lastSeenAt: r.last_seen_at, lastActiveUsers: r.last_active_users, lastAppVersion: r.last_app_version,
    stage: r.stage ?? (r.license_id ? '운영중' : '리드'),
    usedMB: r.last_used_mb, storageCheckedAt: r.last_storage_at,
    current: r.license_id ? { licenseId: r.license_id, kind: r.lic_kind, maxUsers: r.max_users, storageMB: r.storage_mb, modules: r.lic_modules ?? [], expiresAt: ymd(r.expires_at), daysLeft: L.daysUntil(ymd(r.expires_at)), issuedAt: r.lic_issued_at } : null,
    state: stateOf(r),
  });
  const shapeLicense = (r) => ({
    id: r.id, customerId: r.customer_id, customerName: r.customer_name, bizRegNo: r.biz_reg_no, licenseId: r.license_id, kind: r.kind, maxUsers: r.max_users, storageMB: r.storage_mb,
    startsOn: ymd(r.starts_on), expiresAt: ymd(r.expires_at), edition: r.edition, amount: Number(r.amount), memo: r.memo, issuedAt: r.issued_at, licenseText: r.license_text,
  });

  admin.get('/summary', wrap(async (req, res) => {
    const rows = (await q(CUSTOMER_STATE_SQL + ' order by c.name')).rows.map(shapeCustomer);
    const year = L.kstToday().slice(0, 4);
    const [rev] = (await q(`select coalesce(sum(amount),0)::bigint as total, count(*)::int as n from license where to_char(issued_at at time zone 'Asia/Seoul','YYYY') = $1`, [year])).rows;
    const recent = (await q(`select l.*, c.name as customer_name, c.biz_reg_no from license l join customer c on c.id = l.customer_id order by l.issued_at desc limit 8`)).rows.map(shapeLicense);
    const count = (s) => rows.filter((r) => r.state === s).length;
    res.json({
      customers: rows.length,
      active: count('ACTIVE') + count('EXPIRING'),
      expiring: rows.filter((r) => r.state === 'EXPIRING').sort((a, b) => a.current.daysLeft - b.current.daysLeft),
      expired: rows.filter((r) => r.state === 'EXPIRED'),
      suspended: count('SUSPENDED'),
      none: count('NONE'),
      seats: rows.filter((r) => r.state === 'ACTIVE' || r.state === 'EXPIRING').reduce((a, r) => a + r.current.maxUsers, 0),
      revenueYear: { year, total: Number(rev.total), issues: rev.n },
      recent: recent.map(({ licenseText, ...x }) => x),
    });
  }));

  admin.get('/customers', wrap(async (req, res) => {
    const term = String(req.query.q ?? '').trim();
    const params = [];
    let where = '';
    if (term) {
      params.push(`%${term}%`, `%${L.normBiz(term) || '__none__'}%`);
      where = ' where c.name ilike $1 or c.biz_reg_no like $2 or c.contact_name ilike $1';
    }
    res.json((await q(CUSTOMER_STATE_SQL + where + ' order by c.name', params)).rows.map(shapeCustomer));
  }));

  const CustomerFields = (b) => {
    const name = String(b.name ?? '').trim();
    const biz = L.normBiz(b.bizRegNo);
    if (!name) throw bad('회사명을 입력해 주세요');
    if (!L.isValidBiz(biz)) throw bad('사업자등록번호가 올바르지 않습니다 (10자리, 체크섬 확인)');
    const deployment = b.deployment === 'ONPREM' ? 'ONPREM' : 'HOSTED';
    const t = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);
    return { name: name.slice(0, 100), biz, ceo: t(b.ceoName, 50), contact: t(b.contactName, 50), phone: t(b.phone, 30), email: t(b.email, 100), deployment, serverUrl: t(b.serverUrl, 300), memo: t(b.memo, 2000) };
  };

  admin.post('/customers', wrap(async (req, res) => {
    const f = CustomerFields(req.body ?? {});
    const { rows: [c] } = await q(
      `insert into customer(name, biz_reg_no, ceo_name, contact_name, phone, email, deployment, server_url, memo, activation_code)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [f.name, f.biz, f.ceo, f.contact, f.phone, f.email, f.deployment, f.serverUrl, f.memo, L.activationCode()],
    );
    audit(req, 'CUSTOMER_CREATE', `고객 등록 ${f.name} (${f.biz})`);
    res.status(201).json({ id: c.id });
  }));

  const loadCustomer = async (id) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('고객을 찾을 수 없습니다', 404);
    const r = (await q(CUSTOMER_STATE_SQL + ' where c.id = $1', [id])).rows[0];
    if (!r) throw bad('고객을 찾을 수 없습니다', 404);
    return r;
  };

  admin.get('/customers/:id', wrap(async (req, res) => {
    const c = shapeCustomer(await loadCustomer(req.params.id));
    const lics = (await q(`select l.*, c.name as customer_name, c.biz_reg_no from license l join customer c on c.id = l.customer_id where l.customer_id = $1 order by l.issued_at desc`, [c.id])).rows.map(shapeLicense);
    res.json({ ...c, licenses: lics, server: shapeJob(await loadJob(c.id)) });
  }));

  admin.put('/customers/:id', wrap(async (req, res) => {
    const before = await loadCustomer(req.params.id);
    const f = CustomerFields(req.body ?? {});
    if (f.biz !== before.biz_reg_no && before.license_id) throw bad('라이선스가 발급된 고객은 사업자등록번호를 바꿀 수 없습니다. 새 고객으로 등록해 주세요');
    await q(
      `update customer set name=$2, biz_reg_no=$3, ceo_name=$4, contact_name=$5, phone=$6, email=$7, deployment=$8, server_url=$9, memo=$10, updated_at=now() where id=$1`,
      [before.id, f.name, f.biz, f.ceo, f.contact, f.phone, f.email, f.deployment, f.serverUrl, f.memo],
    );
    audit(req, 'CUSTOMER_UPDATE', `고객 정보 수정 ${f.name}`);
    res.json({ ok: true });
  }));

  admin.post('/customers/:id/code', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    const code = L.activationCode();
    await q('update customer set activation_code=$2, updated_at=now() where id=$1', [c.id, code]);
    audit(req, 'CODE_RESET', `설치 코드 재발급 ${c.name}`);
    res.json({ activationCode: code });
  }));

  /**
   * 라이선스 발급
   *   NEW     새 계약 (기본: 오늘부터 1년)
   *   RENEW   연장 (기본: 현재 만료일 다음 날부터 1년. 이미 만료됐으면 오늘부터)
   *   CHANGE  사용자 수 등 변경 (만료일 유지)
   *   SUSPEND 사용 중지 (만료일을 어제로 재발급 → 고객 서버가 조회 전용으로 바뀜)
   *   RESUME  중지 해제 (중지 전 만료일로 재발급)
   */
  admin.post('/customers/:id/licenses', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    const b = req.body ?? {};
    const kind = String(b.kind ?? 'NEW');
    if (!['NEW', 'RENEW', 'CHANGE', 'SUSPEND', 'RESUME'].includes(kind)) throw bad('발급 종류가 올바르지 않습니다');
    const today = L.kstToday();
    const last = c.license_id ? { maxUsers: c.max_users, storageMB: c.storage_mb, modules: c.lic_modules ?? [], expiresAt: ymd(c.expires_at), kind: c.lic_kind } : null;
    if (kind !== 'NEW' && !last) throw bad('먼저 신규 라이선스를 발급해 주세요');
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));

    let maxUsers = Number(b.maxUsers ?? last?.maxUsers ?? 10);
    // 저장 용량 — 화면은 GB 로 받는다. 기본 1GB, 연장·변경 때 입력이 없으면 기존 용량 유지
    const storageMB = b.storageGB != null && b.storageGB !== '' ? Math.round(Number(b.storageGB) * 1024) : (last?.storageMB ?? 1024);
    if (!Number.isInteger(storageMB) || storageMB < 256 || storageMB > 1024 * 1024) throw bad('저장 용량은 0.25GB~1024GB 사이로 입력해 주세요');
    // 고객 맞춤 모듈 — 이 고객 서버에서만 켜지는 기능. 입력이 없으면 기존 것 유지
    const modules = b.modules != null ? [...new Set((Array.isArray(b.modules) ? b.modules : String(b.modules).split(/[,\s]+/)).map((m) => String(m).trim().toLowerCase()).filter(Boolean))] : (last?.modules ?? []);
    if (modules.some((m) => !/^[a-z0-9][a-z0-9-]{1,39}$/.test(m) || m === 'all')) throw bad('모듈 이름은 영문 소문자·숫자·- 로 적어 주세요 (예: samwoo-cable)');
    let startsOn;
    let expiresAt;
    if (kind === 'NEW') {
      startsOn = isDate(b.startsOn) ? b.startsOn : today;
      expiresAt = isDate(b.expiresAt) ? b.expiresAt : L.oneYearFrom(startsOn, Number(b.years ?? 1));
    } else if (kind === 'RENEW') {
      if (last.kind === 'SUSPEND') throw bad('사용 중지된 고객입니다. 먼저 중지를 해제해 주세요');
      const base = L.daysUntil(last.expiresAt) >= 0 ? L.addDays(last.expiresAt, 1) : today;
      startsOn = isDate(b.startsOn) ? b.startsOn : base;
      expiresAt = isDate(b.expiresAt) ? b.expiresAt : L.oneYearFrom(startsOn, Number(b.years ?? 1));
    } else if (kind === 'CHANGE') {
      if (last.kind === 'SUSPEND') throw bad('사용 중지된 고객입니다. 먼저 중지를 해제해 주세요');
      startsOn = today;
      expiresAt = isDate(b.expiresAt) ? b.expiresAt : last.expiresAt;
    } else if (kind === 'SUSPEND') {
      if (last.kind === 'SUSPEND') throw bad('이미 사용 중지된 고객입니다');
      maxUsers = last.maxUsers;
      startsOn = today;
      expiresAt = L.addDays(today, -1);
    } else {
      if (last.kind !== 'SUSPEND') throw bad('사용 중지된 고객이 아닙니다');
      const [prev] = (await q(`select expires_at from license where customer_id=$1 and kind <> 'SUSPEND' order by issued_at desc limit 1`, [c.id])).rows;
      maxUsers = last.maxUsers;
      startsOn = today;
      expiresAt = isDate(b.expiresAt) ? b.expiresAt : ymd(prev.expires_at);
    }
    if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 10000) throw bad('사용자 수는 1~10000 사이로 입력해 주세요');
    if (kind !== 'SUSPEND' && expiresAt < today) throw bad('만료일이 오늘보다 이릅니다');
    if (kind !== 'SUSPEND' && expiresAt < startsOn) throw bad('만료일이 시작일보다 이릅니다');
    const amount = kind === 'SUSPEND' || kind === 'RESUME' ? 0 : Math.max(0, Math.round(Number(b.amount ?? 0)) || 0);
    const edition = String(b.edition ?? 'standard').slice(0, 30);

    const payload = {
      licenseId: crypto.randomUUID(),
      licensee: c.name,
      bizRegNo: c.biz_reg_no,
      maxUsers,
      storageMB,
      issuedAt: new Date().toISOString(),
      expiresAt,
      modules: ['all', ...modules],
      edition,
      deployment: c.deployment,
    };
    const text = L.sign(payload, privateKey);
    if (!L.verify(text, publicKey)) throw bad('서명 확인에 실패했습니다', 500);
    const { rows: [row] } = await q(
      `insert into license(customer_id, license_id, kind, max_users, starts_on, expires_at, edition, amount, memo, license_text, issued_at, storage_mb, modules)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [c.id, payload.licenseId, kind, maxUsers, startsOn, expiresAt, edition, amount, b.memo ? String(b.memo).slice(0, 500) : null, text, payload.issuedAt, storageMB, JSON.stringify(modules)],
    );
    const KIND = { NEW: '신규', RENEW: '연장', CHANGE: '변경', SUSPEND: '사용 중지', RESUME: '중지 해제' };
    audit(req, 'LICENSE_ISSUE', `${KIND[kind]} 발급 ${c.name} ${maxUsers}명 ${+(storageMB / 1024).toFixed(2)}GB ~${expiresAt}${modules.length ? ` 맞춤모듈 ${modules.join(',')}` : ''}${amount ? ` ${amount.toLocaleString('ko-KR')}원` : ''}`);
    res.status(201).json(shapeLicense({ ...row, customer_name: c.name, biz_reg_no: c.biz_reg_no }));
  }));

  admin.get('/licenses', wrap(async (req, res) => {
    const rows = (await q(`select l.*, c.name as customer_name, c.biz_reg_no from license l join customer c on c.id = l.customer_id order by l.issued_at desc limit 2000`)).rows.map(shapeLicense);
    if (req.query.format === 'csv') {
      const KIND = { NEW: '신규', RENEW: '연장', CHANGE: '변경', SUSPEND: '사용중지', RESUME: '중지해제' };
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['발급일시', '고객', '사업자등록번호', '종류', '사용자수', '시작일', '만료일', '금액', '메모', '라이선스번호'].map(esc).join(',')];
      for (const r of rows) {
        const at = new Date(new Date(r.issuedAt).getTime() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);
        lines.push([at, r.customerName, r.bizRegNo, KIND[r.kind], r.maxUsers, r.startsOn, r.expiresAt, r.amount, r.memo, r.licenseId].map(esc).join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`라이선스발급대장_${L.kstToday()}.csv`)}`);
      return res.send('﻿' + lines.join('\r\n'));
    }
    res.json(rows.map(({ licenseText, ...x }) => x));
  }));

  admin.get('/licenses/:id', wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw bad('라이선스를 찾을 수 없습니다', 404);
    const [r] = (await q(`select l.*, c.name as customer_name, c.biz_reg_no from license l join customer c on c.id = l.customer_id where l.id = $1`, [req.params.id])).rows;
    if (!r) throw bad('라이선스를 찾을 수 없습니다', 404);
    const lic = shapeLicense(r);
    if (req.query.download) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`이음ERP_라이선스_${lic.customerName}_${lic.expiresAt}.lic`)}`);
      return res.send(lic.licenseText + '\n');
    }
    res.json(lic);
  }));

  admin.get('/audit', wrap(async (req, res) => {
    res.json((await q('select at, action, summary, ip from audit_log order by id desc limit 300')).rows);
  }));

  // ── 고객관리: 영업 단계·계약(전자서명)·과금·상담 ──
  require('./lib/crm')(admin, { q, audit, wrap, bad, loadCustomer });

  // ── 고객 서버(호스팅형) 자동 개설 ─────────────────────────────────
  //  비밀값(고객 DB 비밀번호·암호화 키·관리자 임시 비밀번호·Railway 토큰)은 판매자 서명키에서 만든 키로 암호화해 저장
  const vaultKey = crypto.createHash('sha256').update('ss-license-vault:').update(privateKey.export({ type: 'pkcs8', format: 'der' })).digest();
  const seal = (obj) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
  };
  const unseal = (text) => {
    const [iv, tag, enc] = text.split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
  };
  const setting = async (k) => (await q('select value from portal_setting where key = $1', [k])).rows[0]?.value ?? null;
  const putSetting = (k, v) => q(`insert into portal_setting(key, value) values ($1,$2) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, v]);
  const REGION = env('RAILWAY_REGION', 'asia-southeast1-eqsg3a');
  const railwayConf = async () => {
    const envToken = env('RAILWAY_API_TOKEN');
    const stored = await setting('railway_token');
    const token = envToken || (stored ? unseal(stored).token : null);
    return { token, source: envToken ? 'env' : stored ? 'db' : null, workspaceId: env('RAILWAY_WORKSPACE_ID') || (await setting('railway_workspace_id')) };
  };

  // 고객 첨부파일 공용 저장소 (Railway 버킷 eum-files 등 S3 호환) — 새로 개설하는 호스팅 고객 서버에 넣어 준다
  const filesConf = async () => {
    const stored = await setting('files_s3');
    if (stored) return unseal(stored);
    // 발급 사이트와 같은 Railway 프로젝트의 버킷을 참조 변수로 연결해 둔 경우
    const e = process.env;
    return e.FILES_S3_BUCKET && e.FILES_S3_ACCESS_KEY_ID ? { endpoint: e.FILES_S3_ENDPOINT, bucket: e.FILES_S3_BUCKET, region: e.FILES_S3_REGION || 'auto', accessKeyId: e.FILES_S3_ACCESS_KEY_ID, secretAccessKey: e.FILES_S3_SECRET_ACCESS_KEY } : null;
  };
  /** 고객 서버 외부 백업 — 발급 사이트의 백업 저장소를 고객별 폴더로 나눠 쓴다 */
  const backupConf = () => {
    const e = process.env;
    return e.BACKUP_S3_BUCKET && e.BACKUP_S3_ACCESS_KEY_ID ? { endpoint: e.BACKUP_S3_ENDPOINT, bucket: e.BACKUP_S3_BUCKET, region: e.BACKUP_S3_REGION || 'auto', accessKeyId: e.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: e.BACKUP_S3_SECRET_ACCESS_KEY } : null;
  };
  admin.get('/backup-status', wrap(async (req, res) => {
    const last = await setting('portal_backup_last');
    res.json({ configured: B.configured(), last: last ? JSON.parse(last) : null });
  }));
  admin.post('/backup-now', wrap(async (req, res) => {
    let r;
    try { r = await B.runBackup(pool); } catch (e) { r = { ok: false, message: `발급 사이트 백업 실패: ${e.message}` }; }
    await putSetting('portal_backup_last', JSON.stringify({ ...r, at: new Date().toISOString() }));
    audit(req, 'BACKUP', r.message);
    if (!r.ok) throw bad(r.message, 502);
    res.json(r);
  }));
  admin.get('/files-storage', wrap(async (req, res) => {
    const c = await filesConf();
    res.json({ connected: !!c, endpoint: c?.endpoint ?? null, bucket: c?.bucket ?? null, source: (await setting('files_s3')) ? 'db' : c ? 'env' : null });
  }));
  admin.put('/files-storage', wrap(async (req, res) => {
    const b = req.body ?? {};
    const v = { endpoint: String(b.endpoint ?? '').trim(), bucket: String(b.bucket ?? '').trim(), region: String(b.region ?? 'auto').trim() || 'auto', accessKeyId: String(b.accessKeyId ?? '').trim(), secretAccessKey: String(b.secretAccessKey ?? '').trim() };
    if (!/^https:\/\/\S+$/.test(v.endpoint)) throw bad('엔드포인트는 https:// 로 시작해야 합니다');
    if (!v.bucket || !v.accessKeyId || !v.secretAccessKey) throw bad('버킷 이름, 접근 키, 비밀 키를 모두 넣어 주세요');
    await putSetting('files_s3', seal(v));
    audit(req, 'FILES_STORAGE', `파일 저장소 연결 ${v.bucket}`);
    res.json({ ok: true });
  }));

  admin.get('/railway', wrap(async (req, res) => {
    const c = await railwayConf();
    res.json({ connected: !!c.token, source: c.source, workspaceId: c.workspaceId, region: REGION });
  }));

  admin.put('/railway', wrap(async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const workspaceId = String(req.body?.workspaceId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw bad('워크스페이스 ID 형식이 올바르지 않습니다');
    const cur = await railwayConf();
    const useToken = token || cur.token;
    if (!useToken) throw bad('Railway 토큰을 입력해 주세요');
    try {
      const r = await R.client(useToken, railwayEndpoint)(`query($w: String!) { workspace(workspaceId: $w) { id name } }`, { w: workspaceId });
      if (!r.workspace?.id) throw new Error('워크스페이스를 찾을 수 없습니다');
    } catch (e) {
      throw bad(`Railway 연결 확인 실패: ${e.message}`);
    }
    if (token) await putSetting('railway_token', seal({ token }));
    await putSetting('railway_workspace_id', workspaceId);
    audit(req, 'RAILWAY_CONNECT', 'Railway 연결 설정');
    res.json({ ok: true });
  }));

  const shapeJob = (j) => j && ({
    status: j.status, step: j.step, error: j.error, createdAt: j.created_at, finishedAt: j.finished_at,
    url: j.data?.domain ? `https://${j.data.domain}` : null, adminId: j.input.adminId, companyCode: j.input.companyCode,
    projectId: j.data?.projectId ?? null, projectName: j.input?.projectName ?? null,
    steps: R.STEPS.map(([key, label]) => ({ key, label })),
  });
  const loadJob = async (customerId) => (await q('select * from server_job where customer_id = $1', [customerId])).rows[0] ?? null;

  const running = new Set();
  async function runJob(customerId) {
    if (running.has(customerId)) return;
    running.add(customerId);
    try {
      const j = await loadJob(customerId);
      if (!j || j.status !== 'RUNNING') return;
      const conf = await railwayConf();
      if (!conf.token) throw new Error('Railway 연결이 설정되지 않았습니다 (설정 > Railway 연결)');
      const job = { data: j.data ?? {}, input: j.input, secrets: unseal(j.secrets) };
      await R.provision(job, {
        gql: R.client(conf.token, railwayEndpoint),
        workspaceId: conf.workspaceId,
        region: REGION,
        repo: env('ERP_REPO', 'sangjindl9-lab/sspower'),
        branch: env('ERP_BRANCH', 'ss-erp'),
        dockerfilePath: 'deploy/render/Dockerfile',
        licenseServerUrl: publicUrl,
        s3: await filesConf(),
        backup: backupConf(),
        sleep: railwaySleep,
        waitTimeoutMs: railwayWaitMs,
        onStep: (step, data) => q('update server_job set step = $2, data = $3, updated_at = now() where customer_id = $1', [customerId, step, data]),
      });
      await q(`update server_job set status = 'DONE', step = 'done', data = $2, error = null, updated_at = now(), finished_at = now() where customer_id = $1`, [customerId, job.data]);
      await q('update customer set server_url = $2, updated_at = now() where id = $1', [customerId, `https://${job.data.domain}`]);
      await R.lockAutoDeploy(R.client(conf.token, railwayEndpoint), job.data).catch((e) => console.error('자동 배포 끄기 실패', e.message));
      await q('insert into audit_log(action, summary) values ($1,$2)', ['SERVER_DONE', `고객 서버 개설 완료 ${j.input.companyName} https://${job.data.domain}`]);
    } catch (e) {
      console.error('고객 서버 개설 실패', e);
      await q(`update server_job set status = 'FAILED', error = $2, updated_at = now() where customer_id = $1`, [customerId, String(e.message).slice(0, 1000)]).catch(() => undefined);
    } finally {
      running.delete(customerId);
    }
  }
  app.locals.resumeJobs = async () => {
    for (const r of (await q(`select customer_id from server_job where status = 'RUNNING'`)).rows) void runJob(r.customer_id);
  };
  app.locals.idle = async () => { while (running.size) await new Promise((r) => setTimeout(r, 20)); };

  admin.get('/customers/:id/server', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    res.json(shapeJob(await loadJob(c.id)));
  }));

  admin.post('/customers/:id/server', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    if (c.deployment !== 'HOSTED') throw bad('호스팅형 고객만 서버를 개설할 수 있습니다');
    if (!c.license_id) throw bad('먼저 라이선스를 발급해 주세요');
    if (c.lic_kind === 'SUSPEND') throw bad('사용 중지된 고객입니다');
    if (await loadJob(c.id)) throw bad('이미 서버 개설을 진행했습니다');
    if (!(await railwayConf()).token) throw bad('먼저 설정 > Railway 연결을 마쳐 주세요');
    const adminId = String(req.body?.adminId ?? 'admin').trim().toLowerCase();
    if (!/^[a-z0-9._-]{4,32}$/.test(adminId)) throw bad('관리자 아이디는 영문 소문자·숫자·._- 4~32자입니다');
    const companyCode = String(req.body?.companyCode ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(companyCode)) throw bad('회사 코드는 영문 대문자·숫자 2~10자입니다 (예: HN)');
    const slug = `erp-${companyCode.toLowerCase()}-${c.biz_reg_no.slice(-4)}`;
    const input = { companyName: c.name, bizRegNo: c.biz_reg_no, companyCode, adminId, activationCode: c.activation_code, projectName: slug };
    const secrets = { dbPassword: crypto.randomBytes(24).toString('base64url'), encryptionKey: crypto.randomBytes(32).toString('hex'), adminPassword: R.tempPassword() };
    await q(`insert into server_job(customer_id, status, step, input, secrets) values ($1,'RUNNING','project',$2,$3)`, [c.id, input, seal(secrets)]);
    audit(req, 'SERVER_START', `고객 서버 개설 시작 ${c.name} (관리자 ${adminId})`);
    void runJob(c.id);
    // 접속 주소는 처음 몇 단계(수십 초) 안에 정해지므로, 주소가 나올 때까지 기다렸다가 응답한다 (설치 자체는 계속 진행)
    let j = await loadJob(c.id);
    for (let i = 0; i < 120 && !j.data?.domain && j.status === 'RUNNING'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      j = await loadJob(c.id);
    }
    res.status(202).json(shapeJob(j));
  }));

  admin.post('/customers/:id/server/retry', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    const j = await loadJob(c.id);
    if (!j) throw bad('개설 기록이 없습니다');
    if (j.status !== 'FAILED') throw bad('실패한 개설만 다시 시도할 수 있습니다');
    await q(`update server_job set status = 'RUNNING', error = null, updated_at = now() where customer_id = $1`, [c.id]);
    audit(req, 'SERVER_RETRY', `고객 서버 개설 다시 시도 ${c.name}`);
    void runJob(c.id);
    res.status(202).json(shapeJob(await loadJob(c.id)));
  }));

  /**
   * 고객 ERP 접속 — 판매자 키로 2분짜리 접속 티켓에 서명해 고객 서버의 공급사 지원 계정(ss-vendor)으로 들어간다.
   * 고객 비밀번호는 필요 없고, 고객 ERP 의 '공급사 원격 지원' 이 허용 상태여야 한다. 고객 서버 감사 로그에 남는다.
   */
  admin.post('/customers/:id/access', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    const j = await loadJob(c.id);
    const base = j?.status === 'DONE' ? `https://${j.data.domain}` : String(c.server_url ?? '').trim();
    if (!/^https?:\/\//.test(base)) throw bad('고객 ERP 접속 주소가 없습니다. 서버를 개설하거나 고객 정보에 접속 주소를 적어 주세요');
    const now = Date.now();
    const ticket = L.sign({ kind: 'vendor-access', bizRegNo: c.biz_reg_no, vendor: '이음소프트', iat: now, exp: now + 2 * 60_000, nonce: crypto.randomBytes(12).toString('hex') }, privateKey);
    audit(req, 'VENDOR_ACCESS', `고객 ERP 접속 ${c.name} (${base})`);
    res.json({ url: `${base.replace(/\/$/, '')}/api/v1/auth/vendor-login?ticket=${encodeURIComponent(ticket)}` });
  }));

  /** 납품서 — 고객에게 전달할 접속 정보 (임시 비밀번호 포함, 열람 기록 남김) */
  admin.get('/customers/:id/delivery', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    const j = await loadJob(c.id);
    if (!j || !j.data?.domain || j.status === 'FAILED') throw bad('접속 주소가 정해진 뒤에 볼 수 있습니다');
    const sec = unseal(j.secrets);
    audit(req, 'DELIVERY_VIEW', `납품서 열람 ${c.name}`);
    const cur = shapeCustomer(c).current;
    res.json({
      name: c.name, bizRegNo: c.biz_reg_no, url: `https://${j.data.domain}`, adminId: j.input.adminId, tempPassword: sec.adminPassword,
      companyCode: j.input.companyCode, license: cur, contact: { name: c.contact_name, phone: c.phone, email: c.email }, issuedOn: L.kstToday(), installing: j.status !== 'DONE',
    });
  }));

  // ── 수정 요청 대장 (GitHub 이슈) ─────────────────────────────────
  const REPO = env('ERP_REPO', 'sangjindl9-lab/sspower');
  const githubConf = async () => {
    const envToken = githubTokenEnv;
    const stored = await setting('github_token');
    const token = envToken || (stored ? unseal(stored).token : null);
    return { token, source: envToken ? 'env' : stored ? 'db' : null, repo: REPO };
  };
  const gh = async () => {
    const c = await githubConf();
    if (!c.token) throw bad('먼저 설정 > GitHub 연결을 마쳐 주세요');
    return G.client(c.token, c.repo, githubEndpoint);
  };

  admin.get('/github', wrap(async (req, res) => {
    const c = await githubConf();
    res.json({ connected: !!c.token, source: c.source, repo: c.repo });
  }));

  admin.put('/github', wrap(async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    if (!token) throw bad('GitHub 토큰을 입력해 주세요');
    try { await G.client(token, REPO, githubEndpoint).check(); } catch (e) { throw bad(`GitHub 연결 확인 실패: ${e.message}`); }
    await putSetting('github_token', seal({ token }));
    audit(req, 'GITHUB_CONNECT', 'GitHub 연결 설정');
    res.json({ ok: true });
  }));

  const shapeRequest = (r) => ({
    id: r.id, customerId: r.customer_id, customerName: r.customer_name ?? null, kind: r.kind, title: r.title, screen: r.screen, deploy: r.deploy,
    type: r.req_type, priority: r.priority, dueOn: r.due_on ? ymd(r.due_on) : null, fileCount: (r.files ?? []).length,
    issueNumber: r.issue_number, issueUrl: r.issue_url, status: r.status, createdAt: r.created_at, closedAt: r.closed_at, deployedAt: r.deployed_at, rolloutId: r.rollout_id,
  });
  const REQ_SQL = `select r.*, c.name as customer_name from request r left join customer c on c.id = r.customer_id`;

  /** 열린 요청의 이슈가 닫혔는지 GitHub에서 확인해 '완료'로 옮긴다 */
  async function syncRequests(rows) {
    const open = rows.filter((r) => r.status === 'REQUESTED' && r.issue_number);
    if (!open.length) return rows;
    let g;
    try { g = await gh(); } catch { return rows; }
    for (const r of open) {
      try {
        const i = await g.getIssue(r.issue_number);
        if (i.state === 'closed') {
          await q(`update request set status = 'DONE', closed_at = $2 where id = $1`, [r.id, i.closed_at]);
          r.status = 'DONE'; r.closed_at = i.closed_at;
        }
      } catch { /* 다음에 다시 */ }
    }
    return rows;
  }

  const FILE_OK = /\.(png|jpe?g|gif|webp|pdf|xlsx?|xlsm|csv|docx?|hwpx?|pptx?|txt|zip|dwg|dxf)$/i;
  const MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 25 * 1024 * 1024, MAX_COUNT = 10;
  const cleanName = (n) => String(n ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  /** 화면에서 받은 첨부(base64)를 검사 → requests 브랜치에 올리고 [{path,name,size,at}] 반환 */
  async function uploadFiles(g, folder, raw, note) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_COUNT) throw bad(`첨부는 한 번에 ${MAX_COUNT}개까지입니다`);
    const files = list.map((f) => {
      const name = cleanName(f?.name);
      if (!name || !FILE_OK.test(name)) throw bad(`올릴 수 없는 파일 형식입니다: ${name || '(이름 없음)'} — 그림·PDF·엑셀·한글·워드·도면·압축 파일만`);
      const buf = Buffer.from(String(f.data ?? ''), 'base64');
      if (!buf.length) throw bad(`빈 파일입니다: ${name}`);
      if (buf.length > MAX_FILE) throw bad(`${name} 이(가) 10MB를 넘습니다`);
      return { name, buf };
    });
    if (files.reduce((a, f) => a + f.buf.length, 0) > MAX_TOTAL) throw bad('첨부 합계가 25MB를 넘습니다');
    const out = [];
    const used = new Set();
    for (const f of files) {
      let name = f.name;
      for (let i = 2; used.has(name); i++) name = f.name.replace(/(\.[^.]+)?$/, `(${i})$1`);
      used.add(name);
      const path = `${folder}/${Date.now().toString(36)}-${name}`;
      await g.putFile(path, f.buf, `${note}: ${name}`).catch((e) => { throw bad(`첨부 올리기 실패 (${name}): ${e.message}. GitHub 토큰에 Contents 쓰기 권한이 있는지 확인하세요`, 502); });
      out.push({ path, name, size: f.buf.length, at: new Date().toISOString() });
    }
    return out;
  }

  async function createRequest(req, customer) {
    const b = req.body ?? {};
    const t = (v, n) => String(v ?? '').trim().slice(0, n);
    const want = t(b.want, 20000);
    if (want.length < 5) throw bad('원하는 것을 적어 주세요');
    const type = G.TYPES.includes(b.type) ? b.type : '기타';
    const priority = G.PRIORITIES.includes(b.priority) ? b.priority : '보통';
    const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(b.dueOn ?? '') ? b.dueOn : null;
    const screen = t(b.screen, 200), now = t(b.now, 5000), criteria = t(b.criteria, 5000);
    const deploy = t(b.deploy, 40) || (customer ? '고객 서버까지' : '우리 ERP까지');
    const title = `${customer ? `[고객 맞춤 — ${customer.name}]` : '[전체 업데이트]'}${priority !== '보통' ? `[${priority}]` : ''} ${b.title ? t(b.title, 80) : want.split('\n')[0].slice(0, 70)}`;
    const g = await gh();
    const folder = `requests/${L.kstToday()}-${crypto.randomBytes(3).toString('hex')}`;
    const files = await uploadFiles(g, folder, b.files, `수정 요청 첨부 ${customer?.name ?? '전체'}`);
    const body = G.issueBody(g, { customer: customer && { name: customer.name, bizRegNo: customer.biz_reg_no, serverUrl: customer.server_url }, type, priority, dueOn, screen, now, want, criteria, deploy, files, folder });
    const labels = [customer ? '고객맞춤' : '전체업데이트', type, ...(customer ? [`고객:${customer.name}`] : []), ...(priority !== '보통' ? [priority] : [])];
    const issue = await g.createIssue(title, body, labels).catch((e) => { throw bad(e.message, 502); });
    const row = (await q(
      `insert into request(customer_id, kind, title, screen, deploy, issue_number, issue_url, req_type, priority, due_on, folder, files) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [customer?.id ?? null, customer ? 'CUSTOMER' : 'GLOBAL', title, screen, deploy, issue.number, issue.html_url, type, priority, dueOn, folder, JSON.stringify(files)],
    )).rows[0];
    audit(req, 'REQUEST', `수정 요청 #${issue.number} ${title}`);
    return shapeRequest({ ...row, customer_name: customer?.name ?? null });
  }

  admin.post('/customers/:id/requests', wrap(async (req, res) => res.status(201).json(await createRequest(req, await loadCustomer(req.params.id)))));
  admin.post('/requests', wrap(async (req, res) => res.status(201).json(await createRequest(req, null))));

  const loadRequest = async (id) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('요청을 찾을 수 없습니다', 404);
    const r = (await q(`${REQ_SQL} where r.id = $1`, [id])).rows[0];
    if (!r) throw bad('요청을 찾을 수 없습니다', 404);
    return r;
  };

  /** 요청 상세 — 이슈 본문과 댓글(Claude의 질문·결과 보고)을 함께 */
  admin.get('/requests/:id', wrap(async (req, res) => {
    const r = (await syncRequests([await loadRequest(req.params.id)]))[0];
    const g = await gh();
    const [issue, comments] = await Promise.all([g.getIssue(r.issue_number), g.comments(r.issue_number)]);
    res.json({
      ...shapeRequest(r), type: r.req_type, priority: r.priority, dueOn: r.due_on ? ymd(r.due_on) : null, files: r.files ?? [],
      issue: { state: issue.state, body: issue.body ?? '', title: issue.title },
      comments: comments.map((c) => ({ id: c.id, author: c.user?.login ?? '', body: c.body ?? '', createdAt: c.created_at })),
    });
  }));

  /** 답변·추가 요청 — 댓글 + 첨부. reopen 이면 닫힌 이슈를 다시 열어 '요청'으로 되돌린다 */
  admin.post('/requests/:id/comments', wrap(async (req, res) => {
    const r = await loadRequest(req.params.id);
    const text = String(req.body?.text ?? '').trim().slice(0, 20000);
    const reopen = !!req.body?.reopen;
    if (!text && !(req.body?.files ?? []).length) throw bad('내용이나 첨부를 넣어 주세요');
    const g = await gh();
    const folder = r.folder ?? `requests/${L.kstToday()}-${crypto.randomBytes(3).toString('hex')}`;
    const files = await uploadFiles(g, folder, req.body?.files, `요청 #${r.issue_number} 추가 첨부`);
    const body = `${reopen ? '**[다시 작업 요청]**\n\n' : ''}${text}${files.length ? `\n\n**첨부**\n${G.fileLines(g, files)}` : ''}\n\n<sub>라이선스 발급 사이트에서 작성</sub>`;
    await g.addComment(r.issue_number, body).catch((e) => { throw bad(e.message, 502); });
    if (reopen) await g.updateIssue(r.issue_number, { state: 'open' }).catch((e) => { throw bad(e.message, 502); });
    await q(`update request set files = files || $2::jsonb, folder = $3 ${reopen ? `, status = 'REQUESTED', closed_at = null, deployed_at = null, rollout_id = null` : ''} where id = $1`, [r.id, JSON.stringify(files), folder]);
    audit(req, 'REQUEST_COMMENT', `요청 #${r.issue_number} ${reopen ? '다시 작업 요청' : '댓글'}${files.length ? ` · 첨부 ${files.length}개` : ''}`);
    res.status(201).json({ ok: true });
  }));

  /** 첨부 내려받기 — 저장소가 비공개라 사이트가 대신 받아서 전달 */
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };
  admin.get('/requests/:id/file', wrap(async (req, res) => {
    const r = await loadRequest(req.params.id);
    const f = (r.files ?? []).find((x) => x.path === req.query.path);
    if (!f) throw bad('파일을 찾을 수 없습니다', 404);
    const buf = await (await gh()).getFile(f.path);
    const ext = f.name.split('.').pop().toLowerCase();
    res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('content-disposition', `${MIME[ext] && req.query.download !== '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('cache-control', 'private, max-age=600');
    res.end(buf);
  }));

  admin.get('/requests', wrap(async (req, res) => {
    const cid = req.query.customerId;
    const rows = (await q(`${REQ_SQL} ${cid ? 'where r.customer_id = $1' : ''} order by r.created_at desc limit 300`, cid ? [cid] : [])).rows;
    res.json({ rows: (await syncRequests(rows)).map(shapeRequest) });
  }));

  // ── 재배포 (고객 서버 하나 / 전체) ────────────────────────────────
  const redeployOne = async (gql, j) => {
    await gql(`mutation($s: String!, $e: String!) { serviceInstanceRedeploy(serviceId: $s, environmentId: $e) }`, { s: j.data.appServiceId, e: j.data.environmentId });
  };
  const deployStatus = async (gql, j) => {
    const r = await gql(`query($input: DeploymentListInput!) { deployments(input: $input, first: 1) { edges { node { id status } } } }`,
      { input: { projectId: j.data.projectId, serviceId: j.data.appServiceId, environmentId: j.data.environmentId } });
    return r.deployments.edges[0]?.node?.status ?? 'UNKNOWN';
  };
  /** 배포가 끝나길 기다린 뒤 그 고객의 '완료' 요청(고객 건 + 전체 건)을 '반영'으로 */
  async function finishDeploy(gql, j, customerId, rolloutId) {
    const deadline = Date.now() + (railwayWaitMs ?? 20 * 60_000);
    let st = 'BUILDING';
    while (Date.now() < deadline) {
      await (railwaySleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(15_000);
      st = await deployStatus(gql, j).catch(() => 'UNKNOWN');
      if (['SUCCESS', 'FAILED', 'CRASHED'].includes(st)) break;
    }
    if (st === 'SUCCESS') {
      await q(`update request set status = 'DEPLOYED', deployed_at = now(), rollout_id = coalesce($2, rollout_id) where status = 'DONE' and (customer_id = $1 or (kind = 'GLOBAL' and $3))`, [customerId, rolloutId, !!rolloutId]);
    }
    return st;
  }

  // 재배포 전에 닫힌 이슈를 '완료'로 맞춰 둬야 배포 뒤 '반영'으로 넘어간다
  const syncOpen = async () => syncRequests((await q(`${REQ_SQL} where r.status = 'REQUESTED'`)).rows);

  admin.post('/customers/:id/redeploy', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    await syncOpen();
    const j = await loadJob(c.id);
    if (!j || j.status !== 'DONE') throw bad('이 사이트에서 개설한 서버만 재배포할 수 있습니다');
    const conf = await railwayConf();
    if (!conf.token) throw bad('먼저 설정 > Railway 연결을 마쳐 주세요');
    const gql = R.client(conf.token, railwayEndpoint);
    // 이 고객만 우리 ERP의 최신 코드로 (고객 맞춤 수정 반영용). 다른 고객 서버는 건드리지 않는다
    const latest = (await R.sourceDeploys(gql, SOURCE, 10)).find((d) => d.status === 'SUCCESS' && d.meta?.commitHash);
    if (!latest) throw bad('우리 ERP에 성공한 배포가 없습니다. 우리 ERP 배포가 끝난 뒤 다시 눌러 주세요');
    const sha = latest.meta.commitHash;
    const rel = await releases();
    const version = rel.find((r) => r.commit_sha === sha)?.version ?? `${rel[0]?.version ?? '0.0.0'}+${sha.slice(0, 7)}`;
    await R.deployVersion(gql, j.data, version, sha);
    audit(req, 'REDEPLOY', `고객 서버 최신 코드 배포 ${c.name} (${version})`);
    void finishDeploy(gql, j, c.id, null).then((st) => st === 'SUCCESS' && q(`update customer set erp_version = $2, erp_version_at = now() where id = $1`, [c.id, version])).catch(() => undefined);
    res.status(202).json({ ok: true, version });
  }));

  const rolling = { current: null };
  /** 고객 서버를 하나씩 배포하고 결과를 rollout 에 기록. deployFn(gql, job) 이 실제 배포, onSuccess(job) 는 성공한 고객마다 */
  async function startRollout(req, jobs, { scope, version, label }, deployFn, onSuccess) {
    if (rolling.current) throw bad('다른 배포가 이미 진행 중입니다');
    const conf = await railwayConf();
    if (!conf.token) throw bad('먼저 설정 > Railway 연결을 마쳐 주세요');
    if (!jobs.length) throw bad('배포할 고객 서버가 없습니다');
    await syncOpen();
    const ro = (await q(`insert into rollout(scope, version, results) values ($1,$2,$3) returning *`, [scope, version ?? null, JSON.stringify(jobs.map((j) => ({ customerId: j.customer_id, name: j.customer_name, status: 'QUEUED' })))])).rows[0];
    audit(req, 'ROLLOUT', `${label} 시작 (${jobs.length}곳)`);
    rolling.current = ro.id;
    (async () => {
      const gql = R.client(conf.token, railwayEndpoint);
      const results = [];
      for (const j of jobs) {
        let status;
        try { await deployFn(gql, j); status = await finishDeploy(gql, j, j.customer_id, ro.id); if (status === 'SUCCESS' && onSuccess) await onSuccess(j); } catch (e) { status = `ERROR: ${e.message}`.slice(0, 200); }
        results.push({ customerId: j.customer_id, name: j.customer_name, status, at: new Date().toISOString() });
        await q(`update rollout set results = $2 where id = $1`, [ro.id, JSON.stringify([...results, ...jobs.slice(results.length).map((x) => ({ customerId: x.customer_id, name: x.customer_name, status: 'QUEUED' }))])]);
      }
      await q(`update rollout set finished_at = now() where id = $1`, [ro.id]);
      await q('insert into audit_log(action, summary) values ($1,$2)', ['ROLLOUT_DONE', `${label} 끝 — 성공 ${results.filter((r) => r.status === 'SUCCESS').length}/${results.length}`]);
      rolling.current = null;
    })().catch((e) => { console.error('배포 실패', e); rolling.current = null; });
    return ro.id;
  }
  const doneJobs = async (ids) => (await q(`select j.*, c.name as customer_name from server_job j join customer c on c.id = j.customer_id where j.status = 'DONE' ${ids ? 'and c.id = any($1)' : ''} order by c.name`, ids ? [ids] : [])).rows;

  admin.post('/rollouts', wrap(async (req, res) => {
    const id = await startRollout(req, await doneJobs(), { scope: 'ALL', label: '고객 서버 전체 재배포' }, redeployOne);
    res.status(202).json({ id });
  }));

  // ── 업데이트 · 버전 관리 ───────────────────────────────────────
  //  우리 ERP(sspower-erp)는 push 하면 바로 바뀌는 개발 서버. "수정 전부 완료"를 누르면 그때 우리 ERP에
  //  성공적으로 배포된 커밋이 새 버전으로 고정되고, 고객 서버는 버전을 골라 배포(되돌리기 포함)한다.
  const SOURCE = {
    projectId: env('ERP_SOURCE_PROJECT_ID', '33efb4e3-90cc-4108-84ae-ba8b55b70167'),
    serviceId: env('ERP_SOURCE_SERVICE_ID', '01550f48-7072-498c-9ca6-0de77556d119'),
    environmentId: env('ERP_SOURCE_ENVIRONMENT_ID', 'db64dd72-4c7e-4c2c-ba69-bfaf4f56cd58'),
  };
  const firstLine = (m) => String(m ?? '').split('\n')[0].trim();
  const shapeRelease = (r) => r && ({ id: r.id, version: r.version, status: r.status, notes: r.notes, changes: r.changes, commitSha: r.commit_sha, createdAt: r.created_at, releasedAt: r.released_at });
  const draftRelease = async () => (await q(`select * from erp_release where status = 'DRAFT' order by created_at limit 1`)).rows[0]
    ?? (await q(`insert into erp_release(status) values ('DRAFT') returning *`)).rows[0];
  const releases = async () => (await q(`select * from erp_release where status = 'RELEASED' order by released_at desc`)).rows;
  const nextVersion = (last, level) => {
    const [a, b, c] = (last ?? '1.0.-1').split('.').map(Number);
    return level === 'major' ? `${a + 1}.0.0` : level === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
  };
  /** 마지막 버전 이후 우리 ERP에 배포 성공한 변경 (커밋 메시지 첫 줄) — 최신순 */
  async function pendingChanges(gql, since) {
    const out = [];
    const seen = new Set();
    for (const d of await R.sourceDeploys(gql, SOURCE)) {
      const sha = d.meta?.commitHash;
      if (!sha || d.status !== 'SUCCESS' && d.status !== 'REMOVED' || seen.has(sha)) continue;
      if (sha === since) break;
      seen.add(sha);
      out.push({ sha, message: firstLine(d.meta.commitMessage), at: d.createdAt });
    }
    return out;
  }

  admin.get('/updates', wrap(async (req, res) => {
    const conf = await railwayConf();
    const draft = await draftRelease();
    const rel = await releases();
    let changes = [], source = null, sourceError = null;
    if (conf.token) {
      try {
        const gql = R.client(conf.token, railwayEndpoint);
        const latest = (await R.sourceDeploys(gql, SOURCE, 1))[0];
        source = latest ? { status: latest.status, sha: latest.meta?.commitHash ?? null, message: firstLine(latest.meta?.commitMessage), at: latest.createdAt } : null;
        changes = await pendingChanges(gql, rel[0]?.commit_sha);
      } catch (e) { sourceError = e.message; }
    }
    const customers = (await q(`select c.id, c.name, c.erp_version, c.erp_version_at, j.status as job_status from customer c left join server_job j on j.customer_id = c.id where c.deployment = 'HOSTED' order by c.name`)).rows;
    const ro = (await q(`select * from rollout where version is not null order by started_at desc limit 10`)).rows;
    res.json({
      draft: shapeRelease(draft), changes, source, sourceError, railway: !!conf.token,
      releases: rel.map(shapeRelease),
      customers: customers.map((c) => ({ id: c.id, name: c.name, version: c.erp_version, versionAt: c.erp_version_at, server: c.job_status === 'DONE' })),
      rollouts: ro.map((r) => ({ id: r.id, version: r.version, scope: r.scope, startedAt: r.started_at, finishedAt: r.finished_at, results: r.results })),
      running: rolling.current,
    });
  }));

  admin.put('/updates/draft', wrap(async (req, res) => {
    const notes = (Array.isArray(req.body?.notes) ? req.body.notes : []).map((x) => String(x ?? '').trim().slice(0, 300)).filter(Boolean).slice(0, 100);
    const d = await draftRelease();
    await q(`update erp_release set notes = $2 where id = $1`, [d.id, JSON.stringify(notes)]);
    res.json({ ok: true });
  }));

  // 수정 전부 완료 → 지금 우리 ERP에 배포된 코드를 새 버전으로 고정
  admin.post('/updates/release', wrap(async (req, res) => {
    const level = ['patch', 'minor', 'major'].includes(req.body?.level) ? req.body.level : 'patch';
    const conf = await railwayConf();
    if (!conf.token) throw bad('먼저 설정 > Railway 연결을 마쳐 주세요');
    const gql = R.client(conf.token, railwayEndpoint);
    const latest = (await R.sourceDeploys(gql, SOURCE, 1))[0];
    if (!latest?.meta?.commitHash) throw bad('우리 ERP 배포 기록을 찾지 못했습니다');
    if (latest.status !== 'SUCCESS') throw bad(`우리 ERP 최신 배포가 아직 끝나지 않았거나 실패했습니다 (${latest.status}). 배포가 성공한 뒤 다시 눌러 주세요`);
    const rel = await releases();
    if (rel[0]?.commit_sha === latest.meta.commitHash) throw bad(`지난 버전(${rel[0].version}) 이후 바뀐 코드가 없습니다`);
    const d = await draftRelease();
    const changes = await pendingChanges(gql, rel[0]?.commit_sha);
    if (!d.notes.length && !changes.length) throw bad('업데이트 내용을 한 줄 이상 적어 주세요');
    const version = nextVersion(rel[0]?.version, level);
    await q(`update erp_release set version = $2, status = 'RELEASED', commit_sha = $3, changes = $4, released_at = now() where id = $1`, [d.id, version, latest.meta.commitHash, JSON.stringify(changes)]);
    audit(req, 'RELEASE', `새 버전 ${version} (${latest.meta.commitHash.slice(0, 7)})`);
    res.status(201).json({ version });
  }));

  // 버전 배포 (전체 또는 고른 고객) — 예전 버전을 고르면 되돌리기
  admin.post('/updates/deploy', wrap(async (req, res) => {
    const r = (await q(`select * from erp_release where version = $1 and status = 'RELEASED'`, [String(req.body?.version ?? '')])).rows[0];
    if (!r) throw bad('그런 버전이 없습니다', 404);
    const ids = Array.isArray(req.body?.customerIds) && req.body.customerIds.length ? req.body.customerIds.map(String) : null;
    const jobs = await doneJobs(ids);
    const id = await startRollout(req, jobs, { scope: ids ? 'SOME' : 'ALL', version: r.version, label: `버전 ${r.version} 배포` },
      (gql, j) => R.deployVersion(gql, j.data, r.version, r.commit_sha),
      (j) => q(`update customer set erp_version = $2, erp_version_at = now() where id = $1`, [j.customer_id, r.version]));
    res.status(202).json({ id });
  }));

  admin.get('/rollouts', wrap(async (req, res) => {
    const rows = (await q(`select * from rollout order by started_at desc limit 20`)).rows;
    res.json({ rows: rows.map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, results: r.results })), running: rolling.current });
  }));
  app.locals.idleRollout = async () => { while (rolling.current) await new Promise((r) => setTimeout(r, 20)); };

  app.use('/api/admin', admin);

  // ── 고객 서버용: 설치 코드로 최신 라이선스 받기 ───────────────────
  const checkHits = new Map();
  app.post('/api/v1/check', wrap(async (req, res) => {
    const ip = req.ip ?? '';
    const h = checkHits.get(ip) ?? { n: 0, at: Date.now() };
    if (Date.now() - h.at > 60_000) Object.assign(h, { n: 0, at: Date.now() });
    h.n += 1;
    checkHits.set(ip, h);
    if (h.n > 30) throw bad('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요', 429);

    const b = req.body ?? {};
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{8,40}$/.test(code)) throw bad('설치 코드 형식이 올바르지 않습니다');
    const [c] = (await q('select * from customer where activation_code = $1', [code])).rows;
    if (!c) throw bad('설치 코드를 찾을 수 없습니다. 공급사에 확인해 주세요', 404);
    const bizNos = Array.isArray(b.bizRegNos) ? b.bizRegNos.map(L.normBiz) : [];
    if (bizNos.length && !bizNos.includes(c.biz_reg_no)) {
      audit(req, 'CHECK_MISMATCH', `설치 코드 사업자번호 불일치 ${c.name} (서버: ${bizNos.join(',')})`);
      throw bad('이 설치 코드는 다른 회사용입니다. 회사 정보의 사업자등록번호를 확인해 주세요', 403);
    }
    const users = Number.isFinite(Number(b.activeUsers)) ? Math.trunc(Number(b.activeUsers)) : null;
    const usedMB = Number.isFinite(Number(b.usedMB)) ? Math.max(0, Math.round(Number(b.usedMB))) : null;
    await q(`update customer set last_seen_at = now(), last_active_users = $2, last_app_version = $3${usedMB != null ? ', last_used_mb = $4, last_storage_at = now()' : ''} where id = $1`,
      usedMB != null ? [c.id, users, b.appVersion ? String(b.appVersion).slice(0, 30) : null, usedMB] : [c.id, users, b.appVersion ? String(b.appVersion).slice(0, 30) : null]);
    const [lic] = (await q('select license_text from license where customer_id = $1 order by issued_at desc limit 1', [c.id])).rows;
    res.json({ license: lic?.license_text ?? null, licensee: c.name });
  }));

  // ── 고객 ERP 의 '고장·수정 요청' — 설치 코드 + 사업자번호로 확인 ─────────────
  const supportCustomer = async (b) => {
    const code = String(b.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{8,40}$/.test(code)) throw bad('설치 코드 형식이 올바르지 않습니다');
    const [c] = (await q('select * from customer where activation_code = $1', [code])).rows;
    if (!c) throw bad('설치 코드를 찾을 수 없습니다', 404);
    const bizNos = (Array.isArray(b.bizRegNos) ? b.bizRegNos : String(b.bizRegNos ?? '').split(',')).map(L.normBiz).filter(Boolean);
    if (!bizNos.includes(c.biz_reg_no)) throw bad('이 설치 코드는 다른 회사용입니다', 403);
    return c;
  };
  const SUPPORT_TYPES = { 고장: '장애', 수정: '기능요청', 문의: '상담' };
  const SUPPORT_FILE = /\.(png|jpe?g|gif|webp|pdf|xlsx?|hwpx?|docx?|zip)$/i;
  const SUPPORT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };
  app.post('/api/v1/support', wrap(async (req, res) => {
    const b = req.body ?? {};
    const c = await supportCustomer(b);
    const s = (v, n) => String(v ?? '').trim().slice(0, n);
    const kind = SUPPORT_TYPES[b.kind] ? b.kind : '수정';
    const title = s(b.title, 200), body = s(b.body, 8000);
    if (!title || body.length < 2) throw bad('제목과 내용을 적어 주세요');
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 5).map((f) => {
      const name = s(f?.name, 120).replace(/[\\/:*?"<>|]/g, '_');
      const buf = Buffer.from(String(f?.data ?? ''), 'base64');
      if (!SUPPORT_FILE.test(name)) throw bad(`올릴 수 없는 파일 형식입니다: ${name}`);
      if (!buf.length || buf.length > 10 * 1024 * 1024) throw bad(`${name}: 파일은 10MB 이하만 올릴 수 있습니다`);
      return { name, buf, mime: SUPPORT_MIME[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream' };
    });
    const requester = [s(b.requester?.name, 40), s(b.requester?.phone, 40), s(b.requester?.email, 100)].filter(Boolean).join(' · ');
    const [t] = (await q(`insert into ticket(customer_id, type, title, body, opened_on, status, source, requester, screen) values ($1,$2,$3,$4,$5,'접수','ERP',$6,$7) returning id`,
      [c.id, SUPPORT_TYPES[kind], `[${kind}] ${title}`, body, L.kstToday(), requester || null, s(b.screen, 200) || null])).rows;
    for (const f of files) await q('insert into ticket_file(ticket_id, name, mime, size, data) values ($1,$2,$3,$4,$5)', [t.id, f.name, f.mime, f.buf.length, f.buf]);
    audit(req, 'SUPPORT_IN', `고객 ERP 요청 ${c.name} · [${kind}] ${title}${files.length ? ` · 첨부 ${files.length}` : ''}`);
    res.status(201).json({ id: t.id });
  }));
  app.get('/api/v1/support', wrap(async (req, res) => {
    const c = await supportCustomer(req.query ?? {});
    const rows = (await q(`select t.id, t.title, t.body, t.screen, t.status, t.reply, t.replied_at, t.opened_on, t.created_at, t.request_id, r.status as req_status,
        (select count(*)::int from ticket_file f where f.ticket_id = t.id) as files
      from ticket t left join request r on r.id = t.request_id where t.customer_id = $1 and t.source = 'ERP' order by t.created_at desc limit 200`, [c.id])).rows;
    // 고객에게 보이는 진행 상태: 접수 대기 → 접수(처리 중) → 완료 / 반영됨
    const stage = (r) => (r.req_status === 'DEPLOYED' ? '반영됨' : r.status === '완료' ? '완료' : r.status === '처리중' ? (r.req_status === 'DONE' ? '수정 완료 · 반영 대기' : '처리 중') : '접수 대기');
    res.json({ rows: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, screen: r.screen, stage: stage(r), reply: r.reply, repliedAt: r.replied_at, createdAt: r.created_at, files: r.files })) });
  }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
  app.use((req, res) => (req.path.startsWith('/api/') ? res.status(404).json({ message: '없는 주소입니다' }) : res.sendFile(path.join(__dirname, 'public', 'index.html'))));
  return app;
}

async function main() {
  const missing = ['DATABASE_URL', 'LICENSE_PRIVATE_KEY', 'ADMIN_PASSWORD', 'SESSION_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`환경변수가 없습니다: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.ADMIN_PASSWORD.length < 12) {
    console.error('ADMIN_PASSWORD 는 12자 이상이어야 합니다');
    process.exit(1);
  }
  const privateKey = L.loadPrivateKey(process.env.LICENSE_PRIVATE_KEY);
  const pool = createPool(process.env.DATABASE_URL);
  for (let i = 0; ; i++) {
    try {
      await migrate(pool);
      break;
    } catch (e) {
      if (i >= 20) throw e;
      console.log(`DB 연결 대기 중… (${e.message})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const app = buildApp({ pool, privateKey, adminPassword: process.env.ADMIN_PASSWORD, sessionSecret: process.env.SESSION_SECRET });
  await app.locals.resumeJobs();
  B.schedule(pool, (r) => pool.query(`insert into portal_setting(key, value) values ('portal_backup_last', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(r)]));
  app.listen(PORT, '0.0.0.0', () => console.log(`이음ERP 라이선스 발급 관리 시작 :${PORT}\n판매자 공개키:\n${L.publicKeyPem(privateKey)}`));
}

if (require.main === module) main().catch((e) => {
  console.error(e);
  process.exit(1);
});

module.exports = { buildApp };
