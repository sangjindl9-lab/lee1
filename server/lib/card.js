// 이력 카드 데이터 조립 (화면·PDF 공통)
const { db } = require('../db');
const { CATEGORIES } = require('./defs');
const graph = require('./graph');

function assetEndpointsSql() {
  return `(
    (ce.ep_type='asset' AND ce.ep_id=@id) OR
    (ce.ep_type='cable' AND ce.ep_id=@id) OR
    (ce.ep_type='port' AND ce.ep_id IN (SELECT id FROM ports WHERE asset_id=@id)) OR
    (ce.ep_type='core' AND ce.ep_id IN (SELECT id FROM cable_cores WHERE cable_id=@id))
  )`;
}

function connectionsOf(assetId, activeOnly) {
  const rows = db.prepare(`SELECT DISTINCT c.* FROM connections c JOIN connection_endpoints ce ON ce.connection_id=c.id
     WHERE ${assetEndpointsSql()} ${activeOnly ? 'AND c.active=1' : ''} ORDER BY c.active DESC, c.id`).all({ id: assetId });
  const eps = db.prepare('SELECT * FROM connection_endpoints WHERE connection_id=? ORDER BY seq');
  return rows.map(c => {
    const [e1, e2] = eps.all(c.id);
    const closure = c.closure_asset_id ? db.prepare('SELECT mgmt_no FROM assets WHERE id=?').get(c.closure_asset_id) : null;
    return {
      ...c, closure: closure?.mgmt_no || null,
      a: { type: e1.ep_type, id: e1.ep_id, end: e1.ep_end, ...graph.describe(graph.key(e1.ep_type, e1.ep_id, e1.ep_end)) },
      b: { type: e2.ep_type, id: e2.ep_id, end: e2.ep_end, ...graph.describe(graph.key(e2.ep_type, e2.ep_id, e2.ep_end)) },
    };
  });
}

function epPeer(epType, epId, epEnd) {
  const r = db.prepare(`SELECT e2.ep_type, e2.ep_id, e2.ep_end, c.id AS conn_id, c.kind FROM connection_endpoints e1
    JOIN connections c ON c.id=e1.connection_id AND c.active=1
    JOIN connection_endpoints e2 ON e2.connection_id=e1.connection_id AND e2.seq<>e1.seq
    WHERE e1.ep_type=? AND e1.ep_id=? AND e1.ep_end=? AND e1.active=1`).get(epType, epId, epEnd);
  if (!r) return null;
  return { conn_id: r.conn_id, kind: r.kind, type: r.ep_type, id: r.ep_id, end: r.ep_end, ...graph.describe(graph.key(r.ep_type, r.ep_id, r.ep_end)) };
}

function assetCard(id) {
  const asset = db.prepare(`SELECT a.*, s.name AS site_name, s.code AS site_code, s.is_demo,
      cu.name AS created_by_name, uu.name AS updated_by_name
      FROM assets a JOIN sites s ON s.id=a.site_id LEFT JOIN users cu ON cu.id=a.created_by LEFT JOIN users uu ON uu.id=a.updated_by WHERE a.id=?`).get(id);
  if (!asset) return null;
  const cat = CATEGORIES[asset.category] || {};
  const details = JSON.parse(db.prepare('SELECT data FROM asset_details WHERE asset_id=?').get(id)?.data || '{}');
  const parent = asset.parent_id ? db.prepare('SELECT id, mgmt_no, name, category FROM assets WHERE id=?').get(asset.parent_id) : null;
  const children = db.prepare('SELECT id, mgmt_no, name, category, status FROM assets WHERE parent_id=? AND retired=0 ORDER BY mgmt_no').all(id);
  const replacedBy = asset.replaced_by ? db.prepare('SELECT id, mgmt_no, serial_no FROM assets WHERE id=?').get(asset.replaced_by) : null;
  const replaces = asset.replaces ? db.prepare('SELECT id, mgmt_no, serial_no, retired FROM assets WHERE id=?').get(asset.replaces) : null;

  const pass = cat.ports === 'passthrough';
  const ports = db.prepare('SELECT * FROM ports WHERE asset_id=? ORDER BY port_no').all(id).map(p => ({
    ...p, data: JSON.parse(p.data || '{}'),
    front: pass ? epPeer('port', p.id, 'front') : null,
    rear: pass ? epPeer('port', p.id, 'rear') : null,
    peer: pass ? null : epPeer('port', p.id, ''),
  }));
  const cores = db.prepare('SELECT * FROM cable_cores WHERE cable_id=? ORDER BY core_no').all(id).map(c => ({
    ...c, a: epPeer('core', c.id, 'A'), b: epPeer('core', c.id, 'B'),
  }));
  const ends = cat.group === 'cable' ? { A: epPeer('cable', id, 'A'), B: epPeer('cable', id, 'B') } : null;

  const measurements = db.prepare(`SELECT m.*, u.name AS reviewer_name, c.core_no,
      (SELECT COUNT(*) FROM files f WHERE f.owner_type='measurement' AND f.owner_id=m.id AND f.archived=0) AS file_count
      FROM measurements m LEFT JOIN users u ON u.id=m.reviewed_by LEFT JOIN cable_cores c ON c.id=m.core_id
      WHERE m.asset_id=? ORDER BY m.measured_at DESC, m.id DESC`).all(id)
    .map(m => ({ ...m, items: m.items ? JSON.parse(m.items) : null, criteria_snapshot: m.criteria_snapshot ? JSON.parse(m.criteria_snapshot) : null }));
  const worklogs = db.prepare(`SELECT w.*, u.name AS reviewer_name, cu.name AS created_by_name FROM work_logs w
      LEFT JOIN users u ON u.id=w.reviewed_by LEFT JOIN users cu ON cu.id=w.created_by
      WHERE w.asset_id=? ORDER BY w.work_at DESC, w.id DESC`).all(id);
  const files = db.prepare(`SELECT f.id, f.owner_type, f.owner_id, f.category, f.orig_name, f.mime, f.size, f.caption, f.created_at, u.name AS created_by_name
      FROM files f LEFT JOIN users u ON u.id=f.created_by
      WHERE f.archived=0 AND ((f.owner_type='asset' AND f.owner_id=@id)
        OR (f.owner_type='measurement' AND f.owner_id IN (SELECT id FROM measurements WHERE asset_id=@id))
        OR (f.owner_type='worklog' AND f.owner_id IN (SELECT id FROM work_logs WHERE asset_id=@id)))
      ORDER BY f.id`).all({ id });
  const marks = db.prepare(`SELECT m.id, m.page, m.shape, m.needs_recheck, rv.id AS revision_id, rv.rev_no, d.id AS drawing_id, d.drawing_no, d.title,
      (SELECT MAX(r2.id) FROM drawing_revisions r2 WHERE r2.drawing_id=d.id) = rv.id AS is_latest
      FROM drawing_marks m JOIN drawing_revisions rv ON rv.id=m.revision_id JOIN drawings d ON d.id=rv.drawing_id
      WHERE m.asset_id=? ORDER BY is_latest DESC, d.drawing_no, rv.id DESC`).all(id);
  const connections = connectionsOf(id, false);
  const hasSecret = !!db.prepare('SELECT 1 FROM asset_secrets WHERE asset_id=?').get(id);

  // 경로 요약 (CCTV: 통신·전원)
  let paths = null;
  if (asset.category === 'cctv') {
    const lan = ports.find(p => p.name === 'LAN');
    const pwr = ports.find(p => p.name === 'PWR');
    paths = {
      comm: lan ? graph.trace(graph.key('port', lan.id, '')) : null,
      power: pwr ? graph.trace(graph.key('port', pwr.id, '')) : null,
    };
  }
  if (cat.group === 'cable' && asset.category !== 'fiber_cable') {
    paths = { cable: graph.trace(graph.key('cable', id, 'A')) };
  }
  return { asset, category_label: cat.label, details, parent, children, replacedBy, replaces, ports, cores, ends, measurements, worklogs, files, marks, connections, paths, hasSecret };
}

module.exports = { assetCard, connectionsOf, epPeer };
