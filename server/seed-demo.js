// 시연용 데이터 생성: 실제 데이터와 구분되도록 is_demo=1 현장에만 생성
// 사용: npm run seed:demo  (DEMO_PASSWORD 환경변수로 시연 계정 비밀번호 지정 가능)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, migrate } = require('./db');
migrate();
const { hashPassword } = require('./auth');
const svc = require('./lib/svc');
const { saveUploaded } = require('./lib/files');
const { judge } = require('./lib/judge');

const PW = process.env.DEMO_PASSWORD || 'demo1234!';

async function makeFiles() {
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const page = await b.newPage();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  // 도면 (A3 가로 2페이지). 좌표는 % 로 배치해 도면 표시 위치와 일치시킴
  const plan = (rev) => `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A3 landscape; margin: 0 }
    body { margin:0; font-family:'Noto Sans CJK KR',sans-serif; }
    .pg { position:relative; width:420mm; height:297mm; page-break-after:always; overflow:hidden; }
    .room { position:absolute; border:2px solid #222; }
    .lbl { position:absolute; font-size:13px; color:#222; }
    .tb { position:absolute; right:8mm; bottom:8mm; border:1.5px solid #222; font-size:12px; padding:4px 10px; background:#fff; }
    .sym { position:absolute; width:14px; height:14px; border:2px solid #222; transform:translate(-50%,-50%); background:#fff; }
    .dim { position:absolute; border-top:1.5px solid #222; }
  </style></head><body>
  <div class="pg">
    <div class="room" style="left:5%;top:8%;width:${rev === 'B' ? 32 : 30}%;height:40%"></div><div class="lbl" style="left:6%;top:9%">전기실</div>
    <div class="room" style="left:${rev === 'B' ? 37 : 35}%;top:8%;width:30%;height:40%"></div><div class="lbl" style="left:${rev === 'B' ? 38 : 36}%;top:9%">통신실</div>
    <div class="room" style="left:5%;top:52%;width:60%;height:30%"></div><div class="lbl" style="left:6%;top:53%">사무실 101</div>
    <div class="room" style="left:68%;top:8%;width:27%;height:74%"></div><div class="lbl" style="left:69%;top:9%">기계실 / 주차장 진입부</div>
    <div class="sym" style="left:10%;top:20%"></div><div class="lbl" style="left:11%;top:17%">LP-1</div>
    <div class="sym" style="left:80%;top:30%"></div><div class="lbl" style="left:81%;top:27%">급수펌프 P-1</div>
    <div class="sym" style="left:45%;top:20%"></div><div class="lbl" style="left:46%;top:17%">RACK-1 / ODF-A</div>
    <div class="sym" style="left:30%;top:70%"></div><div class="lbl" style="left:31%;top:67%">TO-101</div>
    <div class="sym" style="left:90%;top:70%"></div><div class="lbl" style="left:85%;top:73%">CCTV-01</div>
    <div class="dim" style="left:10%;top:90%;width:20%"></div><div class="lbl" style="left:17%;top:91%">10 m (축척 기준선)</div>
    <div class="tb">시연용 도면 · E-101 1층 전력·통신 평면도 · Rev.${rev}</div>
  </div>
  <div class="pg">
    <div class="room" style="left:5%;top:8%;width:90%;height:74%"></div><div class="lbl" style="left:6%;top:9%">2층 사무공간</div>
    <div class="sym" style="left:20%;top:30%"></div><div class="lbl" style="left:21%;top:27%">CCTV-02</div>
    <div class="sym" style="left:70%;top:60%"></div><div class="lbl" style="left:71%;top:57%">JC-01 (광접속함)</div>
    <div class="sym" style="left:85%;top:20%"></div><div class="lbl" style="left:86%;top:17%">ODF-B / SW-2</div>
    <div class="tb">시연용 도면 · E-101 2층 · Rev.${rev}</div>
  </div></body></html>`;
  const files = {};
  for (const rev of ['A', 'B']) {
    await page.setContent(plan(rev));
    const p = path.join(tmp, `E-101_Rev${rev}.pdf`);
    await page.pdf({ path: p, width: '420mm', height: '297mm', printBackground: true });
    files['plan' + rev] = p;
  }
  const photo = async (name, text, color) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setContent(`<body style="margin:0;background:${color};font-family:'Noto Sans CJK KR';display:flex;align-items:center;justify-content:center;height:600px;color:#fff;font-size:34px;text-align:center">${text}<br><span style="font-size:20px">(시연용 이미지)</span></body>`);
    const p = path.join(tmp, name);
    await page.screenshot({ path: p, type: 'jpeg', quality: 80 });
    files[name] = p;
  };
  await photo('before.jpg', 'LP-1 회로 L-3 단말 처리 전', '#5b6670');
  await photo('after.jpg', 'LP-1 회로 L-3 단말 처리 후', '#3d5a45');
  await photo('cam.jpg', 'CCTV-01 설치 사진', '#4a4f63');
  await photo('rack.jpg', 'RACK-1 패치패널', '#5a4a3d');
  // 성적서 PDF
  await page.setContent(`<body style="font-family:'Noto Sans CJK KR';padding:40px"><h2>절연저항 시험성적서 (시연용)</h2><p>PC-001 · 500V · L1-E 520MΩ, L2-E 510MΩ, L3-E 505MΩ, N-E 498MΩ</p></body>`);
  files.report = path.join(tmp, 'report.pdf');
  await page.pdf({ path: files.report, format: 'A4' });
  await b.close();
  return files;
}

function fileObj(p, name) {
  const cp = p + '.' + Math.random().toString(36).slice(2);
  fs.copyFileSync(p, cp);
  return { path: cp, originalname: name, size: fs.statSync(cp).size };
}

// 시연용 DXF (R12 형식): 전기실 배치 — 분전반·변압기·케이블 경로·한글 주기
function demoDxf() {
  const out = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (x1, y1, x2, y2, layer = 'E-POWER') => out.push('0', 'LINE', '8', layer, '10', x1, '20', y1, '30', 0, '11', x2, '21', y2, '31', 0);
  const rect = (x, y, w, h, layer) => { line(x, y, x + w, y, layer); line(x + w, y, x + w, y + h, layer); line(x + w, y + h, x, y + h, layer); line(x, y + h, x, y, layer); };
  const text = (x, y, hgt, t, layer = 'E-TEXT') => out.push('0', 'TEXT', '8', layer, '10', x, '20', y, '30', 0, '40', hgt, '1', t);
  const circle = (x, y, r, layer = 'E-EQUIP') => out.push('0', 'CIRCLE', '8', layer, '10', x, '20', y, '30', 0, '40', r);
  rect(0, 0, 30000, 18000, 'A-WALL'); rect(200, 200, 29600, 17600, 'A-WALL');
  text(800, 16800, 500, '전기실 배치도 (시연용 DXF)');
  rect(2000, 9000, 2400, 6000, 'E-EQUIP'); text(2100, 8300, 350, 'MDB (수배전반)');
  rect(7000, 9000, 1600, 3000, 'E-EQUIP'); text(7000, 8300, 350, 'LP-1');
  rect(7000, 3000, 1600, 3000, 'E-EQUIP'); text(7000, 2300, 350, 'LP-2');
  circle(15000, 12000, 1500); text(14000, 9800, 350, 'TR-1 500kVA');
  line(4400, 12000, 7000, 10500); line(4400, 11000, 5500, 11000); line(5500, 11000, 5500, 4500); line(5500, 4500, 7000, 4500);
  line(8600, 10500, 13500, 12000); line(8600, 10500, 27000, 10500); circle(27000, 10500, 400); text(25800, 9600, 300, 'P-1 급수펌프');
  for (let x = 1000; x < 29000; x += 4000) line(x, 600, x + 2000, 600, 'E-TRAY');
  text(1000, 900, 250, '케이블트레이 CT-1');
  line(2000, 1600, 12000, 1600, 'DIM'); text(6200, 1750, 250, '10,000');
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}

async function main() {
  if (db.prepare("SELECT 1 FROM sites WHERE code='DEMO-01'").get()) {
    console.log('시연 데이터가 이미 있습니다. (DEMO-01) 다시 만들려면 data 폴더를 지우고 실행하세요.');
    return;
  }
  const files = await makeFiles();
  const T = db.transaction.bind(db);
  // 사용자
  const user = (u, n, role) => {
    const ex = db.prepare('SELECT id FROM users WHERE username=?').get(u);
    if (ex) return ex.id;
    return Number(db.prepare('INSERT INTO users(username,password_hash,name,role) VALUES (?,?,?,?)').run(u, hashPassword(PW), n, role).lastInsertRowid);
  };
  let admin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id;
  if (!admin) admin = user('admin', '관리자(시연)', 'admin');
  const mgr = user('demo_manager', '현장관리자(시연)', 'site_manager');
  const worker = user('demo_worker', '작업자(시연)', 'worker');
  const viewer = user('demo_viewer', '조회자(시연)', 'viewer');
  const otherMgr = user('demo_other', '타현장 관리자(시연)', 'site_manager');

  const site = Number(db.prepare(`INSERT INTO sites(code,name,address,client,period,is_demo) VALUES ('DEMO-01','[시연] ○○센터 신축 전기·통신공사','시연용 주소','시연 발주처','2026.03 ~ 2026.12',1)`).run().lastInsertRowid);
  const site2 = Number(db.prepare(`INSERT INTO sites(code,name,is_demo) VALUES ('DEMO-02','[시연] △△초교 CCTV 설치공사',1)`).run().lastInsertRowid);
  const mem = db.prepare('INSERT INTO site_members(user_id,site_id,can_view,can_create,can_edit,can_delete,can_review) VALUES (?,?,?,?,?,?,?)');
  mem.run(mgr, site, 1, 1, 1, 1, 1);
  mem.run(worker, site, 1, 1, 1, 0, 0);
  mem.run(viewer, site, 1, 0, 0, 0, 0);
  mem.run(otherMgr, site2, 1, 1, 1, 1, 1);

  const A = (data) => svc.createAsset(site, { status: '사용 중', contractor: '시연전력', ...data }, admin);
  const C = (kind, a, b, extra = {}) => svc.createConnection(site, { kind, a, b, work_date: '2026-06-10', worker: '홍길동(시연)', ...extra }, admin);
  const port = (aid, name) => db.prepare('SELECT id FROM ports WHERE asset_id=? AND name=?').get(aid, name).id;
  const core = (cid, no) => db.prepare('SELECT id FROM cable_cores WHERE cable_id=? AND core_no=?').get(cid, no).id;

  const ids = {};
  T(() => {
    // ---- 전력 ----
    ids.LP1 = A({ mgmt_no: 'LP-1', category: 'panel', name: '1층 전등·동력 분전반', building: '본관', floor: '1F', room: '전기실', manufacturer: '시연배전', port_count: 6, details: { rated: '3P 100A', phase_wiring: '3Φ4W 380/220V' } });
    db.prepare(`UPDATE ports SET data=? WHERE asset_id=? AND name='L-1'`).run(JSON.stringify({ breaker: 'MCCB 3P 30A' }), ids.LP1);
    db.prepare(`UPDATE ports SET data=? WHERE asset_id=? AND name='L-2'`).run(JSON.stringify({ breaker: 'ELB 2P 20A' }), ids.LP1);
    ids.LD1 = A({ mgmt_no: 'LD-P1', category: 'load', name: '급수펌프 P-1 (7.5kW)', building: '본관', floor: '1F', room: '기계실', details: { rated: '7.5kW' } });
    ids.PC1 = A({ mgmt_no: 'PC-001', category: 'power_cable', name: '급수펌프 P-1 전원', building: '본관', floor: '1F', install_date: '2026-06-10',
      details: { panel_name: 'LP-1', circuit_no: 'L-1', cable_type: 'F-CV', size: '6sq', cores: '4C', parallel: '1', voltage: '380V', phase: '3상', wiring: '4선식', breaker_rating: 'MCCB 3P 30A', load_desc: '급수펌프 P-1 7.5kW',
        from_desc: 'LP-1 L-1', from_terminal: '2차측 R,S,T,N', to_desc: '급수펌프 P-1 제어반', to_terminal: 'TB1', via: '케이블트레이 CT-1 → 전선관 HI 36C', design_length: 42, actual_length: 45.5, slack: 2, length_basis: '도면 경로 + 입상 3m + 여장', laid_date: '2026-06-10', terminated_date: '2026-06-11', worker: '홍길동(시연)' } });
    C('power', { type: 'port', id: port(ids.LP1, 'L-1') }, { type: 'cable', id: ids.PC1, end: 'A' });
    C('power', { type: 'cable', id: ids.PC1, end: 'B' }, { type: 'asset', id: ids.LD1 });
    ids.PC2 = A({ mgmt_no: 'PC-002', category: 'power_cable', name: 'CCTV-02 전원', status: '시공 완료', details: { panel_name: 'LP-1', circuit_no: 'L-2', cable_type: 'F-CV', size: '2.5sq', cores: '2C', voltage: '220V', phase: '단상', wiring: '2선식', breaker_rating: 'ELB 2P 20A', load_desc: 'CCTV-02', design_length: 60 } });
    ids.PC3 = A({ mgmt_no: 'PC-003', category: 'power_cable', name: '예비 회로 (미측정·미연결 예시)', status: '시공 중', details: { cable_type: 'F-CV', size: '4sq', cores: '3C', design_length: 30 } });

    // ---- 광 ----
    ids.ODFA = A({ mgmt_no: 'ODF-A', category: 'odf', name: '통신실 ODF', building: '본관', floor: '1F', room: '통신실', port_count: 12 });
    ids.ODFB = A({ mgmt_no: 'ODF-B', category: 'odf', name: '2층 ODF', building: '본관', floor: '2F', port_count: 12 });
    ids.JC1 = A({ mgmt_no: 'JC-01', category: 'closure', name: '2층 천장 광접속함', building: '본관', floor: '2F' });
    ids.FO1 = A({ mgmt_no: 'FO-01', category: 'fiber_cable', name: '통신실-JC-01', details: { section_name: '통신실 ~ 2층 JC-01', cable_type: 'SM', spec: 'SM 12C', core_count: 12, from_desc: 'ODF-A', to_desc: 'JC-01', design_length: 80, actual_length: 84 } });
    ids.FO2 = A({ mgmt_no: 'FO-02', category: 'fiber_cable', name: 'JC-01-ODF-B', details: { section_name: 'JC-01 ~ 2층 ODF-B', cable_type: 'SM', spec: 'SM 12C', core_count: 12, from_desc: 'JC-01', to_desc: 'ODF-B', design_length: 25, actual_length: 27 } });
    for (const n of [1, 2]) {
      C('fixed', { type: 'port', id: port(ids.ODFA, 'P' + n), end: 'rear' }, { type: 'core', id: core(ids.FO1, n), end: 'A' });
      C('splice', { type: 'core', id: core(ids.FO1, n), end: 'B' }, { type: 'core', id: core(ids.FO2, n), end: 'A' }, { closure_asset_id: ids.JC1, tray: '1', sleeve: String(n) });
      C('fixed', { type: 'core', id: core(ids.FO2, n), end: 'B' }, { type: 'port', id: port(ids.ODFB, 'P' + n), end: 'rear' });
    }
    db.prepare(`UPDATE cable_cores SET purpose='CCTV 백본' WHERE cable_id IN (?,?) AND core_no=1`).run(ids.FO1, ids.FO2);
    db.prepare(`UPDATE cable_cores SET purpose='예비 회선' WHERE cable_id IN (?,?) AND core_no=2`).run(ids.FO1, ids.FO2);
    db.prepare(`UPDATE cable_cores SET status='불량', purpose='접속 손실 과다' WHERE cable_id=? AND core_no=12`).run(ids.FO1);
    // 광분배기
    ids.SP1 = A({ mgmt_no: 'SP-01', category: 'splitter', name: '1:4 분배기', port_count: 4, details: { ratio: '1:4' } });

    // ---- LAN / 랙 ----
    ids.RK1 = A({ mgmt_no: 'RACK-1', category: 'rack', name: '통신실 메인 랙', building: '본관', floor: '1F', room: '통신실', details: { units: '42U' } });
    ids.PP1 = A({ mgmt_no: 'PP-1', category: 'patch_panel', name: 'Cat.6 24포트 패치패널', parent_id: ids.RK1, port_count: 24 });
    ids.SW1 = A({ mgmt_no: 'SW-1', category: 'switch', name: 'PoE 스위치 24P', parent_id: ids.RK1, port_count: 24, manufacturer: '시연네트웍스', model: 'PS-2400', serial_no: 'SW1-DEMO-0001', details: { ip: '192.168.10.2', poe_budget: '370W' } });
    ids.SW2 = A({ mgmt_no: 'SW-2', category: 'switch', name: '2층 PoE 스위치 8P', building: '본관', floor: '2F', port_count: 8, details: { ip: '192.168.10.3' } });
    ids.NVR = A({ mgmt_no: 'NVR-1', category: 'nvr', name: '16채널 NVR', parent_id: ids.RK1, port_count: 16, manufacturer: '시연비전', model: 'NV-16', serial_no: 'NVR-DEMO-01', details: { ip: '192.168.10.10' } });
    ids.TO101 = A({ mgmt_no: 'TO-101', category: 'outlet', name: '사무실 101 정보콘센트', building: '본관', floor: '1F', room: '사무실 101', port_count: 2 });
    db.prepare(`UPDATE ports SET status='불량', data=? WHERE asset_id=? AND name='P24'`).run(JSON.stringify({ note: '키스톤 파손' }), ids.PP1);
    ids.LN1 = A({ mgmt_no: 'LN-001', category: 'lan_cable', name: '사무실 101 데이터', details: { cable_type: 'UTP', lan_category: 'Cat.6', shielded: 'UTP(비차폐)', rack: 'RACK-1', outlet_no: 'TO-101-1', outlet_location: '사무실 101 동측 벽', design_length: 35, actual_length: 38, poe: '미사용', laid_date: '2026-06-12' } });
    C('fixed', { type: 'port', id: port(ids.PP1, 'P1'), end: 'rear' }, { type: 'cable', id: ids.LN1, end: 'A' });
    C('fixed', { type: 'cable', id: ids.LN1, end: 'B' }, { type: 'port', id: port(ids.TO101, 'P1'), end: 'rear' });
    C('patch', { type: 'port', id: port(ids.SW1, 'P1') }, { type: 'port', id: port(ids.PP1, 'P1'), end: 'front' });

    // ---- CCTV ----
    ids.CAM1 = A({ mgmt_no: 'CCTV-01', category: 'cctv', name: '주차장 진입부 카메라', building: '본관', floor: '1F', room: '주차장 진입부', manufacturer: '시연비전', model: 'IPC-4M', serial_no: 'CAM-DEMO-0001', install_date: '2026-06-15',
      details: { install_height: 3.2, direction: '북측 진입로', ip: '192.168.10.101', mac: '00:11:22:33:44:01', power_method: 'PoE', warranty_start: '2026-06-15', warranty_end: '2026-12-15', supplier_contact: '시연비전 A/S 02-000-0000' } });
    ids.LN2 = A({ mgmt_no: 'LN-002', category: 'lan_cable', name: 'CCTV-01 PoE', details: { cable_type: 'UTP', lan_category: 'Cat.6', shielded: 'UTP(비차폐)', rack: 'RACK-1', design_length: 55, actual_length: 58, poe: '사용' } });
    C('fixed', { type: 'port', id: port(ids.PP1, 'P2'), end: 'rear' }, { type: 'cable', id: ids.LN2, end: 'A' });
    C('fixed', { type: 'cable', id: ids.LN2, end: 'B' }, { type: 'port', id: port(ids.CAM1, 'LAN') });
    C('patch', { type: 'port', id: port(ids.SW1, 'P2') }, { type: 'port', id: port(ids.PP1, 'P2'), end: 'front' });
    C('comm', { type: 'asset', id: ids.CAM1 }, { type: 'port', id: port(ids.NVR, 'CH1') }, { note: '영상 채널 등록 (논리 연결)' });
    // CCTV-02: 광 경유 + AC 전원
    ids.CAM2 = A({ mgmt_no: 'CCTV-02', category: 'cctv', name: '2층 복도 카메라', building: '본관', floor: '2F', manufacturer: '시연비전', model: 'IPC-2M', serial_no: 'CAM-DEMO-0002', install_date: '2026-06-20',
      details: { install_height: 2.8, direction: '복도 동측', ip: '192.168.10.102', power_method: 'AC 220V', warranty_start: '2025-11-01', warranty_end: '2026-11-30', supplier_contact: '시연비전 A/S 02-000-0000' } });
    C('patch', { type: 'port', id: port(ids.SW1, 'P10') }, { type: 'port', id: port(ids.ODFA, 'P1'), end: 'front' });
    C('patch', { type: 'port', id: port(ids.ODFB, 'P1'), end: 'front' }, { type: 'port', id: port(ids.SW2, 'P1') });
    ids.LN3 = A({ mgmt_no: 'LN-003', category: 'lan_cable', name: 'CCTV-02 데이터', details: { cable_type: 'UTP', lan_category: 'Cat.6', design_length: 20, poe: '미사용' } });
    C('fixed', { type: 'port', id: port(ids.SW2, 'P2') }, { type: 'cable', id: ids.LN3, end: 'A' });
    C('fixed', { type: 'cable', id: ids.LN3, end: 'B' }, { type: 'port', id: port(ids.CAM2, 'LAN') });
    C('power', { type: 'port', id: port(ids.LP1, 'L-2') }, { type: 'cable', id: ids.PC2, end: 'A' });
    C('power', { type: 'cable', id: ids.PC2, end: 'B' }, { type: 'port', id: port(ids.CAM2, 'PWR') });
    C('comm', { type: 'asset', id: ids.CAM2 }, { type: 'port', id: port(ids.NVR, 'CH2') }, { note: '영상 채널 등록 (논리 연결)' });
  })();

  // ---- 시험기준 (시연용 예시값. 실제 현장은 설계도서·감리 승인 기준으로 등록) ----
  const crit = (code, tt, cat, name, unit, cmp, val, cond, basis) => db.prepare(`INSERT INTO test_criteria(site_id, code, version, test_type, target_category, name, unit, comparator, value, conditions, basis_doc, effective_date, created_by)
    VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?)`).run(site, code, tt, cat, name, unit, cmp, val, JSON.stringify(cond), basis, '2026-01-01', admin);
  crit('DEMO-IR', 'insulation', 'power_cable', '[시연] 저압 절연저항', 'MΩ', '>=', 1, { test_voltage: 500 }, '시연용 예시 — 실제 적용 시 설계도서·관련 기준 확인 후 등록');
  crit('DEMO-OL', 'optical_loss', 'fiber_cable', '[시연] 구간 광손실', 'dB', '<=', 3, { wavelength: 1310 }, '시연용 예시 — 실제 적용 시 승인 기준 확인');
  // LAN 성능시험 기준은 일부러 미설정 → '판정기준 미설정' 표시 예시

  const meas = (aid, b) => {
    const a = db.prepare('SELECT category FROM assets WHERE id=?').get(aid);
    const j = judge(site, a.category, b);
    return Number(db.prepare(`INSERT INTO measurements(site_id, asset_id, core_id, test_type, measured_at, section, combination, test_voltage, wavelength, direction, value, unit, items, overall, instrument, measurer, criteria_id, criteria_snapshot, auto_result, auto_reason, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(site, aid, b.core_id || null, b.test_type, b.measured_at, b.section || null, b.combination || null, b.test_voltage || null, b.wavelength || null, b.direction || null,
      b.value ?? null, b.unit || null, b.items ? JSON.stringify(b.items) : null, b.overall || null, b.instrument || null, b.measurer || null, j.criteria?.id || null, j.criteria ? JSON.stringify(j.criteria) : null, j.result, j.reason, admin).lastInsertRowid);
  };
  T(() => {
    const first = [];
    for (const [comb, val] of [['L1-E', 520], ['L2-E', 510], ['L3-E', 505], ['N-E', 498]]) first.push(meas(ids.PC1, { test_type: 'insulation', measured_at: '2026-06-11 14:00', section: 'LP-1 ~ P-1', combination: comb, test_voltage: 500, value: val, unit: 'MΩ', instrument: '절연저항계 (시연)', measurer: '홍길동(시연)' }));
    meas(ids.PC1, { test_type: 'insulation', measured_at: '2026-09-01 10:00', section: 'LP-1 ~ P-1', combination: 'L1-E', test_voltage: 500, value: 0.4, unit: 'MΩ', instrument: '절연저항계 (시연)', measurer: '김철수(시연)' });
    meas(ids.PC1, { test_type: 'insulation', measured_at: '2026-09-02 09:00', section: 'LP-1 ~ P-1', combination: 'L1-E', test_voltage: 500, value: 480, unit: 'MΩ', instrument: '절연저항계 (시연)', measurer: '김철수(시연)' });
    meas(ids.PC2, { test_type: 'insulation', measured_at: '2026-06-21 11:00', combination: 'L-E', test_voltage: 250, value: 300, unit: 'MΩ', instrument: '절연저항계 (시연)', measurer: '홍길동(시연)' }); // 조건 불일치 → 판정 불가
    meas(ids.FO1, { test_type: 'optical_loss', core_id: core(ids.FO1, 1), measured_at: '2026-06-18 15:00', section: 'ODF-A ~ ODF-B', wavelength: 1310, direction: 'A→B', value: 1.2, unit: 'dB', instrument: '광파워미터 (시연)', measurer: '이영희(시연)' });
    meas(ids.FO1, { test_type: 'optical_loss', core_id: core(ids.FO1, 12), measured_at: '2026-06-18 15:10', section: 'ODF-A ~ ODF-B', wavelength: 1310, direction: 'A→B', value: 4.8, unit: 'dB', instrument: '광파워미터 (시연)', measurer: '이영희(시연)' });
    meas(ids.LN1, { test_type: 'lan_cert', measured_at: '2026-06-13 10:00', section: 'PP-1 P1 ~ TO-101-1', items: [{ name: 'Wire Map', result: 'PASS' }, { name: 'Length', result: '38m' }, { name: 'NEXT', result: 'PASS' }], overall: 'PASS (측정기 판정)', instrument: '케이블 인증시험기 (시연)', measurer: '이영희(시연)' });
    db.prepare(`UPDATE measurements SET review_status='승인', reviewed_by=?, reviewed_at='2026-06-12 09:00' WHERE id IN (${first.join(',')})`).run(mgr);
    db.prepare(`UPDATE measurements SET review_status='재시험 필요', reviewed_by=?, reviewed_at='2026-09-01 15:00', review_note='단말부 습기 확인 후 재측정' WHERE asset_id=? AND measured_at='2026-09-01 10:00'`).run(mgr, ids.PC1);
    const rep = saveUploaded(fileObj(files.report, '절연저항_성적서_PC-001.pdf'), { siteId: site, ownerType: 'measurement', ownerId: first[0], category: 'report', userId: admin });

    const wl = (aid, t, at, content, extra = {}) => Number(db.prepare(`INSERT INTO work_logs(site_id, asset_id, work_type, work_at, content, worker, company, before_value, after_value, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(site, aid, t, at, content, extra.worker || '홍길동(시연)', '시연전력', extra.before || null, extra.after || null, extra.status || '확정', admin).lastInsertRowid);
    wl(ids.PC1, '포설', '2026-06-10 09:00', '트레이 CT-1 경유 포설, 실측 45.5m');
    const t = wl(ids.PC1, '단말 처리', '2026-06-11 10:00', 'LP-1 L-1 및 P-1 제어반 단말 처리 (압착단자)');
    wl(ids.PC1, '보수', '2026-09-02 08:30', '절연저항 저하(0.4MΩ) → P-1측 단말 재처리 후 재측정', { before: 'L1-E 0.4MΩ', after: 'L1-E 480MΩ', worker: '김철수(시연)', status: '검토 요청' });
    saveUploaded(fileObj(files['before.jpg'], 'L3_단말전.jpg'), { siteId: site, ownerType: 'worklog', ownerId: t, category: 'photo_before', userId: admin });
    saveUploaded(fileObj(files['after.jpg'], 'L3_단말후.jpg'), { siteId: site, ownerType: 'worklog', ownerId: t, category: 'photo_after', userId: admin });
    const c1 = wl(ids.CAM1, '신규 설치', '2026-06-15 13:00', '브래킷 고정, PoE 연결, NVR CH1 등록');
    saveUploaded(fileObj(files['cam.jpg'], 'CCTV-01_설치.jpg'), { siteId: site, ownerType: 'worklog', ownerId: c1, category: 'photo_after', userId: admin });
    saveUploaded(fileObj(files['rack.jpg'], 'RACK-1.jpg'), { siteId: site, ownerType: 'asset', ownerId: ids.PP1, category: 'photo', userId: admin });
    db.prepare(`INSERT INTO asset_secrets(asset_id, data, updated_by) VALUES (?,?,?)`).run(ids.CAM1, JSON.stringify({ login_id: 'admin', password: 'demo-cam-pass', memo: '시연용' }), admin);
    void rep;

    // ---- 도면 ----
    const d = Number(db.prepare(`INSERT INTO drawings(site_id, drawing_no, title, discipline, created_by) VALUES (?,?,?,?,?)`).run(site, 'E-101', '1·2층 전력·통신 평면도 (시연)', '전력·통신', admin).lastInsertRowid);
    const pages = JSON.stringify([{ w: 1190.55, h: 841.89, rotate: 0 }, { w: 1190.55, h: 841.89, rotate: 0 }]);
    const rA = Number(db.prepare(`INSERT INTO drawing_revisions(drawing_id, rev_no, rev_date, reason, display_type, pages_json, scales_json, review_status, created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(d, 'A', '2026-05-01', '최초 발행', 'pdf', pages, JSON.stringify({ 1: { p1: [0.1, 0.9], p2: [0.3, 0.9], len_m: 10 } }), '검토 완료', admin).lastInsertRowid);
    const fA = saveUploaded(fileObj(files.planA, 'E-101_RevA.pdf'), { siteId: site, ownerType: 'revision', ownerId: rA, category: 'drawing', userId: admin });
    db.prepare('UPDATE drawing_revisions SET display_file_id=? WHERE id=?').run(fA, rA);
    const mk = (rev, page, aid, shape, geom, recheck = 0) => db.prepare('INSERT INTO drawing_marks(revision_id,page,asset_id,shape,geom,needs_recheck,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)').run(rev, page, aid, shape, JSON.stringify(geom), recheck, admin, admin);
    const marksA = [
      [1, ids.LP1, 'point', { x: 0.10, y: 0.20 }], [1, ids.LD1, 'point', { x: 0.80, y: 0.30 }],
      [1, ids.PC1, 'polyline', { pts: [[0.10, 0.20], [0.10, 0.49], [0.66, 0.49], [0.66, 0.30], [0.80, 0.30]] }],
      [1, ids.RK1, 'rect', { x: 0.43, y: 0.17, w: 0.04, h: 0.06 }], [1, ids.TO101, 'point', { x: 0.30, y: 0.70 }],
      [1, ids.LN1, 'polyline', { pts: [[0.45, 0.20], [0.45, 0.50], [0.30, 0.50], [0.30, 0.70]] }],
      [1, ids.CAM1, 'point', { x: 0.90, y: 0.70 }],
      [1, ids.LN2, 'polyline', { pts: [[0.45, 0.20], [0.45, 0.50], [0.67, 0.50], [0.67, 0.70], [0.90, 0.70]] }],
      [1, ids.PC2, 'polyline', { pts: [[0.10, 0.20], [0.12, 0.20], [0.12, 0.49], [0.66, 0.49]] }],
      [2, ids.CAM2, 'point', { x: 0.20, y: 0.30 }], [2, ids.JC1, 'point', { x: 0.70, y: 0.60 }],
      [2, ids.FO2, 'polyline', { pts: [[0.70, 0.60], [0.85, 0.60], [0.85, 0.20]] }],
    ];
    for (const [p, aid, s, g] of marksA) mk(rA, p, aid, s, g);
    // Rev.B: 통신실 위치 변경 → 이전 표시 복사, '위치 재확인 필요'
    const rB = Number(db.prepare(`INSERT INTO drawing_revisions(drawing_id, rev_no, rev_date, reason, display_type, pages_json, scales_json, review_status, copied_from_revision_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(d, 'B', '2026-08-20', '통신실 벽체 이동 (설계변경)', 'pdf', pages, JSON.stringify({ 1: { p1: [0.1, 0.9], p2: [0.3, 0.9], len_m: 10 } }), '검토 대기', rA, admin).lastInsertRowid);
    const fB = saveUploaded(fileObj(files.planB, 'E-101_RevB.pdf'), { siteId: site, ownerType: 'revision', ownerId: rB, category: 'drawing', userId: admin });
    db.prepare('UPDATE drawing_revisions SET display_file_id=? WHERE id=?').run(fB, rB);
    for (const m of db.prepare('SELECT * FROM drawing_marks WHERE revision_id=?').all(rA)) {
      db.prepare('INSERT INTO drawing_marks(revision_id,page,asset_id,shape,geom,needs_recheck,copied_from_mark_id,created_by,updated_by) VALUES (?,?,?,?,?,1,?,?,?)').run(rB, m.page, m.asset_id, m.shape, m.geom, m.id, admin, admin);
    }
    db.prepare(`INSERT INTO audit_logs(user_id, site_id, action, entity, detail) VALUES (?,?,?,?,?)`).run(admin, site, 'seed', 'demo', '{"note":"시연 데이터 생성"}');
  })();

  // ---- 추가 기능 시연: DXF 자동 변환 도면, OTDR 원본, 실시간 감시 ----
  try {
    const { convertCad } = require('./lib/cad');
    const dxf = demoDxf();
    const dxfPath = path.join(os.tmpdir(), 'E-102_시연.dxf'); fs.writeFileSync(dxfPath, dxf);
    const conv = await convertCad(Buffer.from(dxf), '.dxf');
    const pdfPath = dxfPath.replace('.dxf', '_자동변환.pdf'); fs.writeFileSync(pdfPath, conv.pdf);
    T(() => {
      const d = Number(db.prepare(`INSERT INTO drawings(site_id, drawing_no, title, discipline, created_by) VALUES (?,?,?,?,?)`).run(site, 'E-102', '전기실 단선 배치도 (시연·DXF 자동 변환)', '전력', admin).lastInsertRowid);
      const rv = Number(db.prepare(`INSERT INTO drawing_revisions(drawing_id, rev_no, rev_date, reason, display_type, conversion_note, review_status, created_by) VALUES (?,?,?,?,?,?,?,?)`).run(d, 'A', '2026-09-10', 'DXF 원본만 등록 → PDF 자동 생성', 'pdf', conv.note, '검토 대기', admin).lastInsertRowid);
      const src = saveUploaded(fileObj(dxfPath, 'E-102_시연.dxf'), { siteId: site, ownerType: 'revision', ownerId: rv, category: 'dwg_original', userId: admin });
      const disp = saveUploaded(fileObj(pdfPath, 'E-102_시연_자동변환.pdf'), { siteId: site, ownerType: 'revision', ownerId: rv, category: 'drawing', userId: admin });
      db.prepare('UPDATE drawing_revisions SET source_file_id=?, display_file_id=? WHERE id=?').run(src, disp, rv);
    })();
  } catch (e) { console.error('DXF 시연 도면 생성 실패:', e.message); }
  try {
    const { parseSor } = require('./lib/sor');
    const sorPath = path.join(__dirname, '..', 'test', 'fixtures', 'sample1310_lowDR.sor');
    if (fs.existsSync(sorPath)) {
      const p = parseSor(fs.readFileSync(sorPath));
      T(() => {
        const mid = meas(ids.FO1, { test_type: 'otdr', core_id: core(ids.FO1, 1), measured_at: p.fxd.datetime.replace('T', ' ').slice(0, 16), section: 'ODF-A → ODF-B (시연용 샘플 파일)', wavelength: p.fxd.wavelength_nm, direction: 'A→B',
          value: p.summary.total_loss_db, unit: 'dB', items: p.events.map(e => ({ name: `#${e.no} ${e.distance_km.toFixed(3)} km ${e.type}`, result: `접속손실 ${e.splice_loss_db} dB · 반사 ${e.refl_loss_db} dB` })),
          overall: `광섬유 길이 ${p.fiber_length_km.toFixed(3)} km · 총손실 ${p.summary.total_loss_db} dB`, instrument: [p.sup.supplier, p.sup.otdr].join(' '), measurer: '이영희(시연)' });
        const fid = saveUploaded(fileObj(sorPath, 'FO-01_core1_1310.sor'), { siteId: site, ownerType: 'measurement', ownerId: mid, category: 'report', caption: 'OTDR 원본', userId: admin });
        db.prepare('UPDATE measurements SET source_file_id=? WHERE id=?').run(fid, mid);
      })();
    }
  } catch (e) { console.error('OTDR 시연 기록 생성 실패:', e.message); }
  // 감시: CCTV-01 은 이 서버 자신(항상 응답) / CCTV-02 는 응답 없는 시험용 주소(192.0.2.x)로 설정해 두 가지 결과를 보여줌
  db.prepare(`INSERT INTO monitors(site_id, asset_id, method, host, port, interval_sec, fail_threshold, created_by) VALUES (?,?,?,?,?,?,?,?)`).run(site, ids.CAM1, 'tcp', '127.0.0.1', Number(process.env.PORT || 3000), 60, 1, admin);
  db.prepare(`INSERT INTO monitors(site_id, asset_id, method, host, port, interval_sec, timeout_ms, fail_threshold, created_by) VALUES (?,?,?,?,?,?,?,?,?)`).run(site, ids.CAM2, 'tcp', '192.0.2.10', 554, 60, 2000, 1, admin);
  db.prepare(`INSERT INTO monitors(site_id, asset_id, method, interval_sec, push_stale_sec, created_by) VALUES (?,?,?,?,?,?)`).run(site, ids.NVR, 'push', 60, 600, admin);

  // 다른 현장 데이터 (권한 차단 시험용)
  svc.createAsset(site2, { mgmt_no: 'CCTV-A01', category: 'cctv', name: '정문 카메라', status: '사용 중' }, admin);
  console.log('시연 데이터 생성 완료');
  console.log(`시연 계정 (비밀번호 ${process.env.DEMO_PASSWORD ? '(DEMO_PASSWORD)' : PW}): demo_manager, demo_worker, demo_viewer, demo_other`);
}

main().catch(e => { console.error(e); process.exit(1); });
