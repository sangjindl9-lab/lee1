// 외부 공유 링크 — 파일은 서버에 저장하지 않고, 받는 순간 휴대폰(온라인일 때) 또는 클라우드에서 중계합니다.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Readable } from 'node:stream';
import { q, one } from './db.js';
import { accessFor, CloudError } from './cloud.js';

const PUBLIC_URL = () => (process.env.PUBLIC_URL || 'https://fm2-connect-production.up.railway.app').replace(/\/$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => { n = Number(n || 0); if (n < 1024) return n + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return n.toFixed(1) + ' ' + u[i]; };

function within(path, folders) {
  return Array.isArray(folders) && folders.some((f) => path === f || path.startsWith(f.replace(/\/$/, '') + '/'));
}

export function registerShare(app, { auth, wrap, limit, log, ipOf, serverRequest, isOnline }) {
  const bad = (res, s, code, message) => res.status(s).json({ error: code, message });

  app.post('/api/shares', auth, limit(60, 3600e3), wrap(async (req, res) => {
    const b = req.body || {};
    const hours = Math.min(720, Math.max(1, Number(b.expiresHours || 72)));
    const maxDl = b.maxDownloads ? Math.min(1000, Math.max(1, Number(b.maxDownloads))) : null;
    const pw = b.password ? String(b.password) : '';
    if (pw && pw.length < 4) return bad(res, 400, 'weak_password', '비밀번호는 4자 이상으로 해 주세요');
    let target, name, size;
    if (b.kind === 'phone') {
      const perm = req.ctx.kind === 'pc'
        ? await one(`SELECT * FROM device_permissions WHERE android_id=$1 AND pc_id=$2 AND status='approved'`, [b.androidId, req.ctx.device_id])
        : null;
      if (!perm) return bad(res, 403, 'not_permitted', '이 휴대폰에서 승인된 연결이 필요합니다');
      const path = String(b.path || '');
      if (!path.startsWith('/') || path.includes('..') || !within(path, perm.folders)) return bad(res, 403, 'outside', '허용된 폴더 밖의 파일입니다');
      if (!isOnline(perm.android_id)) return bad(res, 409, 'device_offline', '휴대폰이 오프라인입니다');
      const st = await serverRequest(perm.android_id, 'stat', { path }, { folders: perm.folders, readOnly: true });
      if (st.dir) return bad(res, 400, 'is_dir', '폴더는 공유할 수 없습니다. 파일을 선택해 주세요');
      target = { kind: 'phone', androidId: perm.android_id, pcId: req.ctx.device_id, path };
      name = st.name; size = st.size;
    } else if (b.kind === 'cloud') {
      try {
        const { at, P, conn } = await accessFor(req.ctx.user_id, b.connId);
        const st = await P.stat(at, String(b.id));
        if (st.dir) return bad(res, 400, 'is_dir', '폴더는 공유할 수 없습니다. 파일을 선택해 주세요');
        target = { kind: 'cloud', connId: conn.id, provider: conn.provider, id: String(b.id) };
        name = st.name; size = st.size;
      } catch (e) { if (e instanceof CloudError) return bad(res, e.status, e.code, e.message); throw e; }
    } else return bad(res, 400, 'bad_kind', '공유할 파일 종류가 올바르지 않습니다');
    const slug = crypto.randomBytes(18).toString('base64url');
    const row = await one(`INSERT INTO shared_links(user_id, target, pw_hash, expires_at, max_downloads, slug, name, size, created_by)
      VALUES ($1,$2,$3, now() + ($4 || ' hours')::interval, $5,$6,$7,$8,$9) RETURNING *`,
      [req.ctx.user_id, JSON.stringify(target), pw ? await bcrypt.hash(pw, 10) : null, String(hours), maxDl, slug, name, size, req.ctx.device_id]);
    await log(req.ctx.user_id, req.ctx.device_id, 'share_created', `${name} (${target.kind})`, ipOf(req));
    res.json(shareRow(row));
  }));

  app.get('/api/shares', auth, wrap(async (req, res) => {
    const rows = await q(`SELECT * FROM shared_links WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.ctx.user_id]);
    res.json(rows.map(shareRow));
  }));

  app.post('/api/shares/:id/revoke', auth, wrap(async (req, res) => {
    const r = await one(`UPDATE shared_links SET revoked=TRUE WHERE id=$1 AND user_id=$2 RETURNING *`, [req.params.id, req.ctx.user_id]);
    if (!r) return bad(res, 404, 'not_found', '공유 링크를 찾을 수 없습니다');
    await log(req.ctx.user_id, req.ctx.device_id, 'share_revoked', r.name, ipOf(req));
    res.json(shareRow(r));
  }));

  // ---------- 받는 사람 페이지 ----------
  async function load(slug) {
    const s = await one(`SELECT * FROM shared_links WHERE slug=$1`, [String(slug)]);
    if (!s) return { err: '링크를 찾을 수 없습니다.' };
    if (s.revoked) return { err: '공유가 해제된 링크입니다.' };
    if (s.expires_at && new Date(s.expires_at) < new Date()) return { err: '기간이 지난 링크입니다.' };
    if (s.max_downloads && s.downloads >= s.max_downloads) return { err: '받을 수 있는 횟수를 모두 사용했습니다.' };
    return { s };
  }
  const page = (res, status, inner) => res.status(status).type('html').set('X-Robots-Tag', 'noindex').set('Referrer-Policy', 'no-referrer').send(`<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>파일 받기 · 파일 관리자 2</title>
<body style="margin:0;font-family:system-ui,'Malgun Gothic',sans-serif;background:#f6f7fb;color:#151a2d;display:grid;place-items:center;min-height:100vh">
<div style="background:#fff;border-radius:20px;padding:32px;max-width:420px;width:calc(100% - 40px);box-shadow:0 10px 40px #0001;text-align:center">
<img src="/icon.png" width="48" height="48" style="border-radius:12px" alt=""><div style="font-size:13px;color:#6b7187;margin:6px 0 18px">파일 관리자 2 공유 파일</div>${inner}
<p style="font-size:12px;color:#8a90a6;margin-top:22px">보낸 사람의 휴대폰 또는 클라우드에서 바로 전달됩니다. 모르는 사람이 보낸 파일은 열지 마세요.</p></div></body></html>`);

  app.get('/s/:slug', wrap(async (req, res) => {
    const { s, err } = await load(req.params.slug);
    if (err) return page(res, 404, `<h2>${esc(err)}</h2>`);
    const t = s.target;
    const offline = t.kind === 'phone' && !isOnline(t.androidId);
    page(res, 200, `<h2 style="word-break:break-all;margin:0 0 6px">${esc(s.name)}</h2><div style="color:#6b7187">${fmt(s.size)} · ${new Date(s.expires_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지</div>
      ${offline ? '<p style="color:#b45309;margin-top:18px">보낸 사람의 휴대폰이 지금 오프라인이라 받을 수 없습니다. 잠시 후 다시 시도해 주세요.</p>' : `
      <form method="post" action="/s/${esc(s.slug)}/download" style="margin-top:20px">
        ${s.pw_hash ? '<input name="password" type="password" placeholder="비밀번호" required style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #e6e8f0;border-radius:12px;margin-bottom:10px;font-size:15px">' : ''}
        <button style="width:100%;padding:13px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font-size:16px;font-weight:700;cursor:pointer">받기</button></form>`}`);
  }));

  app.post('/s/:slug/download', limit(30, 600e3), express_urlencoded, wrap(async (req, res) => {
    const { s, err } = await load(req.params.slug);
    if (err) return page(res, 404, `<h2>${esc(err)}</h2>`);
    if (s.pw_hash && !(await bcrypt.compare(String(req.body?.password || ''), s.pw_hash)))
      return page(res, 403, `<h2>비밀번호가 맞지 않습니다</h2><p><a href="/s/${esc(s.slug)}">다시 입력</a></p>`);
    const t = s.target;
    const upd = await one(`UPDATE shared_links SET downloads=downloads+1, last_access=now() WHERE id=$1 AND (max_downloads IS NULL OR downloads < max_downloads) RETURNING downloads`, [s.id]);
    if (!upd) return page(res, 410, '<h2>받을 수 있는 횟수를 모두 사용했습니다.</h2>');
    log(s.user_id, null, 'share_download', `${s.name} ${ipOf(req)}`, ipOf(req));
    const disp = `attachment; filename="${s.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(s.name)}`;
    try {
      if (t.kind === 'cloud') {
        const { at, P } = await accessFor(s.user_id, t.connId);
        const r = await P.download(at, t.id);
        res.setHeader('Content-Disposition', disp);
        res.setHeader('Content-Type', 'application/octet-stream');
        if (r.headers.get('content-length')) res.setHeader('Content-Length', r.headers.get('content-length'));
        return Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
      }
      // 휴대폰: 승인이 아직 유효한지 확인 후 조각 단위로 받아 바로 내보냄
      const perm = await one(`SELECT * FROM device_permissions WHERE android_id=$1 AND pc_id=$2 AND status='approved'`, [t.androidId, t.pcId]);
      if (!perm || !within(t.path, perm.folders)) return page(res, 410, '<h2>보낸 사람이 휴대폰 연결을 해제해 받을 수 없습니다.</h2>');
      if (!isOnline(t.androidId)) return page(res, 503, '<h2>보낸 사람의 휴대폰이 오프라인입니다.</h2><p>잠시 후 다시 시도해 주세요.</p>');
      const permArg = { folders: perm.folders, readOnly: true };
      let off = 0; let first = true;
      while (true) {
        const r = await serverRequest(t.androidId, 'read', { path: t.path, offset: off, length: 512 * 1024 }, permArg);
        if (first) {
          res.setHeader('Content-Disposition', disp); res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', String(r.size)); first = false;
        }
        const buf = Buffer.from(r.b64 || '', 'base64');
        off += buf.length;
        if (buf.length && !res.write(buf)) await new Promise((ok) => res.once('drain', ok));
        if (r.eof || !buf.length || off >= r.size) break;
        if (res.destroyed) return;
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) return page(res, 502, `<h2>파일을 가져오지 못했습니다</h2><p>${esc(e.message)}</p>`);
      res.destroy();
    }
  }));
}

function shareRow(r) {
  return { id: r.id, url: `${PUBLIC_URL()}/s/${r.slug}`, name: r.name, size: Number(r.size), kind: r.target?.kind, provider: r.target?.provider || null,
    expiresAt: r.expires_at, maxDownloads: r.max_downloads, downloads: r.downloads, hasPassword: !!r.pw_hash, revoked: r.revoked,
    active: !r.revoked && new Date(r.expires_at) > new Date() && (!r.max_downloads || r.downloads < r.max_downloads), createdAt: r.created_at };
}

// 받는 페이지 폼(비밀번호)용
import express from 'express';
const express_urlencoded = express.urlencoded({ extended: false, limit: '4kb' });
