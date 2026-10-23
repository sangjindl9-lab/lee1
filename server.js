'use strict';
/**
 * SS-ERP 라이선스 발급 관리 (판매자 전용)
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

const env = (k, d) => (process.env[k] ?? d);
const PORT = Number(env('PORT', 8080));
const PROD = env('NODE_ENV') === 'production';

function buildApp({ pool, privateKey, adminPassword, sessionSecret }) {
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
  app.use(express.json({ limit: '64kb' }));
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
    select c.*, l.id as lic_row_id, l.license_id, l.kind as lic_kind, l.max_users, l.expires_at, l.issued_at as lic_issued_at
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
    current: r.license_id ? { licenseId: r.license_id, kind: r.lic_kind, maxUsers: r.max_users, expiresAt: ymd(r.expires_at), daysLeft: L.daysUntil(ymd(r.expires_at)), issuedAt: r.lic_issued_at } : null,
    state: stateOf(r),
  });
  const shapeLicense = (r) => ({
    id: r.id, customerId: r.customer_id, customerName: r.customer_name, bizRegNo: r.biz_reg_no, licenseId: r.license_id, kind: r.kind, maxUsers: r.max_users,
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
    res.json({ ...c, licenses: lics });
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
    const last = c.license_id ? { maxUsers: c.max_users, expiresAt: ymd(c.expires_at), kind: c.lic_kind } : null;
    if (kind !== 'NEW' && !last) throw bad('먼저 신규 라이선스를 발급해 주세요');
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));

    let maxUsers = Number(b.maxUsers ?? last?.maxUsers ?? 10);
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
      issuedAt: new Date().toISOString(),
      expiresAt,
      modules: ['all'],
      edition,
      deployment: c.deployment,
    };
    const text = L.sign(payload, privateKey);
    if (!L.verify(text, publicKey)) throw bad('서명 확인에 실패했습니다', 500);
    const { rows: [row] } = await q(
      `insert into license(customer_id, license_id, kind, max_users, starts_on, expires_at, edition, amount, memo, license_text, issued_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [c.id, payload.licenseId, kind, maxUsers, startsOn, expiresAt, edition, amount, b.memo ? String(b.memo).slice(0, 500) : null, text, payload.issuedAt],
    );
    const KIND = { NEW: '신규', RENEW: '연장', CHANGE: '변경', SUSPEND: '사용 중지', RESUME: '중지 해제' };
    audit(req, 'LICENSE_ISSUE', `${KIND[kind]} 발급 ${c.name} ${maxUsers}명 ~${expiresAt}${amount ? ` ${amount.toLocaleString('ko-KR')}원` : ''}`);
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
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`SS-ERP_라이선스_${lic.customerName}_${lic.expiresAt}.lic`)}`);
      return res.send(lic.licenseText + '\n');
    }
    res.json(lic);
  }));

  admin.get('/audit', wrap(async (req, res) => {
    res.json((await q('select at, action, summary, ip from audit_log order by id desc limit 300')).rows);
  }));

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
    await q('update customer set last_seen_at = now(), last_active_users = $2, last_app_version = $3 where id = $1', [c.id, users, b.appVersion ? String(b.appVersion).slice(0, 30) : null]);
    const [lic] = (await q('select license_text from license where customer_id = $1 order by issued_at desc limit 1', [c.id])).rows;
    res.json({ license: lic?.license_text ?? null, licensee: c.name });
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
  app.listen(PORT, '0.0.0.0', () => console.log(`SS-ERP 라이선스 발급 관리 시작 :${PORT}\n판매자 공개키:\n${L.publicKeyPem(privateKey)}`));
}

if (require.main === module) main().catch((e) => {
  console.error(e);
  process.exit(1);
});

module.exports = { buildApp };
