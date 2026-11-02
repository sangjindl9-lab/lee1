// 설비·연결 공통 서비스 (화면 API와 엑셀 일괄 등록에서 함께 사용)
const crypto = require('crypto');
const { db } = require('../db');
const { HttpError } = require('../auth');
const { CATEGORIES, STATUSES, DETAIL_FIELDS, CORE_COLORS } = require('./defs');

const COMMON = ['mgmt_no', 'name', 'building', 'floor', 'room', 'zone', 'location_desc', 'status', 'manufacturer', 'model', 'serial_no', 'install_date', 'contractor', 'manager', 'notes', 'parent_id'];

const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function clean(v) { if (v === undefined || v === null) return null; const s = String(v).trim(); return s === '' ? null : s; }

function pickDetails(category, src) {
  const out = {};
  for (const [k, , type] of DETAIL_FIELDS[category] || []) {
    if (src[k] === undefined) continue;
    let v = clean(src[k]);
    if (v !== null && type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) throw new HttpError(400, `숫자가 아닌 값: ${k}=${v}`);
      v = n;
    }
    out[k] = v;
  }
  return out;
}

function validateCommon(siteId, data, excludeId) {
  const mgmt = clean(data.mgmt_no);
  if (!mgmt) throw new HttpError(400, '관리번호는 필수입니다.');
  if (data.status && !STATUSES.includes(data.status)) throw new HttpError(400, `상태 값이 올바르지 않습니다: ${data.status}`);
  const dup = db.prepare('SELECT id FROM assets WHERE site_id=? AND mgmt_no=? AND retired=0 AND id<>?').get(siteId, mgmt, excludeId || 0);
  if (dup) throw new HttpError(409, `관리번호 ${mgmt} 이(가) 이미 이 현장에 있습니다.`);
  if (data.parent_id) {
    const p = db.prepare('SELECT site_id FROM assets WHERE id=?').get(data.parent_id);
    if (!p || p.site_id !== siteId) throw new HttpError(400, '상위 설비가 이 현장에 없습니다.');
  }
}

function createAsset(siteId, data, userId) {
  if (!CATEGORIES[data.category]) throw new HttpError(400, `설비 종류가 올바르지 않습니다: ${data.category}`);
  validateCommon(siteId, data);
  const vals = COMMON.map(k => k === 'status' ? (clean(data.status) || '설계') : k === 'parent_id' ? (data.parent_id ? Number(data.parent_id) : null) : clean(data[k]));
  const info = db.prepare(`INSERT INTO assets(site_id, category, qr_token, created_by, updated_by, ${COMMON.join(',')})
    VALUES (?,?,?,?,?,${COMMON.map(() => '?').join(',')})`)
    .run(siteId, data.category, crypto.randomBytes(12).toString('base64url'), userId, userId, ...vals);
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO asset_details(asset_id, data) VALUES (?,?)').run(id, JSON.stringify(pickDetails(data.category, data.details || {})));
  // 포트·코어 자동 생성
  if (data.port_count) generatePorts(id, data.category, Number(data.port_count), data.port_prefix);
  if (data.category === 'fiber_cable') {
    const n = Number(data.details?.core_count || data.core_count || 0);
    if (n) generateCores(id, n);
  }
  if (data.category === 'cctv') {
    generatePorts(id, 'cctv', 0);
  }
  return id;
}

function updateAsset(id, data, userId) {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
  if (!a) throw new HttpError(404, '설비를 찾을 수 없습니다.');
  if (data.version !== undefined && Number(data.version) !== a.version) {
    throw new HttpError(409, '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 수정하세요.', { current_version: a.version });
  }
  const merged = { ...a, ...data };
  validateCommon(a.site_id, merged, id);
  const sets = COMMON.map(k => `${k}=?`).join(',');
  const vals = COMMON.map(k => k === 'parent_id' ? (merged.parent_id ? Number(merged.parent_id) : null) : (k === 'status' ? merged.status : clean(merged[k])));
  db.prepare(`UPDATE assets SET ${sets}, version=version+1, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`).run(...vals, userId, id);
  let before = null, after = null;
  if (data.details) {
    const cur = JSON.parse(db.prepare('SELECT data FROM asset_details WHERE asset_id=?').get(id)?.data || '{}');
    const next = { ...cur, ...pickDetails(a.category, data.details) };
    db.prepare('INSERT INTO asset_details(asset_id,data) VALUES (?,?) ON CONFLICT(asset_id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(next));
    before = cur; after = next;
  }
  const changed = {};
  for (const k of COMMON) if (data[k] !== undefined && String(a[k] ?? '') !== String(clean(merged[k]) ?? '')) changed[k] = [a[k], clean(merged[k])];
  if (before) for (const k of Object.keys(after)) if (String(before[k] ?? '') !== String(after[k] ?? '')) changed['details.' + k] = [before[k] ?? null, after[k]];
  return changed;
}

function generatePorts(assetId, category, count, prefix) {
  const cat = CATEGORIES[category] || {};
  const existing = db.prepare('SELECT COALESCE(MAX(port_no),0) AS n FROM ports WHERE asset_id=?').get(assetId).n;
  const ins = db.prepare('INSERT INTO ports(asset_id, port_no, name, port_type, status, data) VALUES (?,?,?,?,?,?)');
  if (category === 'cctv') {
    if (existing) return;
    ins.run(assetId, 1, 'LAN', 'port', '예비', '{}');
    ins.run(assetId, 2, 'PWR', 'terminal', '예비', '{}');
    return;
  }
  if (category === 'splitter') {
    if (!existing) ins.run(assetId, 1, 'IN', 'in', '예비', '{}');
    for (let i = 1; i <= count; i++) ins.run(assetId, existing + i + 1, `OUT${existing + i}`, 'out', '예비', '{}');
    return;
  }
  const type = cat.ports === 'circuit' ? 'circuit' : cat.ports === 'channel' ? 'channel' : cat.ports === 'terminal' && category === 'load' ? 'terminal' : 'port';
  const pre = prefix || (type === 'circuit' ? 'L-' : type === 'channel' ? 'CH' : category === 'load' ? 'T' : 'P');
  for (let i = 1; i <= count; i++) ins.run(assetId, existing + i, `${pre}${existing + i}`, type, '예비', '{}');
}

function generateCores(cableId, n) {
  const existing = db.prepare('SELECT COALESCE(MAX(core_no),0) AS n FROM cable_cores WHERE cable_id=?').get(cableId).n;
  const ins = db.prepare('INSERT INTO cable_cores(cable_id, core_no, color, status) VALUES (?,?,?,?)');
  for (let i = existing + 1; i <= n; i++) ins.run(cableId, i, CORE_COLORS[(i - 1) % 12], '예비');
}

// ---------- 연결 ----------
function resolveEndpoint(siteId, ep) {
  if (!ep || !ep.type || !ep.id) throw new HttpError(400, '연결 대상이 지정되지 않았습니다.');
  const end = ep.end || '';
  const id = Number(ep.id);
  if (ep.type === 'asset') {
    const a = db.prepare('SELECT id, site_id, category, mgmt_no FROM assets WHERE id=? AND retired=0').get(id);
    if (!a || a.site_id !== siteId) throw new HttpError(400, '연결할 설비가 이 현장에 없습니다.');
    return { type: 'asset', id, end: '' };
  }
  if (ep.type === 'port') {
    const p = db.prepare('SELECT p.id, p.status, a.site_id, a.category FROM ports p JOIN assets a ON a.id=p.asset_id WHERE p.id=? AND a.retired=0').get(id);
    if (!p || p.site_id !== siteId) throw new HttpError(400, '연결할 포트가 이 현장에 없습니다.');
    const pass = CATEGORIES[p.category]?.ports === 'passthrough';
    if (pass && !['front', 'rear'].includes(end)) throw new HttpError(400, '패치패널·ODF·정보콘센트 포트는 앞(front)/뒤(rear)를 지정해야 합니다.');
    if (p.status === '불량' || p.status === '사용 중지') throw new HttpError(400, `포트 상태가 '${p.status}'이므로 연결할 수 없습니다.`);
    return { type: 'port', id, end: pass ? end : '' };
  }
  if (ep.type === 'core') {
    const c = db.prepare('SELECT c.id, c.status, a.site_id FROM cable_cores c JOIN assets a ON a.id=c.cable_id WHERE c.id=? AND a.retired=0').get(id);
    if (!c || c.site_id !== siteId) throw new HttpError(400, '연결할 코어가 이 현장에 없습니다.');
    if (!['A', 'B'].includes(end)) throw new HttpError(400, '코어는 A단/B단을 지정해야 합니다.');
    if (c.status === '불량' || c.status === '사용 중지') throw new HttpError(400, `코어 상태가 '${c.status}'이므로 연결할 수 없습니다.`);
    return { type: 'core', id, end };
  }
  if (ep.type === 'cable') {
    const a = db.prepare('SELECT id, site_id, category FROM assets WHERE id=? AND retired=0').get(id);
    if (!a || a.site_id !== siteId || CATEGORIES[a.category]?.group !== 'cable') throw new HttpError(400, '연결할 케이블이 이 현장에 없습니다.');
    if (!['A', 'B'].includes(end)) throw new HttpError(400, '케이블은 A단(시작)/B단(종점)을 지정해야 합니다.');
    return { type: 'cable', id, end };
  }
  throw new HttpError(400, '알 수 없는 연결 대상 종류입니다.');
}

function epLabel(ep) {
  const { describe, key } = require('./graph');
  return describe(key(ep.type, ep.id, ep.end)).text;
}

function createConnection(siteId, body, userId) {
  const kinds = ['power', 'fixed', 'patch', 'splice', 'comm'];
  if (!kinds.includes(body.kind)) throw new HttpError(400, '연결 종류가 올바르지 않습니다.');
  const a = resolveEndpoint(siteId, body.a);
  const b = resolveEndpoint(siteId, body.b);
  if (a.type === b.type && a.id === b.id && a.end === b.end) throw new HttpError(400, '같은 끝점끼리는 연결할 수 없습니다.');
  if (body.kind === 'splice' && !(a.type === 'core' && b.type === 'core') && !(a.type === 'core' || b.type === 'core')) throw new HttpError(400, '광접속은 코어를 포함해야 합니다.');
  // 중복 연결 검사 (서버)
  for (const ep of [a, b]) {
    if (ep.type === 'asset') continue;
    const used = db.prepare(`SELECT ce.connection_id FROM connection_endpoints ce JOIN connections c ON c.id=ce.connection_id
       WHERE ce.ep_type=? AND ce.ep_id=? AND ce.ep_end=? AND ce.active=1`).get(ep.type, ep.id, ep.end);
    if (used) throw new HttpError(409, `중복 연결: ${epLabel(ep)} 은(는) 이미 연결 #${used.connection_id} 에 사용 중입니다. 기존 연결을 해제하거나 변경 기능을 사용하세요.`);
  }
  let closure = null;
  if (body.closure_asset_id) {
    const c = db.prepare('SELECT id, site_id FROM assets WHERE id=?').get(body.closure_asset_id);
    if (!c || c.site_id !== siteId) throw new HttpError(400, '접속함이 이 현장에 없습니다.');
    closure = c.id;
  }
  const info = db.prepare(`INSERT INTO connections(site_id, kind, closure_asset_id, tray, sleeve, location, work_date, worker, note, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`).run(siteId, body.kind, closure, clean(body.tray), clean(body.sleeve), clean(body.location), clean(body.work_date), clean(body.worker), clean(body.note), userId);
  const cid = Number(info.lastInsertRowid);
  const insEp = db.prepare('INSERT INTO connection_endpoints(connection_id, seq, ep_type, ep_id, ep_end) VALUES (?,?,?,?,?)');
  try {
    insEp.run(cid, 1, a.type, a.id, a.end);
    insEp.run(cid, 2, b.type, b.id, b.end);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, '중복 연결: 해당 포트·코어는 이미 사용 중입니다.');
    throw e;
  }
  refreshStatus([a, b]);
  return cid;
}

function endConnection(connId, reason, userId) {
  const c = db.prepare('SELECT * FROM connections WHERE id=?').get(connId);
  if (!c) throw new HttpError(404, '연결을 찾을 수 없습니다.');
  if (!c.active) throw new HttpError(400, '이미 해제된 연결입니다.');
  db.prepare(`UPDATE connections SET active=0, ended_at=datetime('now','localtime'), ended_by=?, end_reason=? WHERE id=?`).run(userId, clean(reason) || '해제', connId);
  db.prepare('UPDATE connection_endpoints SET active=0 WHERE connection_id=?').run(connId);
  const eps = db.prepare('SELECT ep_type AS type, ep_id AS id, ep_end AS end FROM connection_endpoints WHERE connection_id=?').all(connId);
  refreshStatus(eps);
  return c;
}

// 포트·코어 상태를 연결 여부에 맞춰 갱신 (불량·사용 중지는 유지)
function refreshStatus(eps) {
  for (const ep of eps) {
    if (ep.type === 'port') {
      const n = db.prepare('SELECT COUNT(*) n FROM connection_endpoints WHERE ep_type=? AND ep_id=? AND active=1').get('port', ep.id).n;
      db.prepare(`UPDATE ports SET status=? WHERE id=? AND status IN ('사용','예비')`).run(n ? '사용' : '예비', ep.id);
    }
    if (ep.type === 'core') {
      const n = db.prepare('SELECT COUNT(*) n FROM connection_endpoints WHERE ep_type=? AND ep_id=? AND active=1').get('core', ep.id).n;
      db.prepare(`UPDATE cable_cores SET status=? WHERE id=? AND status IN ('사용 중','예비')`).run(n ? '사용 중' : '예비', ep.id);
    }
  }
}

function assetSite(id) {
  const r = db.prepare('SELECT site_id FROM assets WHERE id=?').get(id);
  return r?.site_id;
}

module.exports = { h, clean, createAsset, updateAsset, generatePorts, generateCores, createConnection, endConnection, resolveEndpoint, assetSite, pickDetails, COMMON, epLabel };
