'use strict';
const { db, J, rowToObj, objToCols, ENT, uid } = require('./db');

function projectRow(pid) { const p = db.prepare('SELECT * FROM projects WHERE id=?').get(pid); if (p) p.settings = J(p.settings); return p; }
function sheetObj(r) { if (!r) return null; return { id: r.id, project_id: r.project_id, name: r.name, building: r.building, floor: r.floor, zone: r.zone, sheet_no: r.sheet_no, sort: r.sort, ver: r.ver, updated_at: r.updated_at, ...J(r.data) }; }
function productObj(r) { return { id: r.id, company_id: r.company_id, category: r.category, kind: r.kind, name: r.name, spec: r.spec, unit: r.unit, maker: r.maker, model: r.model, props: J(r.data), updated_at: r.updated_at }; }
function listProducts(companyId) { return db.prepare('SELECT * FROM products WHERE company_id IS NULL OR company_id=? ORDER BY category, kind, name').all(companyId || '').map(productObj); }

function loadModel(pid, opts) {
  const project = projectRow(pid); if (!project) return null;
  const q = e => db.prepare(`SELECT * FROM ${e} WHERE project_id=?${opts && opts.sheet ? ' AND sheet_id=?' : ''}`).all(...[pid].concat(opts && opts.sheet ? [opts.sheet] : [])).map(r => rowToObj(e, r));
  return {
    project,
    sheets: db.prepare('SELECT * FROM sheets WHERE project_id=? ORDER BY sort, created_at').all(pid).map(sheetObj),
    devices: q('devices'), cables: q('cables'), conduits: q('conduits'), annotations: q('annotations'),
    products: listProducts(project.company_id)
  };
}

function getObj(entity, id) { return rowToObj(entity, db.prepare(`SELECT * FROM ${entity} WHERE id=?`).get(id)); }

// 객체 저장 (낙관적 잠금). expectedVer 불일치 시 conflict 반환
function upsertObj(pid, entity, o, user, expectedVer, force) {
  if (!ENT[entity]) throw new Error('알 수 없는 객체 유형: ' + entity);
  const cur = o.id ? db.prepare(`SELECT * FROM ${entity} WHERE id=?`).get(o.id) : null;
  if (cur && cur.project_id !== pid) throw Object.assign(new Error('다른 프로젝트의 객체입니다.'), { status: 403 });
  if (cur && !force && expectedVer != null && cur.ver !== expectedVer) return { conflict: true, current: rowToObj(entity, cur) };
  const id = o.id || uid();
  const { cols, data } = objToCols(entity, { ...o, id });
  const names = Object.keys(cols);
  if (cur) {
    db.prepare(`UPDATE ${entity} SET ${names.map(n => n + '=?').join(',')}, data=?, ver=ver+1, updated_at=datetime('now'), updated_by=? WHERE id=?`).run(...names.map(n => cols[n]), data, user.name, id);
  } else {
    db.prepare(`INSERT INTO ${entity}(id,project_id,${names.join(',')},data,updated_by) VALUES(?,?,${names.map(() => '?').join(',')},?,?)`).run(id, pid, ...names.map(n => cols[n]), data, user.name);
  }
  const after = getObj(entity, id);
  return { obj: after, before: cur ? rowToObj(entity, cur) : null };
}
function deleteObj(pid, entity, id) {
  const cur = db.prepare(`SELECT * FROM ${entity} WHERE id=? AND project_id=?`).get(id, pid);
  if (!cur) return null;
  db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(id);
  return rowToObj(entity, cur);
}
function log(pid, user, entity, entityId, action, before, after, reason) {
  db.prepare('INSERT INTO change_log(project_id,user_id,user_name,entity,entity_id,action,before,after,reason) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(pid, user && user.id, user && user.name, entity, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason || null);
}

module.exports = { loadModel, projectRow, sheetObj, productObj, listProducts, upsertObj, deleteObj, getObj, log };
