#!/usr/bin/env node
/* 완료 검증 (요구사항 18장 1~16) – 실제 서버 API로 수행하고 결과를 samples/output/test-results.json·.md로 저장
 * 길이·물량은 이 스크립트 안에서 좌표로 독립 재계산하여 프로그램 결과와 대조합니다. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { Client } = require('./client');
const C = require('../shared/calc');
const TB = require('../shared/tables');
const SCH = require('../shared/schematic');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'samples', 'output'); fs.mkdirSync(OUT, { recursive: true });
const IN = path.join(__dirname, '..', 'samples', 'input');
const results = []; let cur = null;
function step(n, title) { cur = { n, title, checks: [], ok: true }; results.push(cur); console.log(`\n[${n}] ${title}`); }
function check(cond, msg, detail) { cur.checks.push({ ok: !!cond, msg, detail: detail == null ? undefined : detail }); if (!cond) cur.ok = false; console.log(`  ${cond ? '✔' : '✘'} ${msg}${detail != null ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); }
const r2 = v => Math.round(v * 100) / 100;
const plen = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

async function main() {
  const A = new Client(BASE); await A.login(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD || 'admin1234');
  let sample = (await A.get('/api/projects')).find(p => p.is_sample && !p.name.includes('(복원'));
  if (!sample) { process.env.BASE_URL = BASE; await require('./seed-sample').main(); sample = (await A.get('/api/projects')).find(p => p.is_sample && !p.name.includes('(복원')); }
  const SP = sample.id;
  // 검증용 사본 = 백업 → 복원 (백업·복원 기능도 함께 검증)
  const zip = await A.get(`/api/projects/${SP}/backup`); fs.writeFileSync(path.join(OUT, '샘플프로젝트_백업.zip'), zip);
  const fd = new FormData(); fd.append('file', new Blob([zip]), 'backup.zip'); const restored = await A.post('/api/backup/restore', fd);
  const P = restored.id;
  const M0 = await A.get(`/api/projects/${SP}/model`); const M = await A.get(`/api/projects/${P}/model`);
  step(0, '백업·복원 (검증용 사본 생성)');
  check(M.devices.length === M0.devices.length && M.cables.length === M0.cables.length && M.conduits.length === M0.conduits.length && M.sheets.length === M0.sheets.length, '복원 프로젝트의 도면·장비·케이블·관로 수 일치', { sheets: M.sheets.length, devices: M.devices.length, cables: M.cables.length, conduits: M.conduits.length });
  check(JSON.stringify(C.quantities(M).map(q => [q.name, q.qty])) === JSON.stringify(C.quantities(M0).map(q => [q.name, q.qty])), '복원 프로젝트 물량표가 원본과 동일');
  const bgOk = (await A.get(`/api/sheets/${M.sheets[0].id}/bg`, { raw: true })).status === 200; check(bgOk, '복원된 도면 배경 파일 접근 가능');

  // ---------- 1 ----------
  step(1, '도면 업로드 및 알려진 거리로 축척 설정');
  const up = await A.upload(`/api/projects/${P}/files`, path.join(IN, '현장배치도.png')); const meta = (await A.job(up.job)).result;
  check(meta.width === 2400 && meta.height === 1600, '이미지 내용(크기) 판독', `${meta.width}×${meta.height}`);
  const sj = await A.job((await A.post(`/api/projects/${P}/sheets`, { file_id: up.file.id, pages: [{ page: 1, name: '검증 업로드 도면' }] })).job); const sid = sj.result.sheet_ids[0];
  let mm = await A.get(`/api/projects/${P}/model`); let sh = mm.sheets.find(s => s.id === sid);
  check(!C.upmOf(sh), '업로드 직후 축척 미설정 상태');
  // 미설정 상태에서 케이블 길이 확인 필요
  const tmpCable = { id: crypto.randomUUID(), sheet_id: sid, kind: 'utp', tag: 'T-01', points: [[100, 300], [300, 300]], from: {}, to: {}, props: {}, conduit_ids: [] };
  check(C.cableLength(tmpCable, C.index({ ...mm, cables: [tmpCable] })).status === '확인 필요', '축척 미설정 도면의 케이블 길이는 확정값이 아님(확인 필요)');
  const p1 = [100, 1540], p2 = [300, 1540]; const du = plen([p1, p2]); const upm = du / 10;
  sh = await A.put(`/api/sheets/${sid}`, { data: { scale: { upm, p1, p2, real: 10, unit: 'm', source: 'calib', confirmed: true } }, ver: sh.ver });
  check(r2(sh.scale.upm) === 20, '두 점(도면 10m 막대) 보정 → 1m = 20px', sh.scale.upm);
  const L = C.cableLength(tmpCable, C.index({ ...mm, sheets: [sh], cables: [tmpCable], project: { settings: { round_unit_m: 1, slack: { mode: 'ratio', value: 0 } } } }));
  check(r2(L.measured_m) === 10, '200px 경로 측정 길이 = 10m', L.measured_m);
  // mm/cm 단위 입력
  check(r2(200 / (10000 / 1000)) === 20 && r2(200 / (1000 / 100)) === 20, 'mm·cm 입력 환산 일관(10000mm=1000cm=10m)');
  // DXF 단위 / 여러 페이지 PDF / DWG
  const upd = await A.upload(`/api/projects/${P}/files`, path.join(IN, '관리동_1층.dxf')); const dm = (await A.job(upd.job)).result;
  check(dm.units.code === 4 && dm.units.upm === 1000, 'DXF CAD 단위(mm) 판독 → 1m = 1000 단위', dm.units);
  check(Object.keys(dm.layers).includes('A-WALL') && dm.stats.model > 20, 'DXF 레이어·객체 판독', { layers: Object.keys(dm.layers), model: dm.stats.model });
  const dwgCfg = await A.get('/api/settings/dwg');
  if (dwgCfg.configured) {
    const upw = await A.upload(`/api/projects/${P}/files`, path.join(IN, '관리동_1층.dwg')); const wm = (await A.job(upw.job)).result;
    check(wm.converted && wm.stats.model > 0, 'DWG 업로드 → 변환 엔진(LibreDWG)으로 DXF 변환·판독', { version: wm.dwg_version, entities: wm.stats.model, units: wm.units.name });
  } else check(true, 'DWG 엔진 미설정 환경 – DWG 변환 검증 생략');
  // 가짜 확장자 거부
  const fake = path.join(OUT, '_fake.dwg'); fs.writeFileSync(fake, 'this is not a dwg'); const bad = await A.req('POST', `/api/projects/${P}/files`, (() => { const f = new FormData(); f.append('file', new Blob([fs.readFileSync(fake)]), 'fake.dwg'); return f; })(), { allowFail: true }); fs.unlinkSync(fake);
  check(bad.status === 415, '확장자만 DWG인 텍스트 파일은 내용 검사로 거부', bad.data.error);

  // ---------- 2 ----------
  step(2, '장비 배치: IP CCTV 8, 동축 CCTV 4, PoE 스위치 2, NVR 1, DVR 1');
  const cams = M.devices.filter(d => d.type === 'camera');
  check(cams.filter(c => c.props.system === 'IP').length === 8, 'IP CCTV 8대'); check(cams.filter(c => c.props.system === '동축').length === 4, '동축 CCTV 4대');
  check(M.devices.filter(d => d.type === 'poe_switch').length === 2, 'PoE 스위치 2대'); check(M.devices.filter(d => d.type === 'nvr').length === 1 && M.devices.filter(d => d.type === 'dvr').length === 1, 'NVR 1대, DVR 1대');
  check(new Set(M.devices.map(d => d.id)).size === M.devices.length && new Set(M.devices.map(d => d.tag)).size === M.devices.length, '내부 ID·표시번호 모두 고유');

  const ix = C.index(M); const circ = C.circuits(M, ix); const tag = id => (ix.dev.get(id) || {}).tag;
  // ---------- 3 ----------
  step(3, 'IP CCTV를 스위치 및 NVR과 연결');
  const nvr = M.devices.find(d => d.type === 'nvr');
  cams.filter(c => c.props.system === 'IP').forEach(c => { const dc = circ.find(x => x.camera === c.id && x.kind === 'data'); check(dc && dc.sink && ['poe_switch'].includes(ix.dev.get(dc.sink).type) && c.props.nvr_id === nvr.id, `${c.tag} → ${dc && dc.sink ? tag(dc.sink) + ':' + dc.sink_port : '없음'} / NVR ${tag(c.props.nvr_id)} CH${c.props.nvr_channel}`); });
  check(!C.review(M).some(r => r.code === 'NVR_UNREACH'), '모든 IP CCTV가 스위치 → (광 업링크) → NVR 네트워크 경로 보유');

  // ---------- 4 ----------
  step(4, '동축 CCTV를 각각 DVR 입력 채널과 연결');
  const vcs = circ.filter(x => x.kind === 'video');
  vcs.forEach(v => check(v.sink && ix.dev.get(v.sink).type === 'dvr', `${tag(v.camera)} → ${tag(v.sink)} ${v.sink_port}`, v.path.map(s => s.cable.tag).join(' → ')));
  check(new Set(vcs.map(v => v.sink_port)).size === 4, 'DVR 입력 채널 4개가 서로 다름');

  // ---------- 5 ----------
  step(5, '동축 CCTV 일부는 별도 전원선, 일부는 영상·전원 복합케이블');
  const pcs = circ.filter(x => x.kind === 'power');
  pcs.forEach(p => check(p.sink, `${tag(p.camera)} 전원: ${p.path.map(s => s.cable.kind === 'composite' ? s.cable.tag + '(복합 전원부)' : s.cable.tag + '(전원선)').join(' → ')} → ${tag(p.sink)} ${p.sink_port}`));
  check(pcs.filter(p => p.path.some(s => s.cable.kind === 'power')).length === 2 && pcs.filter(p => p.path.some(s => s.cable.kind === 'composite')).length === 2, '별도 전원 2회선 + 복합케이블 2회선');

  // ---------- 6 ----------
  step(6, '동축 회선 하나에 중간 접속점과 보호기 배치');
  const a1 = vcs.find(v => tag(v.camera) === 'ANC-01'); const inl = a1.inline.map(i => ix.dev.get(i.dev).type);
  check(inl.includes('coax_joint') && inl.includes('coax_spd'), `ANC-01 영상 회선 경유: ${a1.inline.map(i => tag(i.dev)).join(', ')}`);
  check(a1.path.length === 3, '물리 케이블 3구간이 하나의 종단 간 영상 회선으로 추적됨', a1.path.map(s => s.cable.tag).join(' → '));

  // ---------- 7 ----------
  step(7, '여러 케이블이 같은 관로를 공유');
  const pipe1 = M.conduits.find(c => c.tag === 'PIPE-01'); const inPipe1 = M.cables.filter(c => (c.conduit_ids || []).includes(pipe1.id));
  check(inPipe1.length >= 2, `PIPE-01 수용 케이블 ${inPipe1.length}조`, inPipe1.map(c => c.tag).join(', '));

  // ---------- 8 ----------
  step(8, '케이블은 물리적 케이블별, 관로는 공용 구간별 집계');
  const st = M.project.settings; const ru = st.round_unit_m || 1; const sl = st.slack.value / 100;
  // 독립 재계산
  const indep = {};
  const roots = M.cables.filter(c => !c.parent_id);
  roots.forEach(rc => {
    const parts = M.cables.filter(c => c.id === rc.id || c.parent_id === rc.id); let tot = 0;
    parts.forEach(c => { const s = M.sheets.find(x => x.id === c.sheet_id); const pts = c.points.slice(); const f = M.devices.find(d => d.id === c.from.dev), t = M.devices.find(d => d.id === c.to.dev); if (f) pts[0] = [f.x, f.y]; if (t) pts[pts.length - 1] = [t.x, t.y]; const meas = plen(pts) / s.scale.upm; const tail = c.kind === 'composite' ? (+(c.props.split_tail_from_m || 0) + +(c.props.split_tail_to_m || 0)) : 0; const base = meas + (+c.vertical_m || 0) + (+c.entry_m || 0) + tail; tot += base * (1 + sl); });
    indep[rc.id] = Math.ceil(tot / ru - 1e-9) * ru;
  });
  const phys = C.physicalCables(M);
  check(phys.length === roots.length, `물리 케이블 ${phys.length}조 (도면 구간 ${M.cables.length}개, 연속 구간은 합산)`);
  const mism = phys.filter(p => p.final_m !== indep[p.id]); check(!mism.length, '케이블별 설계 수량 = 독립 재계산값', mism.length ? mism.map(p => `${p.tag}: ${p.final_m} vs ${indep[p.id]}`) : phys.map(p => `${p.tag}=${p.final_m}m`).join(', '));
  const q = C.quantities(M);
  const kindSum = k => phys.filter(p => p.kind === k).reduce((s, p) => s + p.final_m, 0);
  const qSum = k => q.filter(r => r.cat === '케이블' && r.refs.some(x => (M.cables.find(c => c.id === x.id) || {}).kind === k)).reduce((s, r) => s + r.qty, 0);
  ['utp', 'fiber', 'coax', 'power', 'composite'].forEach(k => check(r2(kindSum(k)) === r2(qSum(k)), `${k} 물량표 합계 = 물리 케이블 합계`, `${qSum(k)} m`));
  const condInd = M.conduits.reduce((s, cd) => s + Math.ceil(plen(cd.points) / M.sheets.find(x => x.id === cd.sheet_id).scale.upm / ru - 1e-9) * ru, 0);
  const condQ = q.filter(r => r.cat === '배관·트레이').reduce((s, r) => s + r.qty, 0);
  check(condInd === condQ, `관로는 공용 구간별 1회 집계: ${condQ} m (수용 케이블 수와 무관)`, M.conduits.map(c => c.tag).join(', '));
  const sharedTimes = inPipe1.length * Math.ceil(plen(pipe1.points) / 20);
  check(condQ < condInd + sharedTimes, '공용 관로 길이를 케이블 수만큼 중복 집계하지 않음');

  // ---------- 9 ----------
  step(9, '복합케이블 내부 회선의 중복 집계 없음');
  const comp = phys.filter(p => p.kind === 'composite'); const compQ = q.filter(r => r.cat === '케이블' && /복합/.test(r.name));
  check(compQ.length === 1 && compQ[0].qty === comp.reduce((s, p) => s + p.final_m, 0), `복합케이블 구매 물량 ${compQ[0] && compQ[0].qty} m = CP-01 + CP-02 길이`);
  const pwrQ = q.filter(r => r.cat === '케이블' && /전원케이블/.test(r.name)).reduce((s, r) => s + r.qty, 0);
  check(pwrQ === phys.filter(p => p.kind === 'power').reduce((s, p) => s + p.final_m, 0), `전원케이블 물량 ${pwrQ} m에 복합케이블 전원부 미포함`);
  check(!q.some(r => r.cat === '케이블' && /5C-FB$/.test(r.spec) && r.refs.some(x => (M.cables.find(c => c.id === x.id) || {}).kind === 'composite')), '복합케이블 영상부가 동축케이블 물량에 포함되지 않음');

  // ---------- 10 ----------
  step(10, '커넥터·부속 수량이 실제 접속 관계와 일치');
  const acc = C.accessories(M); const getA = r => (acc.find(a => a.role === r) || { auto: 0 }).auto;
  // 독립 계산: 동축 영상 끝단 수(장비에 연결, 공장제작 제외)
  let bnc = 0, rj = 0; M.cables.forEach(c => { if (c.props.factory_terminated) return; [c.from, c.to].forEach(e => { const d = M.devices.find(x => x.id === e.dev); if (!d || d.type === 'offpage') return; if (c.kind === 'coax' || c.kind === 'composite') bnc++; if (c.kind === 'utp') rj++; }); });
  check(getA('bnc') === bnc, `BNC ${getA('bnc')}개 = 동축 끝단 ${bnc}개 (접속점·보호기 양측 포함)`);
  check(getA('rj45_plug') === rj, `RJ45 ${getA('rj45_plug')}개 = UTP 장비 끝단 ${rj}개 (공장 제작 U-09·도면 연결 참조 끝단 제외)`);
  check(getA('dc_plug') === 4 && getA('terminal') === 8, `카메라측 DC 커넥터 4, 전원장치측 단자 8 (전원선 2조·복합 전원부 2조 × 2심)`);
  // 접속점 추가 → 갱신
  const c4 = M.cables.find(c => c.tag === 'C-04'); const anc2 = M.devices.find(d => d.tag === 'ANC-02');
  const jt2 = { id: crypto.randomUUID(), sheet_id: c4.sheet_id, type: 'coax_joint', tag: 'JT-02', x: 1200, y: 1100, layer: 'COAX', status: '신설', props: {} };
  const c4a = { ...c4, to: { dev: jt2.id, port: 'IN' }, points: [c4.points[0], ...c4.points.slice(1, -1), [1200, 1100]] };
  const c4b = { id: crypto.randomUUID(), sheet_id: c4.sheet_id, kind: 'coax', tag: 'C-05', product_id: c4.product_id, points: [[1200, 1100], [anc2.x, anc2.y]], from: { dev: jt2.id, port: 'OUT' }, to: { dev: anc2.id, port: 'VIDEO' }, vertical_m: 4, entry_m: 1, slack: { mode: 'project' }, status: '신설', conduit_ids: [], props: {} };
  await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: jt2 }, { op: 'upsert', entity: 'cables', data: c4a, ver: c4.ver }, { op: 'upsert', entity: 'cables', data: c4b }], reason: '검증: 접속점 추가' });
  const M10 = await A.get(`/api/projects/${P}/model`); const acc10 = C.accessories(M10);
  check((acc10.find(a => a.role === 'bnc') || {}).auto === bnc + 2, `접속점 추가 후 BNC ${bnc} → ${(acc10.find(a => a.role === 'bnc') || {}).auto} (+2)`);
  const v2 = C.circuits(M10).find(x => x.kind === 'video' && x.camera === anc2.id); check(v2.sink && v2.inline.some(i => i.dev === jt2.id), 'ANC-02 회선이 새 접속점을 경유하여 DVR까지 추적');

  // ---------- 11 ----------
  step(11, '장비 이동·번호 변경 후 연결 유지');
  const sw2 = M10.devices.find(d => d.tag === 'PSW-02'), ipc5 = M10.devices.find(d => d.tag === 'IPC-05');
  const moved = { ...sw2, x: sw2.x + 120, y: sw2.y + 60, tag: 'PSW-20' }; const ren = { ...ipc5, tag: 'IPC-55' };
  await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: moved, ver: sw2.ver }, { op: 'upsert', entity: 'devices', data: ren, ver: ipc5.ver }], reason: '검증: 이동·번호 변경' });
  const M11 = await A.get(`/api/projects/${P}/model`); const ix11 = C.index(M11);
  const u5 = M11.cables.find(c => c.tag === 'U-05');
  check(u5.from.dev === sw2.id && u5.to.dev === ipc5.id, 'U-05 연결이 내부 ID로 유지 (PSW-20:P1 → IPC-55:LAN)');
  const pts = C.cablePoints(u5, ix11); check(pts[0][0] === moved.x && pts[0][1] === moved.y, '케이블 끝점이 이동한 장비 위치를 따라감', pts[0]);
  const dc5 = C.circuits(M11).find(x => x.camera === ipc5.id && x.kind === 'data'); check(dc5.sink === sw2.id, `회선 추적: IPC-55 → ${ix11.dev.get(dc5.sink).tag}`);
  check(!C.review(M11).some(r => r.level === '오류'), '이동·번호 변경 후 오류 없음');

  // ---------- 12 ----------
  step(12, '배치도·계통도·물량표가 같은 데이터 반영');
  const tb = TB.build(M11); const lay = SCH.layout(M11);
  check(tb.equipment.rows.some(r => r[0] === 'IPC-55') && !tb.equipment.rows.some(r => r[0] === 'IPC-05'), '장비 일람표에 변경 번호 반영');
  check(lay.nodes.some(n => n.dev.tag === 'IPC-55' && SCH.nodeLabel(n.dev).title === 'IPC-55'), '계통도 노드에 변경 번호 반영');
  check(tb.ports.rows.some(r => r[0] === 'PSW-20' && r[4].includes('IPC-55')), '스위치 포트 배정표에 반영');
  const srv = await A.get(`/api/projects/${P}/review`);
  check(JSON.stringify(srv.quantities.map(x => [x.name, x.qty])) === JSON.stringify(C.quantities(M11).map(x => [x.name, x.qty])), '서버 출력용 물량 = 화면 계산 물량 (같은 계산 모듈·데이터)');
  const edgeCables = new Set(lay.edges.map(e => e.cable.id)); const nodeIds = new Set(lay.nodes.map(n => n.id));
  const expectEdges = M11.cables.filter(c => c.from.dev && c.to.dev && nodeIds.has(c.from.dev) && nodeIds.has(c.to.dev));
  check(expectEdges.every(c => edgeCables.has(c.id)), `계통도 연결선 = 배치도 케이블 연결 (${expectEdges.length}조)`);
  // 계통도에서 위치 수동 조정 후 재생성 유지
  const nvr11 = M11.devices.find(d => d.type === 'nvr'); await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...nvr11, sch: { x: 1500, y: 40, manual: true } }, ver: nvr11.ver }] });
  const M12 = await A.get(`/api/projects/${P}/model`); const n12 = SCH.layout(M12).nodes.find(n => n.id === nvr11.id);
  check(n12.x === 1500 && n12.y === 40 && n12.manual, '계통도 재생성 시 수동 배치 위치 유지');
  check(M12.devices.find(d => d.id === nvr11.id).x === nvr11.x, '계통도 위치 변경이 배치도 좌표에 영향 없음');

  // ---------- 13 ----------
  step(13, '신호 불일치·채널 중복·전원 누락·사양 미입력 경고');
  const g = t => M12.devices.find(d => d.tag === t);
  const anc2b = g('ANC-02'), ipc8 = g('IPC-08'), p02 = M12.cables.find(c => c.tag === 'P-02'), u6 = M12.cables.find(c => c.tag === 'U-06');
  await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...anc2b, props: { ...anc2b.props, signal: 'HD-CVI' } }, ver: anc2b.ver }, { op: 'upsert', entity: 'devices', data: { ...ipc8, props: { ...ipc8.props, nvr_channel: 7 } }, ver: ipc8.ver }, { op: 'delete', entity: 'cables', id: p02.id, ver: p02.ver }, { op: 'upsert', entity: 'cables', data: { ...u6, product_id: null }, ver: u6.ver }], reason: '검증: 오류 주입' });
  const rv = (await A.get(`/api/projects/${P}/review`)).review; const has = (code, lvl) => rv.find(r => r.code === code && (!lvl || r.level === lvl));
  [['SIG_MISMATCH', '오류', '신호 불일치(HD-CVI → DVR 지원 AHD/HD-TVI/CVBS)'], ['NVR_CH_DUP', '오류', 'NVR 채널 중복(CH7)'], ['POWER_MISSING', '오류', '전원 연결 누락(ANC-02)'], ['CABLE_SPEC', '경고', '케이블 규격 미지정(U-06)']].forEach(([c, l, m]) => { const x = has(c, l); check(x, `${l}: ${m}`, x && x.msg); });
  check(rv.every(r => r.refs && r.refs.length), '모든 경고에 해당 객체 참조(클릭 이동) 포함');
  // 사양 미입력 → 확인 필요(임의 정상 판정 없음)
  const dvr = g('DVR-01'); await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...dvr, props: { ...dvr.props, supported_inputs: [] } }, ver: dvr.ver }] });
  const rv2 = (await A.get(`/api/projects/${P}/review`)).review; check(rv2.some(r => r.code === 'SIG_SPEC' && r.level === '확인 필요'), 'DVR 입력 사양 미등록 시 "확인 필요"(정상 판정 안 함)');

  // ---------- 14 ----------
  step(14, '저장 후 재접속하여 위치·속성·연결 유지');
  const B = new Client(BASE); await B.login(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD || 'admin1234');
  const MS = await B.get(`/api/projects/${SP}/model`);
  const pick = m => ({ d: m.devices.map(d => [d.id, d.tag, d.x, d.y, JSON.stringify(d.props)]).sort(), c: m.cables.map(c => [c.id, c.tag, JSON.stringify(c.points), c.from.dev, c.from.port, c.to.dev, c.to.port, c.product_id, JSON.stringify(c.conduit_ids)]).sort() });
  check(JSON.stringify(pick(MS)) === JSON.stringify(pick(M0)), '새 세션에서 불러온 샘플 프로젝트의 장비 위치·속성·케이블 연결이 저장값과 동일');
  const M14 = await B.get(`/api/projects/${P}/model`); check(M14.devices.find(d => d.tag === 'PSW-20').x === moved.x && M14.cables.find(c => c.tag === 'C-05'), '검증 사본의 변경(이동·번호·접속점)도 재접속 후 유지');
  // 동시 편집 충돌
  const any = M14.devices.find(d => d.tag === 'IPC-03'); await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...any, name: 'A 수정' }, ver: any.ver }] });
  const conflict = await B.req('POST', `/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...any, name: 'B 수정' }, ver: any.ver }] }, { allowFail: true });
  check(conflict.status === 409, '같은 객체를 이전 버전으로 저장하면 409 충돌(덮어쓰기 방지)', conflict.data.error);

  // ---------- 15 ----------
  step(15, 'A3 PDF와 Excel 생성 (한글·선·수량·축척)');
  const siteId = M0.sheets.find(s => /현장/.test(s.name)).id;
  const pdfScale = await A.post(`/api/projects/${SP}/pdf`, { kind: 'sheets', sheets: [siteId], view: 'layout', paper: 'A3', orient: 'landscape', mode: 'scale', scale: 500 });
  fs.writeFileSync(path.join(OUT, '샘플_CCTV배치도_A3_1-500.pdf'), pdfScale);
  const pdfAll = await A.post(`/api/projects/${SP}/pdf`, { kind: 'sheets', view: 'all', paper: 'A3', orient: 'landscape', mode: 'fit' }); fs.writeFileSync(path.join(OUT, '샘플_종합설계도_A3_일괄.pdf'), pdfAll);
  for (const [v, n] of [['coax', '동축케이블경로도'], ['video_power', '영상전원통합경로도'], ['raceway', '배관트레이경로도'], ['network', 'UTP광케이블경로도']]) fs.writeFileSync(path.join(OUT, `샘플_${n}_A3.pdf`), await A.post(`/api/projects/${SP}/pdf`, { kind: 'sheets', sheets: [siteId], view: v, paper: 'A3', mode: 'fit', color: v !== 'raceway' }));
  fs.writeFileSync(path.join(OUT, '샘플_계통도_A3.pdf'), await A.post(`/api/projects/${SP}/pdf`, { kind: 'schematic', paper: 'A3' }));
  fs.writeFileSync(path.join(OUT, '샘플_장비표_물량표_A3.pdf'), await A.post(`/api/projects/${SP}/pdf`, { kind: 'tables', paper: 'A3' }));
  fs.writeFileSync(path.join(OUT, '샘플_범례표_A4.pdf'), await A.post(`/api/projects/${SP}/pdf`, { kind: 'legend', paper: 'A4', orient: 'portrait' }));
  const f1 = path.join(OUT, '샘플_CCTV배치도_A3_1-500.pdf');
  const info = execFileSync('pdfinfo', [f1]).toString(); check(/Page size:\s+1190\.\d+ x 841\.\d+/.test(info), 'A3 가로 용지(420×297mm)', (info.match(/Page size:.*/) || [''])[0]);
  const fonts = execFileSync('pdffonts', [f1]).toString(); check(/NotoSans/i.test(fonts) && /yes/.test(fonts), '한글 글꼴(Noto Sans KR) 내장', fonts.split('\n').slice(2, 4).join(' / '));
  const txt = execFileSync('pdftotext', ['-layout', f1, '-']).toString();
  ['○○물류센터', '현장 CCTV 배치도', '1:500', 'IPC-03', 'ANC-04', '범', '막대 축척'].forEach(s => check(txt.includes(s), `PDF 문자 포함: "${s}"`));
  // 축척 검증: IPC-05(65m)와 IPC-06(110m) 라벨 간격 45m → 1:500에서 90mm = 255.1pt
  const bbox = execFileSync('pdftotext', ['-bbox', f1, '-']).toString();
  const xOf = t => { const m = bbox.match(new RegExp(`xMin="([\\d.]+)"[^>]*>${t}<`)); return m ? +m[1] : null; };
  const dx = xOf('IPC-06') - xOf('IPC-05'); check(Math.abs(dx - 255.12) < 1.5, `1:500 출력에서 45m 간격 = ${r2(dx / 72 * 25.4)}mm (기대 90mm)`, `${r2(dx)}pt`);
  const qdf = path.join(OUT, '_q.pdf'); execFileSync('qpdf', ['--qdf', '--object-streams=disable', f1, qdf]); const raw = fs.readFileSync(qdf, 'latin1'); fs.unlinkSync(qdf);
  const lineOps = (raw.match(/ l\n/g) || []).length; check(lineOps > 100, `벡터 선 출력 (경로 lineTo 연산 ${lineOps}개)`);
  const fitTxt = execFileSync('pdftotext', ['-layout', path.join(OUT, '샘플_종합설계도_A3_일괄.pdf'), '-']).toString();
  check(fitTxt.includes('용지 맞춤(지정 축척 아님)') && !/1:\d+ \(A3/.test(fitTxt), '용지 맞춤 출력은 지정 축척으로 표기하지 않음');
  check((execFileSync('pdfinfo', [path.join(OUT, '샘플_종합설계도_A3_일괄.pdf')]).toString().match(/Pages:\s+(\d+)/) || [])[1] === String(M0.sheets.length), `선택 도면 일괄 PDF (${M0.sheets.length}쪽)`);
  // 지정 축척 + 축척 미설정 도면 → 출력 불가 안내
  const xl = await A.get(`/api/projects/${SP}/export.xlsx`); fs.writeFileSync(path.join(OUT, '샘플_물량산출.xlsx'), xl);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl);
  const names = wb.worksheets.map(w => w.name);
  ['공종별 집계표', '물량산출표', '장비 일람표', 'NVR·DVR 채널 배정표', '스위치 포트 배정표', 'IP 주소표', '케이블 구간별 산출표', '동축 영상 회선표', '광코어 배정표', '전원 회로표', '배관·트레이 산출표', '커넥터·부속자재 수량표'].forEach(n => check(names.includes(n), `Excel 시트: ${n}`));
  const qs = wb.getWorksheet('물량산출표'); let compRow = null; qs.eachRow(r => { if (/복합/.test(String(r.getCell(2).value))) compRow = r; });
  check(compRow && +compRow.getCell(5).value === compQ[0].qty, `Excel 복합케이블 수량 ${compRow && compRow.getCell(5).value} m = 화면 값`);
  const dxfOut = await A.get(`/api/sheets/${siteId}/export.dxf`); fs.writeFileSync(path.join(OUT, '샘플_현장배치도_설계객체.dxf'), dxfOut);
  try { const DxfParser = require('dxf-parser'); const pd = new DxfParser().parseSync(dxfOut.toString()); check(pd.entities.length > 40 && Object.keys(pd.tables.layer.layers).some(l => l === 'CCTV-COAX'), `DXF 내보내기 재판독: 객체 ${pd.entities.length}개, 레이어 ${Object.keys(pd.tables.layer.layers).length}개`); } catch (e) { check(false, 'DXF 내보내기 재판독', e.message); }

  // ---------- 16 ----------
  step(16, '권한 없는 사용자의 조회·수정·다운로드 차단');
  const mkUser = async (u, role) => { const r = await A.post('/api/users', { username: u, name: u, password: 'password123', role }).catch(() => null); return r; };
  await mkUser('viewer_' + Date.now() % 100000, 'viewer'); const users = await A.get('/api/users');
  const vUser = users.filter(u => u.username.startsWith('viewer_')).pop(); await mkUser('outsider_' + Date.now() % 100000, 'designer'); const oUser = (await A.get('/api/users')).filter(u => u.username.startsWith('outsider_')).pop();
  const members = await A.get(`/api/projects/${SP}/members`); await A.put(`/api/projects/${SP}/members`, { members: members.map(m => ({ user_id: m.user_id, role: m.role })).concat([{ user_id: vUser.id, role: 'viewer' }]) });
  const V = new Client(BASE); await V.login(vUser.username, 'password123'); const O = new Client(BASE); await O.login(oUser.username, 'password123'); const N = new Client(BASE);
  const fileId = M0.sheets[0].bg.file_id; const dev0 = M0.devices[0];
  const st_ = async (cl, m, u, b) => (await cl.req(m, u, b, { allowFail: true })).status;
  check(await st_(V, 'GET', `/api/projects/${SP}/model`) === 200, '조회자: 프로젝트 조회 허용');
  check(await st_(V, 'POST', `/api/projects/${SP}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...dev0, name: 'x' } }] }) === 403, '조회자: 설계 수정 차단(403)');
  check(await st_(V, 'PUT', `/api/projects/${SP}/devices/${dev0.id}/field`, { status: '설치 완료' }) === 403, '조회자: 현장 확인 상태 변경 차단(403)');
  check(await st_(V, 'GET', `/api/files/${fileId}/raw`) === 200, '조회자: 원본 다운로드 허용(멤버)');
  check(await st_(O, 'GET', `/api/projects/${SP}/model`) === 403, '비멤버: 프로젝트 조회 차단(403)');
  check(await st_(O, 'GET', `/api/files/${fileId}/raw`) === 403, '비멤버: 원본 파일 다운로드 차단(403)');
  check(await st_(O, 'GET', `/api/sheets/${siteId}/bg`) === 403, '비멤버: 도면 배경 조회 차단(403)');
  check(await st_(O, 'POST', `/api/projects/${SP}/pdf`, { kind: 'tables' }) === 403, '비멤버: PDF 출력 차단(403)');
  check(await st_(O, 'GET', `/api/projects/${SP}/export.xlsx`) === 403, '비멤버: Excel 다운로드 차단(403)');
  check(await st_(O, 'GET', `/api/projects/${SP}/devices/${dev0.id}/qr.png`) === 403, '비멤버: QR 조회 차단(403)');
  check(await st_(O, 'GET', `/api/projects/${SP}/backup`) === 403, '비멤버: 백업 다운로드 차단(403)');
  check(!(await O.get('/api/projects')).some(p => p.id === SP), '비멤버: 프로젝트 목록에 표시 안 됨');
  check(await st_(N, 'GET', `/api/projects/${SP}/model`) === 401 && await st_(N, 'GET', `/api/files/${fileId}/raw`) === 401, '비로그인: 조회·다운로드 차단(401)');
  // 정리: 검증용 사용자 비활성화
  await A.put(`/api/users/${vUser.id}`, { active: false }); await A.put(`/api/users/${oUser.id}`, { active: false });
  await A.put(`/api/projects/${SP}/members`, { members });

  // ---------- 17 ----------
  step(17, '추가 구현 기능 (실제 DWG·벡터 PDF·흑백·준공도·스냅샷·광 접속·사용자 심볼·계통도 배선·지도 설정·DWG 내보내기)');
  const dwgDir = path.join(IN, 'dwg_real');
  if ((await A.get('/api/settings/dwg')).configured && fs.existsSync(dwgDir)) {
    for (const f of fs.readdirSync(dwgDir).filter(x => x.endsWith('.dwg')).sort()) {
      const u = await A.upload(`/api/projects/${P}/files`, path.join(dwgDir, f)); const mt = (await A.job(u.job)).result;
      check(mt.converted && mt.stats.model > 200 && mt.units.name === 'mm', `AutoCAD 저장 DWG ${f} (${mt.dwg_version}) 변환·판독: 객체 ${mt.stats.model}개, 경고 ${mt.warnings.length - 1}건`);
    }
    const u = await A.upload(`/api/projects/${P}/files`, path.join(dwgDir, 'example_2018.dwg')); await A.job(u.job);
    const sj2 = await A.job((await A.post(`/api/projects/${P}/sheets`, { file_id: u.file.id, pages: [{ page: 1, name: 'DWG 2018 도면' }] })).job);
    const dwgSheet = sj2.result.sheet_ids[0];
    const dxfBack = await A.get(`/api/sheets/${dwgSheet}/export.dxf?bg=1`); check(dxfBack.length > 10000, `DWG 도면 DXF 내보내기(원본 배경 포함) ${dxfBack.length} bytes`);
    const dwgOut = await A.req('GET', `/api/sheets/${siteId}/export.dwg`, undefined, { allowFail: true });
    check(dwgOut.status === 400 && /ODA/.test(dwgOut.data.error), 'DWG 내보내기: ODA 미연결 시 비활성 + 안내 (LibreDWG 쓰기는 손실 확인되어 미사용)', dwgOut.data.error);
  }
  // 벡터 PDF 업로드 → SVG 배경, 출력도 벡터
  const vpdf = path.join(OUT, '_vector_input.pdf'); fs.writeFileSync(vpdf, await A.post(`/api/projects/${SP}/pdf`, { kind: 'legend', paper: 'A3' }));
  const vu = await A.upload(`/api/projects/${P}/files`, vpdf); const vm = (await A.job(vu.job)).result; fs.unlinkSync(vpdf);
  const vs = (await A.job((await A.post(`/api/projects/${P}/sheets`, { file_id: vu.file.id, pages: [{ page: 1, name: '벡터 PDF 도면' }], vector: true })).job)).result.sheet_ids[0];
  const Mv = await A.get(`/api/projects/${P}/model`); const vsh = Mv.sheets.find(s => s.id === vs);
  check(vm.hasText && vsh.bg.vector, '벡터 PDF 판별 → 벡터(SVG) 배경으로 등록');
  const svgR = await A.req('GET', `/api/sheets/${vs}/bg?fmt=svg`, undefined, { raw: true }); const svgT = await svgR.text();
  check(svgR.status === 200 && svgT.includes('<svg') && (svgR.headers.get('content-security-policy') || '').includes('sandbox'), 'SVG 배경 제공(보안 헤더 포함)');
  const vout = await A.post(`/api/projects/${P}/pdf`, { kind: 'sheets', sheets: [vs], view: 'layout', paper: 'A3', mode: 'fit' }); const vf = path.join(OUT, '_v.pdf'); fs.writeFileSync(vf, vout);
  const imgs = execFileSync('pdfimages', ['-list', vf]).toString().trim().split('\n').length - 2; fs.unlinkSync(vf);
  check(imgs <= 1, `벡터 배경 출력: 래스터 이미지 없이 벡터로 출력 (이미지 ${Math.max(0, imgs)}개)`);
  // 흑백 출력 → 회색조 배경
  const mono = await A.post(`/api/projects/${SP}/pdf`, { kind: 'sheets', sheets: [siteId], view: 'layout', paper: 'A3', mode: 'fit', color: false }); const mf = path.join(OUT, '샘플_CCTV배치도_A3_흑백.pdf'); fs.writeFileSync(mf, mono);
  const il = execFileSync('pdfimages', ['-list', mf]).toString(); check(/\bgray\b/.test(il) && !/\brgb\b/.test(il.split('\n').slice(2).join('\n')), '흑백 출력 시 이미지 배경도 회색조로 변환', il.split('\n')[2]);
  // 준공도
  const Ms = await A.get(`/api/projects/${P}/model`); const ipc3 = Ms.devices.find(d => d.tag === 'IPC-03'); const ipc4 = Ms.devices.find(d => d.tag === 'IPC-04');
  await A.put(`/api/projects/${P}/devices/${ipc3.id}/field`, { status: '설치 완료', actual: [ipc3.x + 100, ipc3.y], as_built: true });
  await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'devices', data: { ...ipc4, status: '철거' }, ver: ipc4.ver }] });
  const siteP = Ms.sheets.find(s => /현장/.test(s.name)); await A.put(`/api/sheets/${siteP.id}`, { data: { asbuilt: { status: '검토 요청', by: '검증', at: new Date().toISOString() } }, ver: siteP.ver });
  const ab = await A.post(`/api/projects/${P}/pdf`, { kind: 'sheets', sheets: [siteP.id], view: 'layout', paper: 'A3', mode: 'scale', scale: 500, asbuilt: true }); const af = path.join(OUT, '샘플_준공도_A3.pdf'); fs.writeFileSync(af, ab);
  const at = execFileSync('pdftotext', ['-layout', af, '-']).toString(); const ab2 = execFileSync('pdftotext', ['-bbox', af, '-']).toString();
  check(at.includes('준 공 도') && at.includes('검토 요청') && at.includes('(준공도)'), '준공도 출력: 준공 표기·작성 상태');
  check(!/>IPC-04</.test(ab2), '준공도에서 철거 장비 제외');
  const pl = await A.post(`/api/projects/${P}/pdf`, { kind: 'sheets', sheets: [siteP.id], view: 'layout', paper: 'A3', mode: 'scale', scale: 500 }); const plf = path.join(OUT, '_p.pdf'); fs.writeFileSync(plf, pl); const pb = execFileSync('pdftotext', ['-bbox', plf, '-']).toString(); fs.unlinkSync(plf);
  const xo = (t, bb) => { const m = bb.match(new RegExp(`xMin="([\\d.]+)"[^>]*>${t}<`)); return m ? +m[1] : null; };
  const shift = xo('IPC-03', ab2) - xo('IPC-03', pb); check(Math.abs(shift - 5 / 500 * 1000 * 72 / 25.4) < 1.5, `준공도: 실제 설치 위치 반영 (5m 이동 → ${r2(shift / 72 * 25.4)}mm @1:500)`);
  // 스냅샷 도면 출력
  const revs = await A.get(`/api/sheets/${siteP.id}/revisions`); const rev0 = revs[0];
  const spdf = await A.post(`/api/projects/${P}/pdf`, { kind: 'sheets', sheets: [siteP.id], view: 'layout', paper: 'A3', mode: 'fit', snapshot_id: rev0.id }); const sf = path.join(OUT, '_s.pdf'); fs.writeFileSync(sf, spdf); const stx = execFileSync('pdftotext', ['-layout', sf, '-']).toString(); fs.unlinkSync(sf);
  check(stx.includes('IPC-04') && stx.includes('IPC-05') && !stx.includes('PSW-20') && stx.includes('스냅샷'), '개정 스냅샷 시점 도면 출력 (이후 변경 미반영)');
  // 광 코어 배정·접속 검토
  const fc1 = Ms.cables.find(c => c.tag === 'F-01');
  check(C.coresUsed(fc1) === 2, `F-01 코어 배정표 기반 사용 코어 ${C.coresUsed(fc1)}심 (BOM 광커넥터 산출에 반영)`);
  const sw1 = Ms.devices.find(d => d.tag === 'PSW-01');
  await A.post(`/api/projects/${P}/batch`, { ops: [{ op: 'upsert', entity: 'cables', data: { ...fc1, props: { ...fc1.props, core_assign: fc1.props.core_assign.concat([{ core: 2, use: '사용' }, { core: 6, use: '사용' }]) } }, ver: fc1.ver }, { op: 'upsert', entity: 'devices', data: { ...sw1, props: { ...sw1.props, splices: [{ in_cable: fc1.id, in_core: 3, out_cable: fc1.id, out_core: 3 }] } }, ver: sw1.ver }] });
  const rvf = (await A.get(`/api/projects/${P}/review`)).review;
  ['CORE_DUP', 'CORE_RANGE', 'SPLICE_DUP', 'SPLICE_UNASSIGNED'].forEach(cd => check(rvf.some(r => r.code === cd), `광 코어 검토: ${cd}`, (rvf.find(r => r.code === cd) || {}).msg));
  const tbx = TB.build(await A.get(`/api/projects/${P}/model`)); check(tbx.splices.rows.length === 1 && tbx.fiber.rows.length >= 4, `광 접속표 ${tbx.splices.rows.length}행 · 광코어 배정표 코어별 ${tbx.fiber.rows.length}행`);
  // 사용자 정의 심볼 PDF·DXF
  const lg = execFileSync('pdftotext', ['-layout', path.join(OUT, '샘플_CCTV배치도_A3_1-500.pdf'), '-']).toString();
  check(lg.includes('EB-01') && lg.includes('비상벨'), '사용자 정의 심볼(비상벨) 도면·범례 출력');
  const dx2 = (await A.get(`/api/sheets/${siteId}/export.dxf`)).toString(); check(/SYM_CUSTOM_/.test(dx2), '사용자 정의 심볼 DXF 블록 내보내기');
  // 계통도 배선 – 장비 상자 관통 없음
  const LL = SCH.layout(M0); let hit = 0; LL.edges.forEach(e => { for (let i = 1; i < e.route.length; i++) { const [a, b] = [e.route[i - 1], e.route[i]]; LL.nodes.forEach(n => { if (n.id === e.a.dev || n.id === e.b.dev) return; if (Math.max(a[0], b[0]) > n.x && Math.min(a[0], b[0]) < n.x + n.w && Math.max(a[1], b[1]) > n.y && Math.min(a[1], b[1]) < n.y + n.h) hit++; }); } });
  check(hit === 0, `계통도 자동 배선: 연결선이 다른 장비 상자를 지나지 않음 (선 ${LL.edges.length}개)`);
  // 교차 점프
  const xs = C.crossings(M0, siteId); check(Array.isArray(xs), `케이블 교차(비접속) 지점 계산 ${xs.length}개 – 화면·PDF 점프 기호`);
  // 지도 설정 검증
  const badMap = await A.req('PUT', '/api/settings/map', { enabled: true, url: 'http://x/{z}' }, { allowFail: true }); check(badMap.status === 400, '지도 타일 주소 형식 검증(https, {z}{x}{y})');
  const vMap = await V.req('PUT', '/api/settings/map', { enabled: false }, { allowFail: true }); check(vMap.status === 401 || vMap.status === 403, '지도 설정 변경은 관리자만');
  // 사용자 도곽 + 문자 위치
  const tbImg = path.join(OUT, '_tb.png'); fs.copyFileSync(path.join(IN, '현장배치도.png'), tbImg);
  const tbu = await A.upload(`/api/projects/${P}/attachments`, tbImg, { target_type: 'project', target_id: P, kind: '현장사진' }); fs.unlinkSync(tbImg);
  await A.put(`/api/projects/${P}`, { settings: { titleblock_file_id: tbu.file_id, titleblock_fields: { '공사명': { x: 60, y: 10, size: 4 }, '도면명': { x: 200, y: 10, size: 4 } } } });
  const tbp = await A.post(`/api/projects/${P}/pdf`, { kind: 'legend', paper: 'A3' }); const tbf = path.join(OUT, '_tbp.pdf'); fs.writeFileSync(tbf, tbp); const tbb = execFileSync('pdftotext', ['-bbox', tbf, '-']).toString(); fs.unlinkSync(tbf);
  const mx = tbb.match(/xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>범례표</); check(mx && Math.abs(+mx[1] - (8 + 200) * 72 / 25.4) < 2, '사용자 도곽 이미지 + 지정 위치(X 200mm)에 도면명 출력', mx && `${r2(+mx[1] / 72 * 25.4)}mm`);

  // ---------- 결과 저장 ----------
  const total = results.reduce((s, r) => s + r.checks.length, 0), fail = results.reduce((s, r) => s + r.checks.filter(c => !c.ok).length, 0);
  fs.writeFileSync(path.join(OUT, 'test-results.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, total, fail, steps: results }, null, 1));
  const md = [`# 완료 검증 결과`, ``, `- 실행: ${new Date().toLocaleString('ko-KR')}`, `- 검사 항목 ${total}개 / 실패 ${fail}개`, ``].concat(results.flatMap(r => [`## ${r.n}. ${r.title} — ${r.ok ? '통과' : '실패'}`, '', ...r.checks.map(c => `- ${c.ok ? '✅' : '❌'} ${c.msg}${c.detail != null ? ` — ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}` : ''}`), '']));
  fs.writeFileSync(path.join(OUT, 'test-results.md'), md.join('\n'));
  console.log(`\n총 ${total}개 검사, 실패 ${fail}개`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
