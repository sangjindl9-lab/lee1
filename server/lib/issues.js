// 누락·부적합·만료 예정 조회
const { db } = require('../db');

const ISSUE_TYPES = {
  unmeasured: '미측정',
  failed: '부적합',
  retest: '재시험 필요',
  no_report: '성적서 누락',
  no_drawing: '도면 미연결',
  no_connection: '연결 정보 누락',
  warranty: '보증 만료 예정',
  recheck: '도면 위치 재확인 필요',
};

const TEST_FOR = { power_cable: 'insulation', fiber_cable: "'otdr','optical_loss'", lan_cable: 'lan_cert' };

const base = `SELECT a.id, a.mgmt_no, a.name, a.category, a.status, a.building, a.floor, a.room FROM assets a`;

function issues(siteId, type, days = 90) {
  switch (type) {
    case 'unmeasured':
      return db.prepare(`${base} WHERE a.site_id=? AND a.retired=0 AND a.category IN ('power_cable','fiber_cable','lan_cable') AND a.status<>'철거'
        AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.asset_id=a.id AND m.superseded_by IS NULL) ORDER BY a.category, a.mgmt_no`).all(siteId);
    case 'failed':
      return db.prepare(`${base}, measurements m WHERE m.asset_id=a.id AND a.site_id=? AND a.retired=0 AND m.superseded_by IS NULL
        AND m.id = (SELECT MAX(id) FROM measurements x WHERE x.asset_id=a.id AND x.superseded_by IS NULL AND x.test_type=m.test_type AND COALESCE(x.core_id,0)=COALESCE(m.core_id,0) AND COALESCE(x.combination,'')=COALESCE(m.combination,''))
        AND m.auto_result='부적합' GROUP BY a.id ORDER BY a.mgmt_no`).all(siteId).map(r => ({ ...r, note: '최근 측정 부적합' }));
    case 'retest':
      return db.prepare(`${base}, measurements m WHERE m.asset_id=a.id AND a.site_id=? AND m.superseded_by IS NULL AND m.review_status IN ('재시험 필요','반려')
        AND NOT EXISTS (SELECT 1 FROM measurements y WHERE y.asset_id=a.id AND y.test_type=m.test_type AND y.id>m.id AND y.superseded_by IS NULL)
        GROUP BY a.id ORDER BY a.mgmt_no`).all(siteId);
    case 'no_report':
      return db.prepare(`SELECT a.id, a.mgmt_no, a.name, a.category, a.status, m.id AS measurement_id, m.measured_at, m.test_type FROM measurements m JOIN assets a ON a.id=m.asset_id
        WHERE m.site_id=? AND m.superseded_by IS NULL AND NOT EXISTS (SELECT 1 FROM files f WHERE f.owner_type='measurement' AND f.owner_id=m.id AND f.archived=0)
        ORDER BY a.mgmt_no, m.measured_at`).all(siteId);
    case 'no_drawing':
      return db.prepare(`${base} WHERE a.site_id=? AND a.retired=0 AND a.category NOT IN ('pathway') AND NOT EXISTS (SELECT 1 FROM drawing_marks d WHERE d.asset_id=a.id) ORDER BY a.category, a.mgmt_no`).all(siteId);
    case 'no_connection': {
      // 케이블 양단, CCTV 포트 중 연결이 없는 것
      const cables = db.prepare(`${base} WHERE a.site_id=? AND a.retired=0 AND a.category IN ('power_cable','lan_cable')`).all(siteId);
      const out = [];
      const epq = db.prepare(`SELECT COUNT(*) n FROM connection_endpoints WHERE ep_type='cable' AND ep_id=? AND ep_end=? AND active=1`);
      for (const c of cables) {
        const miss = ['A', 'B'].filter(e => !epq.get(c.id, e).n);
        if (miss.length) out.push({ ...c, note: miss.map(e => e + '단').join('·') + ' 미연결' });
      }
      const fibers = db.prepare(`${base} WHERE a.site_id=? AND a.retired=0 AND a.category='fiber_cable'`).all(siteId);
      const coreq = db.prepare(`SELECT c.core_no, c.status, (SELECT COUNT(*) FROM connection_endpoints e WHERE e.ep_type='core' AND e.ep_id=c.id AND e.active=1) n FROM cable_cores c WHERE c.cable_id=?`);
      for (const f of fibers) {
        const cores = coreq.all(f.id);
        if (!cores.length) { out.push({ ...f, note: '코어 미등록' }); continue; }
        const half = cores.filter(c => c.status === '사용 중' && c.n < 2);
        if (half.length) out.push({ ...f, note: `사용 코어 중 한쪽 끝 미연결: #${half.map(c => c.core_no).join(', #')}` });
      }
      const cams = db.prepare(`${base} WHERE a.site_id=? AND a.retired=0 AND a.category='cctv'`).all(siteId);
      const pq = db.prepare(`SELECT p.name, (SELECT COUNT(*) FROM connection_endpoints e WHERE e.ep_type='port' AND e.ep_id=p.id AND e.active=1) n FROM ports p WHERE p.asset_id=?`);
      for (const c of cams) {
        const d = JSON.parse(db.prepare('SELECT data FROM asset_details WHERE asset_id=?').get(c.id)?.data || '{}');
        const ports = pq.all(c.id).filter(p => !(p.name === 'PWR' && d.power_method === 'PoE'));
        const miss = ports.filter(p => !p.n).map(p => p.name);
        if (miss.length) out.push({ ...c, note: `${miss.join('·')} 연결 미등록` });
      }
      return out;
    }
    case 'warranty':
      return db.prepare(`SELECT a.id, a.mgmt_no, a.name, a.category, a.status, json_extract(d.data,'$.warranty_end') AS warranty_end,
          json_extract(d.data,'$.supplier_contact') AS supplier_contact
        FROM assets a JOIN asset_details d ON d.asset_id=a.id
        WHERE a.site_id=? AND a.retired=0 AND json_extract(d.data,'$.warranty_end') IS NOT NULL
          AND json_extract(d.data,'$.warranty_end') <= date('now','localtime','+' || ? || ' days')
        ORDER BY warranty_end`).all(siteId, days).map(r => ({ ...r, note: r.warranty_end < new Date().toISOString().slice(0, 10) ? `만료됨 (${r.warranty_end})` : `만료 예정 ${r.warranty_end}` }));
    case 'recheck':
      return db.prepare(`SELECT a.id, a.mgmt_no, a.name, a.category, a.status, dr.drawing_no, rv.rev_no, m.page FROM drawing_marks m
        JOIN assets a ON a.id=m.asset_id JOIN drawing_revisions rv ON rv.id=m.revision_id JOIN drawings dr ON dr.id=rv.drawing_id
        WHERE a.site_id=? AND m.needs_recheck=1 ORDER BY dr.drawing_no, a.mgmt_no`).all(siteId).map(r => ({ ...r, note: `${r.drawing_no} Rev.${r.rev_no} p${r.page}` }));
    default: return [];
  }
}

module.exports = { issues, ISSUE_TYPES };
