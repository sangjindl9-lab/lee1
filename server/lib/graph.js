// 연결 관계 추적 / 영향 조회
const { db } = require('../db');
const { CATEGORIES } = require('./defs');

const key = (t, id, e = '') => `${t}:${id}:${e}`;
const parse = k => { const [t, id, e] = k.split(':'); return { t, id: Number(id), e: e || '' }; };

const q = {
  asset: db.prepare('SELECT id, mgmt_no, name, category, status, site_id FROM assets WHERE id=?'),
  port: db.prepare('SELECT p.*, a.mgmt_no, a.category, a.name AS asset_name FROM ports p JOIN assets a ON a.id=p.asset_id WHERE p.id=?'),
  core: db.prepare('SELECT c.*, a.mgmt_no, a.name AS cable_name FROM cable_cores c JOIN assets a ON a.id=c.cable_id WHERE c.id=?'),
  epConns: db.prepare(`SELECT e2.ep_type, e2.ep_id, e2.ep_end, c.id AS conn_id, c.kind, c.closure_asset_id, c.tray, c.sleeve
      FROM connection_endpoints e1
      JOIN connections c ON c.id=e1.connection_id AND c.active=1
      JOIN connection_endpoints e2 ON e2.connection_id=e1.connection_id AND e2.seq<>e1.seq
      WHERE e1.ep_type=? AND e1.ep_id=? AND e1.ep_end=? AND e1.active=1`),
  splitterPorts: db.prepare('SELECT id, port_type FROM ports WHERE asset_id=?'),
  cores: db.prepare('SELECT id FROM cable_cores WHERE cable_id=?'),
  ports: db.prepare('SELECT id FROM ports WHERE asset_id=?'),
};

function cat(category) { return CATEGORIES[category] || {}; }

function describe(k) {
  const { t, id, e } = parse(k);
  if (t === 'asset') {
    const a = q.asset.get(id); if (!a) return { text: '삭제된 설비', missing: true };
    return { text: `${a.mgmt_no}${a.name ? ' ' + a.name : ''}`, asset_id: a.id, category: a.category, kind: cat(a.category).label };
  }
  if (t === 'port') {
    const p = q.port.get(id); if (!p) return { text: '삭제된 포트', missing: true };
    const side = e === 'front' ? ' (앞)' : e === 'rear' ? ' (뒤)' : '';
    return { text: `${p.mgmt_no} ${p.name}${side}`, asset_id: p.asset_id, category: p.category, kind: cat(p.category).label, port_id: p.id };
  }
  if (t === 'core') {
    const c = q.core.get(id); if (!c) return { text: '삭제된 코어', missing: true };
    return { text: `${c.mgmt_no} #${c.core_no}코어${c.color ? '(' + c.color + ')' : ''} ${e}단`, asset_id: c.cable_id, category: 'fiber_cable', kind: '광코어', core_id: c.id };
  }
  if (t === 'cable') {
    const a = q.asset.get(id); if (!a) return { text: '삭제된 케이블', missing: true };
    return { text: `${a.mgmt_no} ${e}단`, asset_id: a.id, category: a.category, kind: cat(a.category).label };
  }
  return { text: k };
}

// 내부 경로 (케이블 양단, 코어 양단, 패치패널 앞/뒤, 분배기 입력/출력)
function internalNeighbors(k) {
  const { t, id, e } = parse(k);
  const out = [];
  if (t === 'cable') out.push({ k: key('cable', id, e === 'A' ? 'B' : 'A'), via: 'through' });
  if (t === 'core') out.push({ k: key('core', id, e === 'A' ? 'B' : 'A'), via: 'through' });
  if (t === 'port') {
    const p = q.port.get(id);
    if (p) {
      const c = cat(p.category);
      if (c.ports === 'passthrough' && (e === 'front' || e === 'rear')) out.push({ k: key('port', id, e === 'front' ? 'rear' : 'front'), via: 'internal' });
      if (c.ports === 'splitter') {
        const all = q.splitterPorts.all(p.asset_id);
        if (p.port_type === 'in') for (const o of all.filter(x => x.port_type === 'out')) out.push({ k: key('port', o.id, ''), via: 'split' });
        else if (p.port_type === 'out') for (const o of all.filter(x => x.port_type === 'in')) out.push({ k: key('port', o.id, ''), via: 'split' });
      }
    }
  }
  return out;
}

function connNeighbors(k) {
  const { t, id, e } = parse(k);
  return q.epConns.all(t, id, e).map(r => ({ k: key(r.ep_type, r.ep_id, r.ep_end), via: 'conn', conn: r }));
}

// 종단 판정: 장비 자체 또는 터미널형 포트에서 끝나면 '종단', 아니면 '추적 불가'
function isTerminal(k) {
  const { t, id, e } = parse(k);
  if (t === 'asset') return true;
  if (t === 'port') {
    const p = q.port.get(id); if (!p) return false;
    const c = cat(p.category);
    if (c.ports === 'passthrough') return false;  // 앞/뒤 중 반대편이 비어 있으면 아래에서 판단
    return true;
  }
  return false;
}

/**
 * 경로 추적 (트리). 시작 노드에서 연결과 내부 경로를 따라감.
 * 결과 노드: { key, label, via, conn, children[], end: '종단'|'미등록'|'순환' }
 */
function trace(startKey, maxDepth = 60) {
  const visited = new Set([startKey]);
  function walk(k, depth, cameVia) {
    const node = { key: k, ...describe(k), via: cameVia?.via, conn: cameVia?.conn ? connInfo(cameVia.conn) : undefined, children: [] };
    if (depth > maxDepth) { node.end = '추적 깊이 초과'; return node; }
    const nbrs = [...internalNeighbors(k), ...connNeighbors(k)];
    const next = nbrs.filter(n => !(cameVia && n.k === cameVia.from));
    for (const n of next) {
      if (visited.has(n.k)) { node.children.push({ key: n.k, ...describe(n.k), via: n.via, end: '순환 연결 감지 (중단)', children: [] }); continue; }
      visited.add(n.k);
      node.children.push(walk(n.k, depth + 1, { ...n, from: k }));
    }
    if (!node.children.length) node.end = isTerminal(k) ? '종단' : '미등록 (추적 불가)';
    return node;
  }
  return walk(startKey, 0, null);
}

function connInfo(c) {
  const closure = c.closure_asset_id ? q.asset.get(c.closure_asset_id) : null;
  return { id: c.conn_id, kind: c.kind, closure: closure ? closure.mgmt_no : null, tray: c.tray, sleeve: c.sleeve };
}

// 설비의 시작 노드들
function assetStartKeys(asset) {
  const c = cat(asset.category);
  const keys = [key('asset', asset.id)];
  if (c.group === 'cable') {
    keys.push(key('cable', asset.id, 'A'), key('cable', asset.id, 'B'));
    for (const r of q.cores.all(asset.id)) keys.push(key('core', r.id, 'A'), key('core', r.id, 'B'));
  }
  for (const p of q.ports.all(asset.id)) {
    if (c.ports === 'passthrough') keys.push(key('port', p.id, 'front'), key('port', p.id, 'rear'));
    else keys.push(key('port', p.id, ''));
  }
  return keys;
}

/**
 * 영향 조회: 선택 설비에서 연결된 설비 목록 (등록된 연결 정보 기준).
 * - 케이블·코어·패치패널·ODF·분배기는 통과, 허브(분전반·스위치·NVR)와 말단 장비에서는 멈춤
 * - 스위치에 도달하면 그 스위치의 다른 포트에 연결된 설비를 '간접 영향(스위치 경유)'으로 별도 표시
 */
function bfs(starts, selfId, visited) {
  const startSet = new Set(starts);
  const found = new Map();
  const unresolved = [];
  const queue = starts.map(k => ({ k, d: 0, medium: null }));
  starts.forEach(k => visited.add(k));
  while (queue.length) {
    const { k, d, medium } = queue.shift();
    const p0 = parse(k);
    const nbrs = [...connNeighbors(k), ...(p0.t === 'asset' ? [] : internalNeighbors(k))];
    const hasConn = connNeighbors(k).length > 0;
    if (!hasConn && (p0.t === 'cable' || p0.t === 'core')) {
      // 연결이 없어야 정상인 끝단은 제외 (광케이블 자체 끝단, 예비·불량 코어)
      let skip = false;
      if (p0.t === 'cable') skip = q.asset.get(p0.id)?.category === 'fiber_cable';
      if (p0.t === 'core') skip = (q.core.get(p0.id)?.status || '') !== '사용 중';
      if (!skip) unresolved.push({ key: k, ...describe(k) });
    }
    if (!startSet.has(k) && p0.t === 'port' && !nbrs.length) unresolved.push({ key: k, ...describe(k) });
    for (const n of nbrs) {
      if (visited.has(n.k)) continue;
      visited.add(n.k);
      const desc = describe(n.k);
      let m = medium;
      if (n.conn) m = m || (n.conn.kind === 'power' ? 'power' : 'comm');
      if (!m && desc.category) m = cat(desc.category).medium || null;
      if (desc.asset_id && desc.asset_id !== selfId) {
        const prev = found.get(desc.asset_id);
        if (!prev) found.set(desc.asset_id, { ...describe(key('asset', desc.asset_id)), mediums: new Set([m || 'comm']), distance: d + 1, via_text: desc.text, entry: n.k });
        else prev.mediums.add(m || 'comm');
      }
      const t = parse(n.k).t;
      let expand = t === 'cable' || t === 'core';
      if (t === 'port') {
        const p = q.port.get(parse(n.k).id);
        const pc = p ? cat(p.category) : {};
        expand = pc.ports === 'passthrough' || pc.ports === 'splitter';
      }
      if (expand) queue.push({ k: n.k, d: d + 1, medium: m });
    }
  }
  return { found, unresolved };
}

function impact(assetId) {
  const asset = q.asset.get(assetId);
  if (!asset) return null;
  const visited = new Set();
  const { found, unresolved } = bfs(assetStartKeys(asset), asset.id, visited);
  const direct = [...found.values()].map(f => ({ ...f, mediums: [...f.mediums] })).sort((a, b) => a.distance - b.distance);
  // 스위치 경유 간접 영향
  const indirect = [];
  const seen = new Set([asset.id, ...found.keys()]);
  for (const f of direct) {
    if (f.category !== 'switch') continue;
    const sw = q.asset.get(f.asset_id);
    const starts = assetStartKeys(sw).filter(k => !visited.has(k) && parse(k).t === 'port');
    const sub = bfs(starts, sw.id, visited);
    for (const g of sub.found.values()) {
      if (seen.has(g.asset_id)) continue;
      seen.add(g.asset_id);
      indirect.push({ ...g, mediums: ['comm'], via_hub: f.text });
    }
  }
  return { asset, affected: direct, indirect, unresolved };
}

module.exports = { key, parse, describe, trace, impact, assetStartKeys };
