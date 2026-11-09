/**
 * EUM SMART VMS PRO — 1단계 검증 시나리오 (지시서 17장)
 * 실제 서버·DB·MQTT 브로커(mTLS)·장치 시뮬레이터로 실행한다.
 * 실행: SERVER_CMD 환경 등은 run-e2e.sh 참고. 결과는 docs/test-results.md / test-results.json 으로 저장.
 */
const { authenticator } = require('otplib');
const { io } = require('socket.io-client');
const { Client } = require('pg');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SimDevice } = require('../device-sim/sim');

const BASE = process.env.BASE || 'http://localhost:3000';
const PG = process.env.PG_URL || 'postgres://postgres@localhost:5432/eum';
const ADMIN = { username: 'admin', password: 'Admin!2345x' };
const PW = 'Test!pass123';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const sims = [];

async function api(token, method, p, body, headers = {}) {
  const r = await fetch(BASE + '/api' + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
}
function must(cond, msg) { if (!cond) throw new Error(msg); }
async function until(fn, ms = 15000, step = 300) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(step); }
  throw new Error('시간 초과' + (last instanceof Error ? `: ${last.message}` : ''));
}

async function scenario(no, name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ no, name, result: '통과', note: note || '', sec: ((Date.now() - t0) / 1000).toFixed(1) });
    console.log(`✔ [${no}] ${name}${note ? ' — ' + note : ''}`);
  } catch (e) {
    results.push({ no, name, result: '실패', note: e.message, sec: ((Date.now() - t0) / 1000).toFixed(1) });
    console.log(`✘ [${no}] ${name} — ${e.message}`);
  }
}
const notRun = (no, name, why) => { results.push({ no, name, result: '미실행', note: why, sec: '-' }); console.log(`- [${no}] ${name} — 미실행: ${why}`); };

// ── 로그인 도우미 (MFA 자동 처리) ──
const secrets = {};
async function login(username, password) {
  let r = await api(null, 'POST', '/auth/login', { username, password });
  if (r.status !== 200) throw new Error(`${username} 로그인 실패 ${r.status} ${JSON.stringify(r.body)}`);
  if (r.body.mfa_required) {
    r = await api(null, 'POST', '/auth/mfa/verify', { mfa_token: r.body.mfa_token, code: authenticator.generate(secrets[username]) });
    if (r.status !== 200) throw new Error('MFA 실패');
  }
  const token = r.body.access_token;
  if (r.body.user.mfa_required && !r.body.user.mfa_enabled) {
    const s = await api(token, 'POST', '/auth/mfa/setup');
    secrets[username] = s.body.secret;
    const e = await api(token, 'POST', '/auth/mfa/enable', { code: authenticator.generate(s.body.secret) });
    must(e.status === 200, 'MFA 설정 실패');
  }
  return token;
}
async function stepUp(token, username, password = PW) {
  const r = await api(token, 'POST', '/auth/reauth', { password, ...(secrets[username] ? { code: authenticator.generate(secrets[username]) } : {}) });
  must(r.status === 200, `재인증 실패 ${JSON.stringify(r.body)}`);
  return r.body.step_up_token;
}
async function waitCmd(token, id, statuses, ms = 30000) {
  return until(async () => { const r = await api(token, 'GET', `/commands?limit=500`); const c = r.body.find(x => x.id === id); return c && statuses.includes(c.status) ? c : null; }, ms);
}

// ── 서버 프로세스 제어 (재시작 시나리오) ──
let serverProc = null;
function startServer() {
  serverProc = spawn('node', [path.join(__dirname, '../server/dist/main.js')], { env: { ...process.env }, stdio: ['ignore', fs.openSync('/tmp/server.log', 'a'), fs.openSync('/tmp/server.log', 'a')] });
  return until(async () => (await api(null, 'GET', '/health')).body?.mqtt === true, 30000);
}
async function stopServer() { if (serverProc) { serverProc.kill('SIGTERM'); await new Promise(r => serverProc.on('exit', r)); serverProc = null; } }

(async () => {
  if (process.env.MANAGE_SERVER === '1') await startServer();
  const pg = new Client({ connectionString: PG }); await pg.connect();

  // ───── 준비: MFA 강제 확인 + 기관·사용자·장치 ─────
  let admin, A = {}, B = {};
  await scenario('S0', '관리자 MFA 강제 및 로그인', async () => {
    let r = await api(null, 'POST', '/auth/login', ADMIN);
    must(r.status === 200 && r.body.access_token, '최초 로그인 실패');
    const t = r.body.access_token;
    r = await api(t, 'GET', '/sites');
    must(r.status === 403 && r.body.code === 'MFA_SETUP_REQUIRED', `MFA 미설정 관리자가 API에 접근됨: ${r.status}`);
    admin = await login(ADMIN.username, ADMIN.password);
    r = await api(null, 'POST', '/auth/login', ADMIN);
    must(r.body.mfa_required === true, 'MFA 설정 후에도 2단계 인증을 요구하지 않음');
    r = await api(null, 'POST', '/auth/mfa/verify', { mfa_token: r.body.mfa_token, code: '000000' });
    must(r.status === 401, '틀린 MFA 코드가 통과됨');
    return 'MFA 미설정 시 403, 설정 후 2단계 요구, 틀린 코드 거부';
  });

  await scenario('S0b', '기관·사용자·현장·함체·스마트박스 등록', async () => {
    const ts = Date.now().toString(36);
    A.org = (await api(admin, 'POST', '/organizations', { name: `A시청 ${ts}`, code: `A${ts}` })).body;
    B.org = (await api(admin, 'POST', '/organizations', { name: `B군청 ${ts}`, code: `B${ts}` })).body;
    must(A.org?.id && B.org?.id, '기관 생성 실패');
    const mk = async (org, u, role) => { const r = await api(admin, 'POST', '/users', { username: `${u}_${ts}`, display_name: u, password: PW, role, org_id: org.id }); must(r.status === 201, `사용자 생성 실패 ${u} ${JSON.stringify(r.body)}`); return `${u}_${ts}`; };
    A.centerName = await mk(A.org, 'a_center', 'center_admin');
    A.center2Name = await mk(A.org, 'a_center2', 'center_admin');
    A.opName = await mk(A.org, 'a_op', 'operator');
    A.powerName = await mk(A.org, 'a_power', 'operator_power');
    B.opName = await mk(B.org, 'b_op', 'operator');
    A.center = await login(A.centerName, PW); A.center2 = await login(A.center2Name, PW);
    A.op = await login(A.opName, PW); A.power = await login(A.powerName, PW); B.op = await login(B.opName, PW);
    const site = (await api(A.center, 'POST', '/sites', { name: '중앙로 교차로', code: `S-${ts}`, address: '시험시 중앙로 1', lat: 37.5, lng: 127.0 })).body;
    const cab = (await api(A.center, 'POST', '/cabinets', { site_id: site.id, code: `CB-${ts}`, name: '1번 함체' })).body;
    const box = await api(A.center, 'POST', '/smartboxes', { cabinet_id: cab.id, serial_no: 'SIM-0001' });
    must(box.status === 201 && box.body.provisioning?.client_cert_pem, '스마트박스 등록 실패');
    A.box = box.body; A.cab = cab; A.site = site;
    const again = await api(A.center, 'GET', `/smartboxes/${A.box.id}`);
    must(!again.body.provisioning && !JSON.stringify(again.body).includes('cmd_secret'), '비밀정보가 조회 API에 노출됨');
    A.sim = new SimDevice(A.box.provisioning, { interval: 2 }); sims.push(A.sim);
    await A.sim.connect();
    await until(async () => (await api(A.op, 'GET', `/smartboxes/${A.box.id}`)).body.online === true);
    // 첫 접속 시 설정 버전 불일치 → 서버가 config_set 자동 전송
    await until(async () => A.sim.configVersion === 1, 15000);
    return `장치 ${A.box.device_id} mTLS 접속·온라인, 설정 자동 동기화`;
  });

  await scenario('S0c', '계측 저장과 실시간(WebSocket) 갱신', async () => {
    const sock = io(BASE, { path: '/socket.io', auth: { token: A.op }, transports: ['websocket'] });
    const got = new Promise((res, rej) => { sock.on('telemetry', m => { if (m.smartbox_id === A.box.id) res(m); }); setTimeout(() => rej(new Error('WebSocket 계측 미수신')), 10000); });
    A.sim.env.t = 31.4; A.sim.sendTelemetry();
    const m = await got; sock.close();
    must(m.data.env.t === 31.4, 'WebSocket 값 불일치');
    const rows = await api(A.op, 'GET', `/smartboxes/${A.box.id}/telemetry?limit=5`);
    must(rows.body.length > 0, '계측 DB 저장 없음');
    const r = await pg.query('SELECT count(*)::int c FROM telemetry WHERE smartbox_id=$1', [A.box.id]);
    return `DB 계측 ${r.rows[0].c}건, 실시간 수신 확인`;
  });

  await scenario('12', '권한 없는 전원 제어 거부', async () => {
    let r = await api(A.op, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 5, off_sec: 1 }, reason: '시험' });
    must(r.status === 403, `관제요원 전원 제어가 허용됨 ${r.status}`);
    r = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 5, off_sec: 1 }, reason: '시험' });
    must(r.status === 403 && r.body.code === 'STEP_UP_REQUIRED', `재인증 없이 허용됨 ${r.status}`);
    const su = await stepUp(A.power, A.powerName);
    r = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 5, off_sec: 1 } }, { 'x-step-up-token': su });
    must(r.status === 400, '사유 없는 전원 제어 허용됨');
    const suOther = await stepUp(A.center, A.centerName);
    r = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 5, off_sec: 1 }, reason: '시험' }, { 'x-step-up-token': suOther });
    must(r.status === 403, '다른 사용자의 재인증 토큰이 통과됨');
    r = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 5, off_sec: 1 }, reason: '예비 장비 재투입 시험' }, { 'x-step-up-token': su });
    must(r.status === 201, `정상 요청 실패 ${JSON.stringify(r.body)}`);
    const c = await waitCmd(A.op, r.body.id, ['done']);
    return `관제요원 403, 재인증 없음 403, 사유 없음 400, 타인 토큰 403, 권한자 실행 완료(${c.id})`;
  });

  await scenario('7', '공유 스위치 위험 제어 차단 (이중 승인)', async () => {
    const su = await stepUp(A.center, A.centerName);
    const before = A.sim.executed.length;
    let r = await api(A.center, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 1, off_sec: 2 }, reason: 'PoE 스위치 전체 장애' }, { 'x-step-up-token': su });
    must(r.status === 201 && r.body.status === 'pending_approval', `공유 장비 명령이 즉시 실행됨: ${r.body.status}`);
    const id = r.body.id;
    await sleep(1500);
    must(A.sim.executed.length === before, '승인 전에 장치로 전송됨');
    r = await api(A.center, 'POST', `/commands/${id}/approve`, undefined, { 'x-step-up-token': await stepUp(A.center, A.centerName) });
    must(r.status === 403 && r.body.code === 'SAME_USER', `요청자 본인 승인이 허용됨 ${r.status}`);
    r = await api(A.power, 'POST', `/commands/${id}/approve`, undefined, { 'x-step-up-token': await stepUp(A.power, A.powerName) });
    must(r.status === 403, '승인 권한 없는 사용자 승인 허용됨');
    r = await api(A.center2, 'POST', `/commands/${id}/approve`, undefined, { 'x-step-up-token': await stepUp(A.center2, A.center2Name) });
    must(r.status === 200, `2차 승인 실패 ${JSON.stringify(r.body)}`);
    const c = await waitCmd(A.op, id, ['done'], 20000);
    must(c.approved_by_name, '승인자 기록 없음');
    const bulk = await api(A.center, 'POST', `/smartboxes/bulk/commands`, { type: 'power_cycle' });
    must(bulk.status >= 400, '일괄 전원 명령 경로가 존재함');
    return '승인 전 미전송, 본인 승인 거부, 무권한 승인 거부, 다른 관리자 승인 후 실행';
  });

  await scenario('S-dup', '명령 재전송 시 중복 실행 방지 · 동시 명령 차단', async () => {
    A.sim.dropCmds = 1;
    const su = await stepUp(A.power, A.powerName);
    const r = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 6, off_sec: 3 }, reason: '재전송 시험' }, { 'x-step-up-token': su });
    const busy = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_off', params: { ch: 6 }, reason: '중복' }, { 'x-step-up-token': su });
    must(busy.status === 409 && busy.body.code === 'BUSY', `같은 채널 동시 명령 허용됨 ${busy.status}`);
    const c = await waitCmd(A.op, r.body.id, ['done'], 40000);
    must(c.attempts >= 2, `재전송이 일어나지 않음 attempts=${c.attempts}`);
    // 서버가 같은 명령을 다시 보내도 장치는 실행하지 않고 이전 ack만 재전송해야 함
    const execCount = A.sim.executed.filter(x => x === c.id).length;
    must(execCount === 1, `장치 실행 횟수 ${execCount}`);
    return `1차 유실 → ${c.attempts}회 송신, 장치 실행 1회, 동시 명령 409`;
  });

  await scenario('S-sig', '명령 무결성 (서명 불일치 거부)', async () => {
    const real = A.sim.prov.cmd_secret;
    A.sim.prov.cmd_secret = 'ff'.repeat(32);
    const r = await api(A.op, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'telemetry_now', params: {} });
    const c = await waitCmd(A.op, r.body.id, ['rejected', 'done', 'failed']);
    A.sim.prov.cmd_secret = real;
    must(c.status === 'rejected' && c.error === 'bad_signature', `서명 불일치가 실행됨: ${c.status}`);
    return '장치가 bad_signature로 거부, 서버 상태 rejected';
  });

  await scenario('3', '정전 및 UPS 상태 감지', async () => {
    A.sim.setInput('ups_ac_fail', true);
    const a = await until(async () => (await api(A.op, 'GET', `/alarms?smartbox_id=${A.box.id}&state=active`)).body.find(x => x.type === 'input.ups_ac_fail'));
    must(a.severity === 'critical', `정전 등급 ${a.severity}`);
    A.sim.setInput('ups_batt_low', true);
    const b = await until(async () => (await api(A.op, 'GET', `/alarms?smartbox_id=${A.box.id}&state=active`)).body.find(x => x.type === 'input.ups_batt_low'));
    must(b.severity === 'major', '배터리 저전압 등급 오류');
    const tel = await until(async () => { const t = (await api(A.op, 'GET', `/smartboxes/${A.box.id}`)).body.latest; return t?.ac?.w === 0 ? t : null; });
    A.sim.setInput('ups_ac_fail', false); A.sim.setInput('ups_batt_low', false);
    await until(async () => (await api(A.op, 'GET', `/alarms?smartbox_id=${A.box.id}&state=active`)).body.find(x => x.type === 'input.ups_ac_fail' && x.cleared_at));
    const ack = await api(A.op, 'POST', `/alarms/${a.id}/ack`, { note: '확인' });
    must(ack.status === 200 && ack.body.state === 'acknowledged', '알람 확인 실패');
    const res = await api(A.op, 'POST', `/alarms/${a.id}/resolve`, { note: 'x' });
    must(res.status === 403, '관제요원이 조치완료 처리함(권한 분리 실패)');
    return `정전 긴급·배터리 심각 알람, AC 0W 반영, 복전 시각 기록, 확인 처리`;
  });

  await scenario('1', '스마트박스 통신 단절 후 자동 재접속', async () => {
    A.sim.dropNetwork();
    await until(async () => (await api(A.op, 'GET', `/smartboxes/${A.box.id}`)).body.online === false, 20000);
    const al = await until(async () => (await api(A.op, 'GET', `/alarms?smartbox_id=${A.box.id}&state=active`)).body.find(x => x.type === 'device_offline'));
    await until(async () => (await api(A.op, 'GET', `/smartboxes/${A.box.id}`)).body.online === true, 30000);
    await until(async () => (await api(A.op, 'GET', `/alarms?smartbox_id=${A.box.id}&state=active`)).body.find(x => x.id === al.id && x.cleared_at), 10000);
    return '단절 → 오프라인·통신두절 알람 → 자동 재접속 → 온라인·복귀 기록';
  });

  await scenario('S-offline-timeout', '무응답 장치 오프라인 판정 (계측 3주기+10초)', async () => {
    // 장치는 연결돼 있지만 계측을 멈춤 → 서버 설정 주기(10초)×3+10초 = 40초 안팎에 오프라인 판정해야 함
    clearInterval(A.sim.timer); A.sim.rejectAll = true;
    const t0 = Date.now();
    try {
      await until(async () => (await api(A.op, 'GET', `/smartboxes/${A.box.id}`)).body.online === false, 70000, 1000);
    } finally {
      A.sim.rejectAll = false; A.sim.timer = setInterval(() => A.sim.sendTelemetry(), 2000); A.sim.sendTelemetry();
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    await until(async () => (await api(A.op, 'GET', `/smartboxes/${A.box.id}`)).body.online === true);
    must(sec >= 30 && sec <= 50, `판정 시간 ${sec}초가 기준(40초±10)을 벗어남`);
    return `${sec}초 후 오프라인 판정(기준 40초), 계측 재개 시 온라인`;
  });

  if (process.env.MANAGE_SERVER === '1') {
    await scenario('2', '서버 재시작 후 장치 상태 복원 · 진행 중 명령 복원', async () => {
      const su = await stepUp(A.power, A.powerName);
      const r = await api(A.power, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'power_cycle', params: { ch: 5, off_sec: 6 }, reason: '재시작 중 명령' }, { 'x-step-up-token': su });
      await waitCmd(A.op, r.body.id, ['received']);
      await stopServer();
      await sleep(2000);
      await startServer();
      const tok = await login(A.opName, PW); A.op = tok;
      const c = await waitCmd(tok, r.body.id, ['done', 'timeout'], 40000);
      must(c.status === 'done', `재시작 후 명령 상태 ${c.status}`);
      const box = (await api(tok, 'GET', `/smartboxes/${A.box.id}`)).body;
      must(box.online === true && box.latest, '재시작 후 장치 상태 미복원');
      // 기존 세션 토큰은 서버 재시작 후에도 유효해야 함(서명키 영속)
      must((await api(A.center, 'GET', '/me')).status === 200, '재시작 후 기존 세션 무효');
      return `재시작 중 power_cycle 결과 수신(done), 온라인·최근 계측 유지`;
    });
  } else notRun('2', '서버 재시작 후 장치 상태 복원', 'MANAGE_SERVER=1 로 실행할 때만 수행');

  await scenario('11', '기관 간 데이터 접근 차단', async () => {
    const list = await api(B.op, 'GET', '/smartboxes');
    must(list.status === 200 && !list.body.some(x => x.id === A.box.id), 'B기관 목록에 A기관 장치 노출');
    must((await api(B.op, 'GET', `/smartboxes/${A.box.id}`)).status === 404, 'B기관이 A기관 장치 상세 조회');
    must((await api(B.op, 'GET', `/smartboxes/${A.box.id}/telemetry`)).status === 404, 'B기관이 A기관 계측 조회');
    must(!(await api(B.op, 'GET', '/alarms')).body.some(x => x.org_id === A.org.id), 'B기관에 A기관 알람 노출');
    must(!(await api(B.op, 'GET', '/sites')).body.some(x => x.org_id === A.org.id), 'B기관에 A기관 현장 노출');
    must((await api(B.op, 'POST', `/smartboxes/${A.box.id}/commands`, { type: 'telemetry_now', params: {} })).status === 404, 'B기관이 A기관 장치에 명령');
    const anyA = (await api(A.op, 'GET', '/alarms')).body[0];
    if (anyA) must((await api(B.op, 'POST', `/alarms/${anyA.id}/ack`, {})).status === 404, 'B기관이 A기관 알람 확인');
    const sock = io(BASE, { path: '/socket.io', auth: { token: B.op }, transports: ['websocket'] });
    let leaked = 0; sock.on('telemetry', m => { if (m.smartbox_id === A.box.id) leaked++; });
    await sleep(6000); sock.close();
    must(leaked === 0, `B기관 실시간 채널로 A기관 계측 ${leaked}건 수신`);
    return 'REST 6종 + 실시간 채널에서 타 기관 데이터 차단';
  });

  await scenario('S-lock', '로그인 실패 반복 시 계정 잠금', async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await api(null, 'POST', '/auth/login', { username: B.opName, password: 'wrong-pass' });
    must(last.status === 423, `잠금 안 됨 ${last.status}`);
    const ok = await api(null, 'POST', '/auth/login', { username: B.opName, password: PW });
    must(ok.status === 423, '잠금 중 올바른 비밀번호로 로그인됨');
    const h = await pg.query(`SELECT count(*)::int c FROM login_history WHERE username=$1 AND NOT success`, [B.opName]);
    return `5회 실패 후 잠금, 실패 이력 ${h.rows[0].c}건 기록`;
  });

  await scenario('14', '장치 대량 접속 및 동시 이벤트 부하', async () => {
    const N = Number(process.env.LOAD_N || 100), SEC = Number(process.env.LOAD_SEC || 30);
    const devs = [];
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const r = await api(A.center, 'POST', '/smartboxes', { cabinet_id: A.cab.id, serial_no: `LOAD-${i}` });
      must(r.status === 201, '부하용 장치 등록 실패');
      devs.push(new SimDevice(r.body.provisioning, { interval: 1, fixedInterval: true }));
    }
    const regSec = ((Date.now() - t0) / 1000).toFixed(1);
    await Promise.all(devs.map(d => d.connect())); sims.push(...devs);
    const startCount = (await pg.query('SELECT count(*)::int c FROM telemetry')).rows[0].c;
    const tStart = Date.now();
    await sleep(SEC * 1000);
    const ids = (await pg.query('SELECT id FROM smartboxes WHERE device_id = ANY($1)', [devs.map(d => d.id)])).rows.map(r => r.id);
    devs.forEach(d => d.setInput('door', true));  // 동시 이벤트 N건
    await until(async () => (await pg.query(`SELECT count(*)::int c FROM alarms WHERE type='input.door' AND smartbox_id = ANY($1) AND state='open'`, [ids])).rows[0].c === N, 20000, 500);
    const alarmSec = ((Date.now() - tStart) / 1000 - SEC).toFixed(1);
    const endCount = (await pg.query('SELECT count(*)::int c FROM telemetry')).rows[0].c;
    const lag = (await pg.query(`SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM received_at - ts)) p95, max(extract(epoch FROM received_at - ts)) mx FROM telemetry WHERE received_at > now() - make_interval(secs => $1)`, [SEC])).rows[0];
    const online = (await api(A.op, 'GET', '/smartboxes')).body.filter(x => x.online).length;
    await Promise.all(devs.map(d => d.stop()));
    const got = endCount - startCount, expect = N * SEC;
    must(got >= expect * 0.9, `계측 유실: ${got}/${expect}`);
    return `${N}대 등록 ${regSec}초, ${SEC}초간 계측 ${got}건(예상 ${expect}), 지연 p95 ${Number(lag.p95).toFixed(3)}초·최대 ${Number(lag.mx).toFixed(3)}초, 동시 문열림 ${N}건 알람 ${alarmSec}초 내 생성, 동시 온라인 ${online}대`;
  });

  await scenario('18', '모든 원격제어의 감사로그 기록 · 위변조 탐지', async () => {
    const cmds = (await pg.query(`SELECT id, status, source FROM commands WHERE org_id=$1`, [A.org.id])).rows;
    const missing = [];
    for (const c of cmds) {
      const a = (await pg.query(`SELECT action FROM audit_logs WHERE target_type='command' AND target_id=$1`, [c.id])).rows.map(r => r.action);
      const created = a.some(x => x.startsWith('command.create') || x === 'command.request_approval');
      const finished = !['done', 'failed', 'rejected', 'timeout'].includes(c.status) || a.includes(`command.${c.status}`);
      if (!created || !finished) missing.push(`${c.id}:${a.join('/')}`);
    }
    must(!missing.length, `감사로그 누락 ${missing.join(', ')}`);
    let v = await api(A.center, 'GET', '/audit-logs/verify');
    must(v.body.ok === true, `정상 상태에서 검증 실패 ${JSON.stringify(v.body)}`);
    let blocked = false;
    try { await pg.query(`UPDATE audit_logs SET detail='{}' WHERE id=(SELECT max(id) FROM audit_logs)`); } catch { blocked = true; }
    must(blocked, '감사로그 UPDATE가 허용됨');
    const row = (await pg.query(`SELECT id, detail FROM audit_logs WHERE action='command.approve' ORDER BY id DESC LIMIT 1`)).rows[0];
    await pg.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update');
    await pg.query(`UPDATE audit_logs SET detail = detail || '{"tampered":true}' WHERE id=$1`, [row.id]);
    v = await api(A.center, 'GET', '/audit-logs/verify');
    await pg.query(`UPDATE audit_logs SET detail=$2 WHERE id=$1`, [row.id, JSON.stringify(row.detail)]);
    await pg.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');
    must(v.body.ok === false && Number(v.body.broken_at_id) === Number(row.id), `위변조 미탐지 ${JSON.stringify(v.body)}`);
    const v2 = await api(A.center, 'GET', '/audit-logs/verify');
    must(v2.body.ok === true, '원복 후 검증 실패');
    return `명령 ${cmds.length}건 모두 생성·결과 감사로그 존재, UPDATE 차단, DB 관리자 권한 변조도 행 #${row.id}에서 탐지`;
  });

  notRun('4', '카메라 단독 장애 감지', '2단계(VMS·카메라 연동) 범위');
  notRun('5', 'PoE 스위치 전체 장애 감지', '2~3단계(PoE 스위치 연동·원인 분석) 범위');
  notRun('6', '자동복구 횟수 제한', '서버 자동복구 엔진은 3단계. 장치 펌웨어 측 시간당 제한은 펌웨어 로직 시험 참고');
  notRun('8', 'VMS 연결 실패 및 재연결', '2단계 범위');
  notRun('9', '타사 VMS 이벤트 수신', '2단계 범위');
  notRun('10', '카메라와 함체 매핑', '2단계 범위 (DB 다대다 구조만 구현)');
  notRun('13', '인터넷 없는 환경에서 정상 동작', '격리망 시험 환경 필요 — 서버는 외부 인터넷 호출이 없도록 설계');
  notRun('15', '보고서 생성 및 파일 다운로드', '3단계 범위');
  notRun('17', '펌웨어 업데이트 실패 시 복구', 'OTA는 미구현 — 실장비 필요');

  for (const s of sims) await s.stop().catch(() => undefined);
  if (process.env.MANAGE_SERVER === '1') {
    await stopServer();  // 쓰기가 멈춘 상태에서 백업·복원 비교
  await scenario('16', '백업·복원 후 데이터 정합성', async () => {
      const { execSync } = require('child_process');
      execSync(`pg_dump -h /tmp -U postgres -Fc eum -f /tmp/eum.dump && (dropdb -h /tmp -U postgres --if-exists eum_restore) && createdb -h /tmp -U postgres eum_restore && pg_restore -h /tmp -U postgres -d eum_restore /tmp/eum.dump`, { stdio: 'pipe' });
      const tables = (await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map(r => r.tablename);
      const r2 = new Client({ connectionString: PG.replace(/\/eum$/, '/eum_restore') }); await r2.connect();
      const diff = [];
      for (const t of tables) {
        const a = (await pg.query(`SELECT count(*)::int c, md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) h FROM "${t}" x`)).rows[0];
        const b = (await r2.query(`SELECT count(*)::int c, md5(coalesce(string_agg(md5(x::text), '' ORDER BY md5(x::text)), '')) h FROM "${t}" x`)).rows[0];
        if (a.c !== b.c || a.h !== b.h) diff.push(`${t}(${a.c}/${b.c})`);
      }
      const lastHash = (await r2.query('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1')).rows[0]?.hash;
      await r2.end();
      must(!diff.length, `불일치: ${diff.join(', ')}`);
      return `테이블 ${tables.length}개 행 수·내용 해시 일치 (pg_dump/pg_restore), 감사 체인 끝 ${String(lastHash).slice(0, 12)}…`;
    });

  } else notRun('16', '백업·복원 후 데이터 정합성', 'MANAGE_SERVER=1 로 실행할 때만 수행');
  await pg.end();
  const out = path.join(__dirname, '..', 'docs');
  fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const md = ['# 검증 시나리오 실행 결과', '', `실행 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)`, '',
    '환경: 관제서버(Node 22, NestJS) + PostgreSQL 16 + 내장 MQTT 브로커(TLS 1.2, 장치별 클라이언트 인증서) + SB-MB01 프로토콜 시뮬레이터. 실제 스마트박스 하드웨어는 사용하지 않음.', '',
    '| 번호 | 시나리오 | 결과 | 소요(초) | 내용 |', '| --- | --- | --- | --- | --- |',
    ...results.map(r => `| ${r.no} | ${r.name} | ${r.result} | ${r.sec} | ${String(r.note).replace(/\|/g, '/')} |`), '',
    `통과 ${results.filter(r => r.result === '통과').length} · 실패 ${results.filter(r => r.result === '실패').length} · 미실행 ${results.filter(r => r.result === '미실행').length}`];
  fs.writeFileSync(path.join(out, 'test-results.md'), md.join('\n') + '\n');
  console.log(md.slice(-1)[0]);
  process.exit(results.some(r => r.result === '실패') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
