import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { startServer, stopServer, signup, upload, waitJob, newProject, Client, TEST_DB } from './helpers.js';

let A, B, projA, stepModel, srv;
before(async () => { srv = await startServer(); A = await signup('A사'); B = await signup('B사'); projA = await newProject(A, '방수 제어함'); });
after(async () => { await stopServer(); });

// ── 테스트 A: 기계 조립체 STEP ────────────────────────────────────
test('A. STEP 업로드 → 부품 구조 추출 → 3D(GLB) → 부품 선택 정보 → 분해 설정 → 저장', async () => {
  const up = await upload(A, projA.id, 'enclosure_assembly.step');
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.file.version, 1);
  const job = await waitJob(A, up.data.job.id);
  assert.equal(job.status, 'done', job.error);
  const m = await A.get(`/api/models/${job.result.modelId}`);
  assert.equal(m.status, 200);
  stepModel = m.data.model;
  assert.equal(stepModel.parts.length, 18, '부품 18개');
  assert.ok(stepModel.parts.some((p) => p.name === '본체_케이스'), '한글 부품명 보존');
  assert.ok(stepModel.parts.some((p) => p.name === '커버_볼트_M5_1 (4)'), '중복 인스턴스 이름 구분');
  assert.equal(stepModel.source_file_id, up.data.file.id, '원본 파일 ID 연결');
  assert.equal(stepModel.source_file_version, 1, '원본 버전 연결');
  assert.equal(stepModel.method, 'step-brep-tessellation');
  const body = stepModel.parts.find((p) => p.name === '본체_케이스');
  assert.ok(body.extras.brepFaces > 0, 'B-Rep 면 수 기록');
  const glb = await A.get(`/api/models/${stepModel.id}/glb`);
  assert.equal(glb.status, 200);
  assert.equal(glb.data.subarray(0, 4).toString(), 'glTF');
  // 기본 분해 제안: 가장 큰 부품 고정, 나머지는 단계 ≥1
  const sc = m.data.scene.data;
  const fixed = Object.entries(sc.parts).filter(([, v]) => v.explode.step === 0);
  assert.equal(fixed.length, 1);
  assert.ok(Object.values(sc.parts).filter((v) => v.explode.step >= 1).length === 17);
  // 저장: 분해 방향·거리 수정 → 새 버전
  const pid = body.id === fixed[0][0] ? stepModel.parts[1].id : body.id;
  sc.parts[pid].explode = { dir: [1, 0, 0], dist: 123, step: 2 };
  sc.parts[pid].desc = '테스트 설명';
  const sv = await A.put(`/api/models/${stepModel.id}/scene`, { data: sc });
  assert.equal(sv.status, 200);
  assert.equal(sv.data.version, 2);
  const again = await A.get(`/api/models/${stepModel.id}`);
  assert.deepEqual(again.data.scene.data.parts[pid].explode, { dir: [1, 0, 0], dist: 123, step: 2 });
  // 같은 이름 재업로드 → v2 (원본 보존)
  const up2 = await upload(A, projA.id, 'enclosure_assembly.step');
  assert.equal(up2.data.file.version, 2);
  await waitJob(A, up2.data.job.id);
});

test('A-2. 원본 다운로드는 sha256 일치, 위장 파일·조각 순서 오류 차단', async () => {
  const p = await A.get(`/api/projects/${projA.id}`);
  const f = p.data.files.find((x) => x.ext === 'step');
  const orig = await A.get(`/api/files/${f.id}/original`);
  assert.equal(orig.status, 200);
  assert.ok(orig.data.equals(fs.readFileSync('samples/enclosure_assembly.step')));
  const fake = await upload(A, projA.id, Buffer.from('MZ\x90\x00 this is not a step file'), { name: 'virus.step' });
  assert.equal(fake.status, 400);
  assert.match(fake.data.error, /형식이 아닙니다/);
  const bad = await upload(A, projA.id, Buffer.from('hello'), { name: 'x.exe' });
  assert.equal(bad.status, 400);
  const s = await A.post(`/api/projects/${projA.id}/uploads`, { name: 'o.stl', size: 10 });
  const r = await A.put(`/api/uploads/${s.data.uploadId}/chunks/1`, Buffer.alloc(5), { 'Content-Type': 'application/octet-stream' });
  assert.equal(r.status, 409);
});

test('A-3. STL·GLB 업로드 변환', async () => {
  const stl = await upload(A, projA.id, 'cover_single.stl');
  const j = await waitJob(A, stl.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const m = await A.get(`/api/models/${j.result.modelId}`);
  assert.equal(m.data.model.parts.length, 1);
  assert.deepEqual(m.data.model.stats.size, [166, 166, 8]);
  // 변환된 GLB 를 다시 GLB 로 업로드
  const glb = (await A.get(`/api/models/${stepModel.id}/glb`)).data;
  const g = await upload(A, projA.id, glb, { name: 'enclosure.glb' });
  const jg = await waitJob(A, g.data.job.id);
  assert.equal(jg.status, 'done', jg.error);
  const mg = await A.get(`/api/models/${jg.result.modelId}`);
  assert.equal(mg.data.model.parts.length, 18);
  assert.equal(mg.data.model.stats.upAxis, 'Y');
});

// ── 테스트 B: 금형 (1단계 범위: 업로드·부품구조·분해) ─────────────
test('B. 다중 부품 금형 STEP → 부품 트리 → 분해 단계 (코어·캐비티 지정/개폐/BOM 은 2단계)', async () => {
  const pm = await newProject(A, '2단 사출금형', 'mold');
  const up = await upload(A, pm.id, 'mold_assembly.step');
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const m = await A.get(`/api/models/${j.result.modelId}`);
  const names = m.data.model.parts.map((p) => p.name);
  for (const n of ['가동측_형판_코어', '고정측_형판_캐비티', '이젝터_핀_1', '가이드_핀_1', '스프루_부시', '로케이팅_링']) assert.ok(names.some((x) => x.startsWith(n)), n);
  const steps = new Set(Object.values(m.data.scene.data.parts).map((v) => v.explode.step));
  assert.ok(steps.size >= 2, '여러 분해 단계');
});

// ── 테스트 C: 2D CAD ─────────────────────────────────────────────
test('C. DXF 업로드 → 치수 분석 → 두께 미입력 거부 → 사용자 두께 입력 → 3D 생성 → 저장', async () => {
  const up = await upload(A, projA.id, 'bracket_plate.dxf');
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  assert.equal(j.result.analysisOnly, true);
  const f = await A.get(`/api/files/${up.data.file.id}`);
  const a = f.data.analysis;
  assert.equal(a.unit, 'mm');
  assert.ok(a.layers.includes('OUTLINE') && a.layers.includes('HOLES'));
  assert.deepEqual(a.dimensions.map((d) => d.value).sort((x, y) => x - y), [120, 200]);
  assert.ok(a.dimensions.every((d) => d.matchesOutline));
  assert.equal(a.profiles.filter((p) => p.role === 'outer').length, 1);
  assert.equal(a.profiles.filter((p) => p.role === 'hole').length, 6);
  assert.ok(a.profiles.some((p) => p.diameter === 9), 'Ø9 구멍 인식');
  const no = await A.post(`/api/files/${up.data.file.id}/extrude`, {});
  assert.equal(no.status, 400);
  assert.match(no.data.error, /두께/);
  const ok = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 6 });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.stats.size, [200, 120, 6]);
  assert.deepEqual(ok.data.provenance.items.map((i) => i.source).slice(0, 2), ['drawing', 'user']);
  const m = await A.get(`/api/models/${ok.data.modelId}`);
  const vol = m.data.model.parts[0].volume;
  const expect = 200 * 120 * 6 - 4 * Math.PI * 4.5 ** 2 * 6 - Math.PI * 20 ** 2 * 6 - (20 * 20 + Math.PI * 10 ** 2) * 6;
  assert.ok(Math.abs(vol - expect) / expect < 0.003, `체적 ${vol} ≈ ${expect.toFixed(0)}`);
  const sv = await A.put(`/api/models/${ok.data.modelId}/scene`, { data: m.data.scene.data });
  assert.equal(sv.status, 200);
});

// ── 테스트 D: 동영상 ─────────────────────────────────────────────
test('D. 애니메이션 설정 → MP4 렌더 → 다운로드 → 실제 재생 가능 확인(ffprobe·프레임 차이)', { timeout: 300000 }, async () => {
  const m = await A.get(`/api/models/${stepModel.id}`);
  const sc = m.data.scene.data;
  sc.animation.clips = [{ type: 'hold', duration: 0.5 }, { type: 'explode', duration: 1.5 }, { type: 'turntable', duration: 1, degrees: 90 }];
  sc.title = '방수 제어함 테스트'; sc.overlay = { subtitle: '분해 구조' };
  await A.put(`/api/models/${stepModel.id}/scene`, { data: sc });
  const bad = await A.post(`/api/models/${stepModel.id}/renders`, { quality: '8k' });
  assert.equal(bad.status, 400);
  const r = await A.post(`/api/models/${stepModel.id}/renders`, { quality: 'hd', fps: 24 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const j = await waitJob(A, r.data.id, 280000);
  assert.equal(j.status, 'done', j.error);
  assert.equal(j.result.frames, 72);
  const v = await A.get(`/api/videos/${j.result.videoId}/file?download=1`);
  assert.equal(v.status, 200);
  assert.match(v.headers.get('content-disposition'), /attachment/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eumvid-'));
  const mp4 = path.join(dir, 'v.mp4');
  fs.writeFileSync(mp4, v.data);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]).toString());
  const st = probe.streams[0];
  assert.equal(st.codec_name, 'h264');
  assert.equal(st.width, 1280); assert.equal(st.height, 720);
  assert.equal(Number(st.nb_frames), 72);
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.05);
  // 처음(조립)과 분해 완료 프레임이 실제로 다른지: 디코딩 후 픽셀 차이
  const frame = (t) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const f0 = frame(0.1), f1 = frame(1.95);
  let diff = 0, varSum = 0; const mean = f0.reduce((s, x) => s + x, 0) / f0.length;
  for (let i = 0; i < f0.length; i++) { diff += Math.abs(f0[i] - f1[i]); varSum += (f0[i] - mean) ** 2; }
  assert.ok(Math.sqrt(varSum / f0.length) > 5, '빈 화면 아님');
  assert.ok(diff / f0.length > 1.5, `분해 전후 프레임 차이 ${(diff / f0.length).toFixed(2)}`);
  fs.copyFileSync(mp4, path.join(os.tmpdir(), 'eum3d-test-render.mp4'));
  const range = await A.get(`/api/videos/${j.result.videoId}/file`, { Range: 'bytes=0-99' });
  assert.equal(range.status, 206);
  assert.equal(range.data.length, 100);
  const th = await A.get(`/api/videos/${j.result.videoId}/thumb`);
  assert.equal(th.headers.get('content-type'), 'image/jpeg');
});

// ── 테스트 E: 웹 쇼룸 ────────────────────────────────────────────
test('E. 공유 링크 → 비로그인 접속 → 모델·분해 장면·부품 정보 → 비밀번호·폐기·재발급·만료·QR', async () => {
  const s = await A.post(`/api/models/${stepModel.id}/shares`, { title: '고객 쇼룸' });
  assert.equal(s.status, 201);
  assert.match(s.data.url, /\/s\/[A-Za-z0-9_-]{16}$/);
  const anon = new Client();
  const pub = await anon.get(`/api/public/shares/${s.data.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.model.parts.length, 18);
  assert.ok(Object.values(pub.data.scene.parts).some((p) => p.desc === '테스트 설명'), '부품 설명 전달');
  assert.ok(!JSON.stringify(pub.data).includes('originals/'), '원본 경로 미노출');
  assert.ok(!('source_file_id' in pub.data.model));
  const g = await anon.get(`/api/public/shares/${s.data.token}/model.glb`);
  assert.equal(g.data.subarray(0, 4).toString(), 'glTF');
  // 비공개 API 는 차단
  assert.equal((await anon.get(`/api/models/${stepModel.id}/glb`)).status, 401);
  const files = (await A.get(`/api/projects/${projA.id}`)).data.files;
  assert.equal((await anon.get(`/api/files/${files[0].id}/original`)).status, 401);
  // SPA 페이지 응답
  const page = await anon.get(`/s/${s.data.token}`);
  assert.equal(page.status, 200);
  // QR
  const qr = await A.get(`/api/shares/${s.data.id}/qr.png`);
  assert.equal(qr.data.subarray(1, 4).toString(), 'PNG');
  // 방문 통계
  const list = await A.get(`/api/projects/${projA.id}/shares`);
  assert.equal(list.data.find((x) => x.id === s.data.id).view_count, 1);
  // 비밀번호
  const sp = await A.post(`/api/models/${stepModel.id}/shares`, { password: 'abcd1234' });
  const locked = await anon.get(`/api/public/shares/${sp.data.token}`);
  assert.equal(locked.status, 401); assert.equal(locked.data.needsPassword, true);
  assert.equal((await anon.get(`/api/public/shares/${sp.data.token}/model.glb`)).status, 401);
  assert.equal((await anon.post(`/api/public/shares/${sp.data.token}/unlock`, { password: 'wrong' })).status, 401);
  const un = await anon.post(`/api/public/shares/${sp.data.token}/unlock`, { password: 'abcd1234' });
  assert.equal(un.status, 200);
  assert.equal((await anon.get(`/api/public/shares/${sp.data.token}`)).status, 200, '쿠키로 통과');
  assert.equal((await new Client().get(`/api/public/shares/${sp.data.token}`, { 'x-share-pass': un.data.passToken })).status, 200, '헤더 토큰으로 통과');
  // 폐기 → 410, 재발급 → 새 토큰
  const rv = await A.patch(`/api/shares/${s.data.id}`, { revoke: true });
  assert.ok(rv.data.revoked_at);
  assert.equal((await anon.get(`/api/public/shares/${s.data.token}`)).status, 410);
  const re = await A.post(`/api/shares/${s.data.id}/reissue`);
  assert.notEqual(re.data.token, s.data.token);
  assert.equal((await anon.get(`/api/public/shares/${re.data.token}`)).status, 200);
  // 만료
  const ex = await A.post(`/api/models/${stepModel.id}/shares`, { expiresAt: new Date(Date.now() + 1500).toISOString() });
  assert.equal((await anon.get(`/api/public/shares/${ex.data.token}`)).status, 200);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal((await anon.get(`/api/public/shares/${ex.data.token}`)).status, 410);
});

// ── 테스트 F: 보안 (회사 간 격리) ─────────────────────────────────
test('F. 다른 회사 계정으로 프로젝트·파일·모델·렌더 결과·공유 관리 접근 차단', async () => {
  const pa = (await A.get(`/api/projects/${projA.id}`)).data;
  const fileId = pa.files[0].id, modelId = stepModel.id;
  const vids = (await A.get(`/api/models/${modelId}/videos`)).data;
  assert.ok(vids.length >= 1);
  const shares = (await A.get(`/api/projects/${projA.id}/shares`)).data;
  const jobId = pa.jobs[0].id;
  const listB = await B.get('/api/projects');
  assert.equal(listB.status, 200);
  assert.equal(listB.data.length, 0, 'B 목록에 A 프로젝트 없음');
  const deny = [
    ['GET', `/api/projects/${projA.id}`], ['GET', `/api/files/${fileId}`], ['GET', `/api/files/${fileId}/original`],
    ['GET', `/api/models/${modelId}`], ['GET', `/api/models/${modelId}/glb`], ['GET', `/api/videos/${vids[0].id}/file`],
    ['GET', `/api/videos/${vids[0].id}/thumb`], ['GET', `/api/jobs/${jobId}`], ['GET', `/api/shares/${shares[0].id}/qr.png`],
  ];
  for (const [m, u] of deny) { const r = await B.req(m, u); assert.equal(r.status, 404, `${m} ${u} → ${r.status}`); }
  assert.equal((await B.get(`/api/models/${modelId}/videos`)).data.length, 0);
  assert.equal((await B.get(`/api/projects/${projA.id}/shares`)).data.length, 0);
  assert.equal((await B.put(`/api/models/${modelId}/scene`, { data: { parts: {} } })).status, 404);
  assert.equal((await B.post(`/api/models/${modelId}/shares`, {})).status, 404);
  assert.equal((await B.post(`/api/models/${modelId}/renders`, {})).status, 404);
  assert.equal((await B.patch(`/api/shares/${shares[0].id}`, { revoke: true })).status, 404);
  assert.equal((await B.post(`/api/projects/${projA.id}/uploads`, { name: 'x.stl', size: 100 })).status, 404);
  assert.equal((await B.post(`/api/files/${fileId}/extrude`, { thickness: 3 })).status, 404);
  // A 의 데이터는 그대로
  assert.equal((await A.get(`/api/models/${modelId}`)).status, 200);

  // DB 계층: WHERE 없는 쿼리도 RLS 로 차단, 다른 회사 company_id 로 INSERT 불가
  const c = new pg.Client({ connectionString: TEST_DB }); await c.connect();
  try {
    const coB = B.user.company_id, coA = A.user.company_id;
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE eum_app'); await c.query("SELECT set_config('app.company_id',$1,true)", [coB]);
    for (const t of ['projects', 'files', 'models', 'videos', 'share_links', 'jobs', 'scenes', 'audit_logs']) {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE company_id=$1`, [coA]);
      assert.equal(rows[0].n, 0, `RLS ${t}`);
    }
    const { rows: all } = await c.query('SELECT count(*)::int AS n FROM projects');
    assert.equal(all[0].n, 0);
    await assert.rejects(c.query('INSERT INTO projects (company_id,name) VALUES ($1,$2)', [coA, '침투']), /row-level security/);
    await c.query('ROLLBACK');
    // 회사 설정이 없으면 아무것도 안 보임
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE eum_app');
    assert.equal((await c.query('SELECT count(*)::int AS n FROM models')).rows[0].n, 0);
    await c.query('ROLLBACK');
  } finally { await c.end(); }
});

test('F-2. 역할 권한: 보기 전용 사용자는 수정 불가, 감사 로그 기록', async () => {
  const add = await A.post('/api/auth/users', { email: `viewer-${Date.now()}@test.kr`, name: '열람자', password: 'password123', role: 'viewer' });
  assert.equal(add.status, 201);
  const V = new Client();
  assert.equal((await V.post('/api/auth/login', { email: add.data.email, password: 'password123' })).status, 200);
  assert.equal((await V.get(`/api/models/${stepModel.id}`)).status, 200, '같은 회사 조회 가능');
  assert.equal((await V.put(`/api/models/${stepModel.id}/scene`, { data: { parts: {} } })).status, 403);
  assert.equal((await V.post('/api/projects', { name: 'x' })).status, 403);
  assert.equal((await V.get(`/api/files/${(await A.get(`/api/projects/${projA.id}`)).data.files[0].id}/original`)).status, 403);
  assert.equal((await B.get('/api/auth/audit')).data.every((l) => l.company_id === B.user.company_id), true);
  const log = (await A.get('/api/auth/audit')).data.map((l) => l.action);
  for (const a of ['file.upload', 'model.create', 'share.create', 'share.revoke', 'video.render', 'file.download_original']) assert.ok(log.includes(a), a);
});
