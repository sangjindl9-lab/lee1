#!/usr/bin/env node
/* IP·동축 혼합 샘플 프로젝트 생성 (API 사용, 실제 사용자 작업과 같은 경로로 저장)
 * 사용: BASE_URL=http://localhost:3000 ADMIN_USER=admin ADMIN_PASSWORD=... node scripts/seed-sample.js */
const path = require('path');
const crypto = require('crypto');
const { Client } = require('./client');
const IN = path.join(__dirname, '..', 'samples', 'input');
const id = () => crypto.randomUUID();
const S = 20; const m = (x, y) => [x * S, y * S];

async function main() {
  const c = new Client();
  await c.login(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD || 'admin1234');
  // ----- 샘플 품목 (검증용 입력값: 실제 제품 사양 아님) -----
  const NOTE = '샘플 입력값 – 실제 제품 사양이 아니며 검증용으로만 사용';
  const prod = async p => (await c.post('/api/products', { ...p, props: { ...p.props, note: NOTE } })).id;
  const P = {
    coax: await prod({ category: 'cable', kind: 'coax', name: '[샘플] 동축케이블', spec: '5C-FB', unit: 'm', props: { impedance: 75, od_mm: 7.0, attenuation: [{ freq_mhz: 10, db_per_100m: 2.0 }, { freq_mhz: 50, db_per_100m: 4.5 }], recommended: [{ signal: 'AHD', res_mp: 2, max_m: 300, source: '샘플 입력값(검증용)' }, { signal: 'HD-TVI', res_mp: 2, max_m: 300, source: '샘플 입력값(검증용)' }], connectors: 'BNC' } }),
    comp: await prod({ category: 'cable', kind: 'composite', name: '[샘플] 영상·전원 복합케이블', spec: '5C-FB+2C 0.75㎟', unit: 'm', props: { impedance: 75, od_mm: 9.5, video_spec: '5C-FB', power_cores: 2, power_mm2: 0.75, recommended: [{ signal: 'AHD', res_mp: 2, max_m: 250, source: '샘플 입력값(검증용)' }] } }),
    utp: await prod({ category: 'cable', kind: 'utp', name: '[샘플] UTP 케이블', spec: 'CAT.6 4P', unit: 'm', props: { od_mm: 6.0, max_length_m: 100, max_length_basis: '채널 100m 일반 기준', pairs: 4 } }),
    pwr: await prod({ category: 'cable', kind: 'power', name: '[샘플] 전원케이블', spec: 'VCTF 2C 1.5㎟', unit: 'm', props: { od_mm: 7.2, cores: 2, conductor_mm2: 1.5 } }),
    fib: await prod({ category: 'cable', kind: 'fiber', name: '[샘플] 광케이블 SM', spec: '4C', unit: 'm', props: { od_mm: 8.0, cores: 4, mode: 'SM' } }),
    elp: await prod({ category: 'conduit', kind: 'pipe', name: '[샘플] ELP 관', spec: '50mm', unit: 'm', props: { inner_d_mm: 50 } }),
    pvc: await prod({ category: 'conduit', kind: 'pipe', name: '[샘플] HI-PVC 전선관', spec: '28mm', unit: 'm', props: { inner_d_mm: 28 } }),
    bnc: await prod({ category: 'accessory', kind: 'connector', name: '[샘플] BNC 커넥터', spec: '5C 압착형', unit: 'EA', props: { role: 'bnc', impedance: 75, od_min_mm: 6.5, od_max_mm: 7.5 } })
  };
  // ----- 프로젝트 -----
  const proj = await c.post('/api/projects', { name: '[샘플] ○○물류센터 CCTV 설치공사', address: '경기도 ○○시 ○○로 123 (가상 현장)', client: '○○물류(주)', designer: '샘플 설계사무소', contractor: '샘플 시공사', author: '관리자', written_at: '2026-11-03', drawing_no: 'CCTV-001', revision: '0', system_type: '혼합형', is_sample: true });
  const pid = proj.id;
  const SYMID = id();
  await c.put(`/api/projects/${pid}`, { settings: { custom_symbols: [{ id: SYMID, label: '비상벨', prefix: 'EB', prims: [{ t: 'circle', x: 0, y: 0, r: 0.42, fill: 'w' }, { t: 'poly', p: '-0.25,0.15 0,-0.25 0.25,0.15', close: true, fill: 'k' }, { t: 'text', x: 0, y: 0.3, s: 'EB', size: 0.2 }] }], slack: { mode: 'ratio', value: 10, target: 'all' }, round_unit_m: 1, fill_limit_pct: 32, fill_basis: '샘플 프로젝트 사용자 입력 기준', vd_limit_pct: 10, coupling_interval_m: 4, ppm_threshold: 125, sign_design: '홍길동', sign_review: '김검토', sign_approve: '' } });
  // ----- 도면: 현장 배치 이미지 -----
  let up = await c.upload(`/api/projects/${pid}/files`, path.join(IN, '현장배치도.png')); await c.job(up.job);
  let j = await c.job((await c.post(`/api/projects/${pid}/sheets`, { file_id: up.file.id, pages: [{ page: 1, name: '현장 CCTV 배치도' }], building: '전체', floor: '옥외', zone: '부지' })).job);
  const site = j.result.sheet_ids[0];
  // 축척: 도면의 10m 막대 (5m,77m)~(15m,77m)
  let model = await c.get(`/api/projects/${pid}/model`);
  await c.put(`/api/sheets/${site}`, { data: { scale: { upm: (m(15, 77)[0] - m(5, 77)[0]) / 10, p1: m(5, 77), p2: m(15, 77), real: 10, unit: 'm', source: 'calib', confirmed: true } }, ver: model.sheets.find(s => s.id === site).ver });
  // ----- 도면: 관리동 DXF -----
  up = await c.upload(`/api/projects/${pid}/files`, path.join(IN, '관리동_1층.dxf')); const meta = (await c.job(up.job)).result;
  j = await c.job((await c.post(`/api/projects/${pid}/sheets`, { file_id: up.file.id, pages: [{ page: 1, name: '관리동 1층 CCTV 배치도' }], space: 'model', building: '관리동', floor: '1층' })).job);
  const dxf = j.result.sheet_ids[0];
  model = await c.get(`/api/projects/${pid}/model`);
  const ds = model.sheets.find(s => s.id === dxf);
  await c.put(`/api/sheets/${dxf}`, { data: { scale: { ...ds.scale, confirmed: true, note: 'CAD 단위 mm 확인' } }, ver: ds.ver });
  const O = ds.bg.origin; const cad = (X, Y) => [X - O[0], O[1] - Y];

  // ----- 장비 -----
  const D = {}; const devs = [];
  const dev = (tag, type, sheet, xy, props, extra) => { const d = { id: id(), sheet_id: sheet, type, tag, name: '', x: xy[0], y: xy[1], layer: { custom: 'NEW', camera: 'CCTV', nvr: 'REC', dvr: 'REC', poe_switch: 'NET', psu: 'POWER', coax_spd: 'COAX', coax_joint: 'COAX', cabinet: 'BOX', handhole: 'RACEWAY', offpage: 'TEXT' }[type], status: '신설', props: props || {}, ...(extra || {}) }; D[tag] = d; devs.push(d); return d; };
  const box = dev('BOX-01', 'cabinet', site, m(30, 29), { location: '관리동 통신실', note: '랙형 통신함체' });
  const nvr = dev('NVR-01', 'nvr', site, m(27, 31), { maker: '[샘플]', model: 'NVR-16', channels: 16, lan_ports: 1, ip: '192.168.10.10', record_days: 30, record_hours: 24, record_mode: '연속', disk_count: 4, disk_tb: 4, raid: 'RAID5', container_id: box.id });
  const dvr = dev('DVR-01', 'dvr', site, m(31, 31), { maker: '[샘플]', model: 'DVR-8', channels: 8, ip: '192.168.10.11', supported_inputs: [{ signal: 'AHD', max_res_mp: 5, max_fps: 30 }, { signal: 'HD-TVI', max_res_mp: 5, max_fps: 30 }, { signal: 'CVBS', max_res_mp: 0.4, max_fps: 30 }], video_impedance: 75, termination_required: true, termination_set: true, record_days: 30, record_hours: 24, record_mode: '연속', record_bitrate_mbps: 2, disk_count: 1, disk_tb: 4, raid: '없음', container_id: box.id });
  const sw1 = dev('PSW-01', 'poe_switch', site, m(23, 31), { maker: '[샘플]', ports: 8, sfp_ports: 2, poe_budget_w: 120, poe_port_max_w: 30, ip: '192.168.10.2', container_id: box.id });
  const sw2 = dev('PSW-02', 'poe_switch', site, m(68, 38), { maker: '[샘플]', ports: 8, sfp_ports: 2, poe_budget_w: 120, poe_port_max_w: 30, ip: '192.168.10.3', location: '창고동 통신함' });
  const psu = dev('PSU-01', 'psu', site, m(35, 31), { outputs: 4, voltage: 12, current_type: 'DC', capacity_w: 60, container_id: box.id });
  const hh = dev('HH-01', 'handhole', site, m(34, 42), {});
  const refS = dev('REF-01', 'offpage', site, m(19, 31), { link_ref: 'R1' });
  const refD = dev('REF-02', 'offpage', dxf, cad(25000, 16000), { link_ref: 'R1' });
  const ipCam = (n, sheet, xy, dir, form) => dev(`IPC-0${n}`, 'camera', sheet, xy, { system: 'IP', form, maker: '[샘플]', model: 'IPC-4MP', resolution: '2560×1440', h_pixels: 2560, hfov: form === '돔형' ? 100 : 88, vfov: 50, direction: dir, tilt: 20, height: form === '돔형' ? 2.7 : 4, range: form === '돔형' ? 12 : 25, poe: true, poe_w: 6.5, power_w: 6.5, bitrate_mbps: 4, ip: `192.168.10.${100 + n}`, subnet: '255.255.255.0', vlan: '10', nvr_id: nvr.id, nvr_channel: n, housing: form === '불릿형' ? '[샘플] 옥외 방수함' : '', bracket: form === '불릿형' ? '[샘플] 벽부 브래킷' : '' });
  ipCam(1, dxf, cad(1500, 23500), 135, '돔형'); ipCam(2, dxf, cad(1500, 1500), 45, '돔형');
  ipCam(3, site, m(10, 36), 200, '불릿형'); ipCam(4, site, m(50, 36), 160, '불릿형');
  ipCam(5, site, m(65, 9), 315, '불릿형'); ipCam(6, site, m(110, 9), 45, '불릿형'); ipCam(7, site, m(110, 42), 135, '불릿형'); ipCam(8, site, m(70, 47), 170, '불릿형');
  const anCam = (n, xy, dir, mode) => dev(`ANC-0${n}`, 'camera', site, xy, { system: '동축', form: '불릿형', maker: '[샘플]', model: 'AHD-2MP', signal: 'AHD', out_res_mp: 2, out_fps: 30, video_out: 'BNC', video_impedance: 75, power_mode: mode, power_w: 5, power_source: 'DC 12V', hfov: 85, vfov: 48, direction: dir, tilt: 25, height: 4, range: 20, bracket: '[샘플] 폴 브래킷' });
  anCam(1, m(12, 66), 45, '별도전원'); anCam(2, m(58, 66), 315, '별도전원'); anCam(3, m(12, 44), 135, '복합케이블'); anCam(4, m(58, 44), 225, '복합케이블');
  dev('EB-01', 'custom', site, m(40, 60), { custom_label: '비상벨', symbol_id: SYMID, prefix: 'EB', note: '사용자 정의 심볼 예시(연결은 별도 설계)' });
  const jt = dev('JT-01', 'coax_joint', site, m(10, 50), { note: '동축 중간 접속점(BNC I형)' });
  const spd = dev('VSPD-01', 'coax_spd', site, m(10, 62), { supported_signals: ['AHD', 'HD-TVI', 'CVBS'], video_impedance: 75 });

  // ----- 관로 -----
  const cds = [];
  const cond = (tag, pr, pts, method, from, to) => { const x = { id: id(), sheet_id: site, tag, product_id: pr, points: pts, method, status: '신설', extra_m: 0, vertical_m: 0, from_node: from || null, to_node: to || null }; cds.push(x); return x; };
  const p1 = cond('PIPE-01', P.elp, [m(34, 33), m(34, 42)], '매설', null, hh.id);
  const p2 = cond('PIPE-02', P.elp, [m(34, 42), m(10, 42)], '매설', hh.id, null);
  const p3 = cond('PIPE-03', P.elp, [m(34, 42), m(60, 42)], '매설', hh.id, null);
  const p4 = cond('PIPE-04', P.pvc, [m(40, 36), m(62, 36), m(62, 38)], '노출');
  // ----- 케이블 -----
  const cabs = [];
  const cab = (tag, kind, pr, sheet, from, fport, to, tport, way, extra) => { const fd = D[from], td = D[to]; const x = { id: id(), sheet_id: sheet, kind, tag, product_id: pr, points: [[fd.x, fd.y], ...way, [td.x, td.y]], from: { dev: fd.id, port: fport }, to: { dev: td.id, port: tport }, vertical_m: 0, entry_m: 1, slack: { mode: 'project' }, status: '신설', method: '', conduit_ids: [], props: {}, ...(extra || {}) }; cabs.push(x); return x; };
  const trunkW = [m(34, 33), m(34, 42), m(10, 42)], trunkE = [m(34, 33), m(34, 42), m(60, 42)];
  // IP: 관리동 내부(DXF) → 연결 참조 → 현장도 PSW-01
  const u1 = cab('U-01', 'utp', P.utp, dxf, 'IPC-01', 'LAN', 'REF-02', 'A', [cad(1500, 13000), cad(25000, 13000)], { vertical_m: 3, method: '천장 배관' });
  const u2 = cab('U-02', 'utp', P.utp, dxf, 'IPC-02', 'LAN', 'REF-02', 'A', [cad(1500, 12000), cad(25000, 12000)], { vertical_m: 3, method: '천장 배관' });
  cab('U-01', 'utp', P.utp, site, 'REF-01', 'A', 'PSW-01', 'P1', [], { parent_id: u1.id, entry_m: 0.5 });
  cab('U-02', 'utp', P.utp, site, 'REF-01', 'A', 'PSW-01', 'P2', [m(19, 30), m(23, 30)], { parent_id: u2.id, entry_m: 0.5 });
  cab('U-03', 'utp', P.utp, site, 'PSW-01', 'P3', 'IPC-03', 'LAN', [m(23, 35), m(10, 35)], { vertical_m: 3, method: '노출' });
  cab('U-04', 'utp', P.utp, site, 'PSW-01', 'P4', 'IPC-04', 'LAN', [m(23, 33), m(50, 33)], { vertical_m: 3, method: '노출' });
  cab('U-05', 'utp', P.utp, site, 'PSW-02', 'P1', 'IPC-05', 'LAN', [m(68, 12), m(65, 12)], { vertical_m: 3 });
  cab('U-06', 'utp', P.utp, site, 'PSW-02', 'P2', 'IPC-06', 'LAN', [m(68, 12), m(110, 12)], { vertical_m: 3 });
  cab('U-07', 'utp', P.utp, site, 'PSW-02', 'P3', 'IPC-07', 'LAN', [m(110, 38)], { vertical_m: 3 });
  cab('U-08', 'utp', P.utp, site, 'PSW-02', 'P4', 'IPC-08', 'LAN', [m(70, 40)], { vertical_m: 3 });
  cab('U-09', 'utp', P.utp, site, 'PSW-01', 'P8', 'NVR-01', 'LAN1', [m(23, 30), m(27, 30)], { entry_m: 0.5, props: { factory_terminated: true } });
  const f1 = cab('F-01', 'fiber', P.fib, site, 'PSW-01', 'SFP1', 'PSW-02', 'SFP1', [m(23, 34), m(40, 36), m(62, 36), m(62, 38)], { entry_m: 2, props: { cores_spare: 2, core_map: 'SFP 양방향 2심', core_assign: [{ core: 1, use: '사용', target: 'PSW-01 SFP1 TX ↔ PSW-02 SFP1 RX' }, { core: 2, use: '사용', target: 'PSW-01 SFP1 RX ↔ PSW-02 SFP1 TX' }, { core: 3, use: '예비' }, { core: 4, use: '예비' }] }, conduit_ids: [p4.id] });
  // 동축: ANC-01 (DVR CH1 → 중간 접속점 → 서지보호기 → 카메라), 별도 전원
  cab('C-01', 'coax', P.coax, site, 'DVR-01', 'CH1', 'JT-01', 'IN', [m(34, 33), m(34, 42), m(10, 42)], { conduit_ids: [p1.id, p2.id], props: { conn_from: P.bnc, conn_to: P.bnc } });
  cab('C-02', 'coax', P.coax, site, 'JT-01', 'OUT', 'VSPD-01', 'IN', [], { entry_m: 0.5 });
  cab('C-03', 'coax', P.coax, site, 'VSPD-01', 'OUT', 'ANC-01', 'VIDEO', [m(12, 62)], { vertical_m: 4, props: { outdoor_to: true } });
  cab('P-01', 'power', P.pwr, site, 'PSU-01', 'OUT1', 'ANC-01', 'DC', [m(35, 33)].concat(trunkW.slice(1)).concat([m(9, 42), m(9, 66)]), { vertical_m: 4, conduit_ids: [p1.id, p2.id] });
  // ANC-02: 동축 + 별도 전원
  cab('C-04', 'coax', P.coax, site, 'DVR-01', 'CH2', 'ANC-02', 'VIDEO', trunkE.concat([m(60, 66)]), { vertical_m: 4, conduit_ids: [p1.id, p3.id], props: { outdoor_to: true } });
  cab('P-02', 'power', P.pwr, site, 'PSU-01', 'OUT2', 'ANC-02', 'DC', [m(35, 33), m(35, 42), m(61, 42), m(61, 66)], { vertical_m: 4, conduit_ids: [p1.id, p3.id] });
  // ANC-03, ANC-04: 영상·전원 복합케이블 (영상 → DVR, 전원부 → PSU)
  cab('CP-01', 'composite', P.comp, site, 'DVR-01', 'CH3', 'ANC-03', 'VIDEO', trunkW.slice(0, 2).concat([m(12, 42)]), { vertical_m: 4, conduit_ids: [p1.id, p2.id], props: { power_from_port: 'DC', power_to_dev: psu.id, power_to_port: 'OUT3', split_tail_to_m: 1, outdoor_to: true } });
  cab('CP-02', 'composite', P.comp, site, 'DVR-01', 'CH4', 'ANC-04', 'VIDEO', trunkE.slice(0, 2).concat([m(58, 42)]), { vertical_m: 4, conduit_ids: [p1.id, p3.id], props: { power_from_port: 'DC', power_to_dev: psu.id, power_to_port: 'OUT4', split_tail_to_m: 1, outdoor_to: true } });
  // 복합케이블은 from=DVR, to=카메라 → 카메라측 전원 포트는 to 쪽. 전원부 시작을 PSU로, 끝을 카메라 DC로 지정
  cabs.filter(x => x.kind === 'composite').forEach(x => { x.props.power_from_dev = psu.id; x.props.power_from_port = x.props.power_to_port; const cam = x.to.dev; x.props.power_to_dev = cam; x.props.power_to_port = 'DC'; });
  // 주석: 검토 영역 (주차장)
  const anns = [{ id: id(), sheet_id: site, type: 'area', points: [m(10, 45), m(60, 45), m(60, 65), m(10, 65)], text: '주차장 감시 검토 영역', size: 1 }, { id: id(), sheet_id: site, type: 'leader', points: [m(34, 42), m(40, 47)], text: 'HH-01 핸드홀 (관로 분기)', size: 0.9 }];
  const ops = devs.map(d => ({ op: 'upsert', entity: 'devices', data: d })).concat(cds.map(d => ({ op: 'upsert', entity: 'conduits', data: d })), cabs.map(d => ({ op: 'upsert', entity: 'cables', data: d })), anns.map(d => ({ op: 'upsert', entity: 'annotations', data: d })));
  await c.post(`/api/projects/${pid}/batch`, { ops, reason: '샘플 프로젝트 생성' });
  await c.post(`/api/sheets/${site}/snapshot`, { rev_no: '0', note: '샘플 최초 설계' });
  console.log(JSON.stringify({ pid, site, dxf, counts: { devices: devs.length, cables: cabs.length, conduits: cds.length } }));
  return { pid, site, dxf };
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main };
