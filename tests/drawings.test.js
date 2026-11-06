import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, stopServer, signup, upload, waitJob, newProject, Client } from './helpers.js';

let A, B, proj, srv;
before(async () => { srv = await startServer(); A = await signup('도면A'); B = await signup('도면B'); proj = await newProject(A, '도면 변환', 'machine'); });
after(stopServer);

test('G. DWG 업로드 → LibreDWG 변환 → DXF 분석(버전·단위·치수·윤곽) → 두께 입력 3D', async () => {
  for (const [f, ver] of [['dwg/example_2018.dwg', 'AutoCAD 2018'], ['dwg/example_2000.dwg', 'AutoCAD 2000']]) {
    const up = await upload(A, proj.id, f, { name: f.split('/')[1] });
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const j = await waitJob(A, up.data.job.id);
    assert.equal(j.status, 'done', j.error);
    const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
    assert.equal(a.format, 'DWG');
    assert.match(a.version, new RegExp(ver));
    assert.equal(a.unit, 'mm');
    assert.ok(a.dimensions.length >= 5, '치수 인식');
    assert.ok(a.profiles.some((p) => p.role === 'outer'));
    const no = await A.post(`/api/files/${up.data.file.id}/extrude`, {});
    assert.equal(no.status, 400);
    const ok = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 3 });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    const m = (await A.get(`/api/models/${ok.data.modelId}`)).data.model;
    assert.equal(m.method, 'dwg-extrude');
    assert.equal(m.stats.size[2], 3);
  }
  // 확장자만 dwg 인 위장 파일
  const fake = await upload(A, proj.id, Buffer.from('not a dwg at all'), { name: 'fake.dwg' });
  assert.equal(fake.status, 400);
});

test('H. 벡터 PDF(1:2) → 도곽 구분·축척 표기 인식 → 축척 없으면 거부 → 1:2·두께 6 → 200×120×6', async () => {
  const up = await upload(A, proj.id, 'bracket_plate_1to2.pdf');
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.format, 'PDF'); assert.equal(a.pdfType, 'vector');
  assert.equal(a.scaleRequired, true); assert.equal(a.scaleHint, 2);
  assert.equal(a.profiles.filter((p) => p.role === 'frame').length, 1, '도곽 1개');
  const outer = a.profiles.filter((p) => p.role === 'outer')[0];
  assert.deepEqual(outer.bbox.map((p) => p.map((v) => Math.round(v * 10) / 10)), [[40, 60], [140, 120]], '용지 mm 좌표');
  const holes = a.profiles.filter((p) => p.role === 'hole' && p.parent === outer.id);
  assert.equal(holes.length, 6, '구멍 6개 (원 4 + 중앙 원 + 선·호로 된 장공)');
  assert.equal(holes.filter((h) => Math.abs(h.diameter - 4.5) < 0.01).length, 4);
  assert.ok(a.numbers.includes(200) && a.numbers.includes(120), '치수 글자');
  assert.ok(a.texts.some((t) => t.includes('SS400')));
  const pv = await A.get(`/api/files/${up.data.file.id}/preview`);
  assert.equal(pv.data.subarray(1, 4).toString(), 'PNG');
  assert.equal((await B.get(`/api/files/${up.data.file.id}/preview`)).status, 404, '타사 미리보기 차단');
  const noScale = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 6, profiles: [outer.id] });
  assert.equal(noScale.status, 400); assert.match(noScale.data.error, /축척/);
  const ok = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 6, scale: 2, profiles: [outer.id] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.stats.size.map((v) => Math.round(v * 10) / 10), [200, 120, 6]);
  assert.deepEqual(ok.data.provenance.items.map((i) => i.source).slice(0, 3), ['drawing', 'user', 'user']);
  const m = (await A.get(`/api/models/${ok.data.modelId}`)).data.model;
  const expect = 200 * 120 * 6 - 4 * Math.PI * 4.5 ** 2 * 6 - Math.PI * 20 ** 2 * 6 - (20 * 20 + Math.PI * 10 ** 2) * 6;
  assert.ok(Math.abs(m.parts[0].volume - expect) / expect < 0.005, `체적 ${m.parts[0].volume} ≈ ${expect.toFixed(0)}`);
});

test('H-2. 스캔 PDF → 래스터 분석(외형·구멍) → 업로드 즉시 자동 3D 초안(참고용·검토 대기)', async () => {
  const up = await upload(A, proj.id, 'scanned_drawing.pdf');
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.pdfType, 'scanned');
  assert.ok(a.raster?.dpi > 0, '래스터 분석');
  assert.equal(a.convertible, true);
  assert.match(a.warnings[0], /스캔/);
  const outer = a.profiles.find((p) => p.role === 'outer');
  // 이미지: 600×360px 사각형(150dpi) = 101.6×61 용지 mm, 원 Ø80px = 13.5mm
  assert.ok(Math.abs(outer.bbox[1][0] - outer.bbox[0][0] - 101.6) < 1.5, `가로 ${outer.bbox[1][0] - outer.bbox[0][0]}`);
  const hole = a.profiles.find((p) => p.role === 'hole' && p.parent === outer.id);
  assert.ok(hole?.diameter && Math.abs(hole.diameter - 13.5) < 0.8, `구멍 ${hole?.diameter}`);
  assert.equal((await A.get(`/api/files/${up.data.file.id}/preview`)).status, 200);
  assert.equal(a.autoDraft.status, 'created');
  assert.equal(a.autoDraft.scale.source, 'default', '축척 근거 없음 → 기본값 표시');
  const m = (await A.get(`/api/models/${a.autoDraft.modelId}`)).data.model;
  assert.equal(m.review_status, 'pending');
  assert.equal(m.provenance.reference, true, '참고용 AI 3D 시각화 표시');
  // 사용자가 값을 확정해 다시 만들 수 있다
  const r = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 5, scale: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test('H-3. 회전(/Rotate 270) PDF → 용지 가로·세로 바뀜 반영, 윤곽이 용지 안·미리보기와 같은 좌표', async () => {
  const up = await upload(A, proj.id, 'bracket_plate_rot270.pdf');
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.page.rotation, 270);
  assert.deepEqual([Math.round(a.page.width), Math.round(a.page.height)], [210, 297], '회전 적용된 용지 크기');
  const outer = a.profiles.filter((p) => p.role === 'outer').sort((x, y) => y.area - x.area)[0];
  const [w, h] = [outer.bbox[1][0] - outer.bbox[0][0], outer.bbox[1][1] - outer.bbox[0][1]];
  assert.deepEqual([Math.round(w), Math.round(h)], [60, 100], '외곽도 회전 (60×100)');
  for (const p of a.profiles) {
    assert.ok(p.bbox[0][0] >= -0.5 && p.bbox[1][0] <= a.page.width + 0.5 && p.bbox[0][1] >= -0.5 && p.bbox[1][1] <= a.page.height + 0.5, `${p.id} 용지 밖`);
  }
  // 미리보기 이미지 비율 = 용지 비율
  const png = (await A.get(`/api/files/${up.data.file.id}/preview`)).data;
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  assert.ok(Math.abs(pw / ph - a.page.width / a.page.height) < 0.01, `미리보기 ${pw}×${ph}`);
  assert.equal(a.profiles.filter((p) => p.role === 'hole' && p.parent === outer.id).length, 6);
});

test('R. STEP 없이 3면도 → 투상도 자동 인식 → 결합 3D 초안(체적 정답 비교) → 검토 승인', async () => {
  for (const [file, scale] of [['three_view_block.dxf', undefined], ['three_view_block_1to2.pdf', 2]]) {
    const up = await upload(A, proj.id, file);
    const j = await waitJob(A, up.data.job.id);
    assert.equal(j.status, 'done', j.error);
    const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
    assert.equal(a.groups.length, 2, `${file}: 물체 2개`);
    const g1 = a.groups.find((g) => g.side);
    const role = (id) => a.views.find((v) => v.id === id);
    assert.ok(g1.top && g1.side && g1.topPos === 'above' && g1.sidePos === 'right', '3각법 정면·평면·우측면');
    assert.ok(role(g1.front).silhouettes[0].exact, '닫힌 윤곽은 정확한 좌표 사용');
    if (scale) {
      const no = await A.post(`/api/files/${up.data.file.id}/reconstruct`, {});
      assert.equal(no.status, 400); assert.match(no.data.error, /축척/);
    }
    const r = await A.post(`/api/files/${up.data.file.id}/reconstruct`, scale ? { scale } : {});
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const m = (await A.get(`/api/models/${r.data.modelId}`)).data.model;
    assert.equal(m.method, 'views-reconstruct');
    assert.equal(m.review_status, 'pending');
    assert.ok(m.provenance.items.some((i) => i.source === 'ai'), 'AI 추정 구분');
    const vols = m.parts.map((p) => p.volume).sort((x, y) => y - x);
    assert.equal(vols.length, 2);
    assert.ok(Math.abs(vols[0] - 185717) / 185717 < 0.003, `계단 블록 체적 ${vols[0]}`);
    assert.ok(Math.abs(vols[1] - 28274) / 28274 < 0.01, `원통 체적 ${vols[1]}`);
    assert.ok(m.parts.every((p) => p.extras?.estimated), '부품마다 추정 표시');
    // 타사 차단
    assert.equal((await B.post(`/api/files/${up.data.file.id}/reconstruct`, {})).status, 404);
    assert.equal((await B.post(`/api/models/${m.id}/review`, { decision: 'approved' })).status, 404);
    // 승인
    const ok = await A.post(`/api/models/${m.id}/review`, { decision: 'approved', note: '외형 확인' });
    assert.equal(ok.data.review_status, 'approved');
  }
  // 사용자 지정 그룹: 측면도 제외하고 정면+평면만으로도 생성
  const up = await upload(A, proj.id, 'three_view_block.dxf', { name: 'tv2.dxf' });
  await waitJob(A, up.data.job.id);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  const g = a.groups.find((x) => x.side);
  const r = await A.post(`/api/files/${up.data.file.id}/reconstruct`, { groups: [{ ...g, side: null, sidePos: null }] });
  assert.equal(r.status, 201);
  const vol = (await A.get(`/api/models/${r.data.modelId}`)).data.model.parts[0].volume;
  assert.ok(Math.abs(vol - 185717) / 185717 < 0.003, '이 형상은 정면+평면만으로 결정됨');
  // 일반 모델은 검토 대상 아님
  const plain = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 5 });
  assert.equal((await A.post(`/api/models/${plain.data.modelId}/review`, { decision: 'approved' })).status, 404);
});

test('M. 금형 조립도(3면도, 해칭·중심선·숨은선) → 판·스페이서·이젝터·핀·가이드핀·스프루 부품별 3D', async () => {
  const up = await upload(A, proj.id, 'mold_assy_3view.dxf');
  await waitJob(A, up.data.job.id);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.groups.length, 1);
  const r = await A.post(`/api/files/${up.data.file.id}/reconstruct`, {});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const parts = (await A.get(`/api/models/${r.data.modelId}`)).data.model.parts;
  const size = (p) => p.bbox.max.map((v, i) => Math.round(v - p.bbox.min[i]));
  const has = (w, d, h, z) => parts.some((p) => { const s = size(p); return s[0] === w && s[1] === d && s[2] === h && (z == null || Math.round(p.bbox.min[2]) === z); });
  assert.equal(parts.length, 12, '부품 12개');
  for (const [w, d, h, z] of [[200, 180, 25, 0], [200, 180, 40, 85], [200, 180, 45, 125], [200, 180, 25, 170], [30, 180, 60, 25], [130, 180, 15, 37]]) assert.ok(has(w, d, h, z), `판/블록 ${w}×${d}×${h}@${z}`);
  assert.equal(parts.filter((p) => { const s = size(p); return s[0] === 30 && s[2] === 60; }).length, 2, '스페이서 좌·우');
  const pins = parts.filter((p) => p.name.includes('핀'));
  assert.equal(pins.length, 5, '이젝터핀 2 + 가이드핀 2 + 스프루 1');
  const guide = pins.filter((p) => size(p)[0] === 16 && size(p)[2] === 85).map((p) => p.bbox.min.slice(0, 2).map(Math.round));
  assert.deepEqual(guide.sort(), [[10, 10], [174, 154]], '가이드핀 위치 = 평면도 숨은선 원');
});

test('P. 분전반 외함도(3면도) → 베이스·외함·문·손잡이 4개 부품', async () => {
  const up = await upload(A, proj.id, 'panel_3view.dxf');
  await waitJob(A, up.data.job.id);
  const r = await A.post(`/api/files/${up.data.file.id}/reconstruct`, {});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const parts = (await A.get(`/api/models/${r.data.modelId}`)).data.model.parts;
  const sizes = parts.map((p) => p.bbox.max.map((v, i) => Math.round(v - p.bbox.min[i])).join('x')).sort();
  assert.deepEqual(sizes, ['20x30x120', '560x30x760', '600x250x100', '600x250x800'].sort());
});

test('M-2. 같은 금형 도면을 "외형 한 덩어리" 모드로 → 부품 1개', async () => {
  const up = await upload(A, proj.id, 'mold_assy_3view.dxf', { name: 'mold2.dxf' });
  await waitJob(A, up.data.job.id);
  const r = await A.post(`/api/files/${up.data.file.id}/reconstruct`, { mode: 'outline' });
  assert.equal(r.status, 201);
  const parts = (await A.get(`/api/models/${r.data.modelId}`)).data.model.parts;
  assert.equal(parts.length, 1);
  const sz = parts[0].bbox.max.map((v, i) => v - parts[0].bbox.min[i]);
  [200, 180, 195].forEach((v, i) => assert.ok(Math.abs(sz[i] - v) <= 1.5, `외형 ${sz.map(Math.round)}`));
});

test('X. 삭제: 영상·모델·파일(연쇄)·공유 기록·프로젝트, 저장소 파일 실제 제거, 타사·보기전용 차단', async () => {
  const p = await newProject(A, '삭제 시험');
  const filesOnDisk = () => { const out = []; const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.join(d, e.name)); }; walk(path.join(srv.dataDir, 'storage', 'companies', A.user.company_id)); return out; };
  const up = await upload(A, p.id, 'bracket_plate.dxf');
  await waitJob(A, up.data.job.id);
  const m1 = (await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 5 })).data.modelId;
  const m2 = (await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 8 })).data.modelId;
  const sh = (await A.post(`/api/models/${m1}/shares`, {})).data;
  const glbs = () => filesOnDisk().filter((f) => f.endsWith('.glb'));
  // 타사·보기전용 차단
  assert.equal((await B.req('DELETE', `/api/models/${m1}`)).status, 404);
  assert.equal((await B.req('DELETE', `/api/files/${up.data.file.id}`)).status, 404);
  assert.equal((await B.req('DELETE', `/api/projects/${p.id}`)).status, 404);
  const v = await A.post('/api/auth/users', { email: `ro-${Date.now()}@test.kr`, name: '열람', password: 'password123', role: 'viewer' });
  const V = new Client(); await V.post('/api/auth/login', { email: v.data.email, password: 'password123' });
  assert.equal((await V.req('DELETE', `/api/models/${m1}`)).status, 403);
  // 모델 삭제 → 공유 링크도 사라짐, GLB 파일 제거, 원본은 남음
  assert.equal((await A.req('DELETE', `/api/models/${m1}`)).status, 200);
  assert.equal((await A.get(`/api/models/${m1}`)).status, 404);
  assert.equal((await new Client().get(`/api/public/shares/${sh.token}`)).status, 404);
  assert.ok(!glbs().some((f) => f.includes(m1)), 'm1 GLB 제거');
  assert.equal((await A.get(`/api/files/${up.data.file.id}`)).status, 200);
  // 파일 삭제 → 남은 모델(m2)까지 연쇄 삭제, 원본 파일 제거
  const linked = (await A.get(`/api/projects/${p.id}`)).data.models.filter((m) => m.source_file_id === up.data.file.id).length;
  assert.ok(linked >= 1, 'm2 (+ 업로드 즉시 자동 초안)');
  const del = await A.req('DELETE', `/api/files/${up.data.file.id}`);
  assert.equal(del.status, 200); assert.equal(del.data.deletedModels, linked);
  assert.equal((await A.get(`/api/projects/${p.id}`)).data.models.filter((m) => m.source_file_id === up.data.file.id).length, 0);
  assert.equal((await A.get(`/api/models/${m2}`)).status, 404);
  assert.ok(!filesOnDisk().some((f) => f.includes(up.data.file.id)), '원본 파일 제거');
  // 공유 기록 삭제
  const up2 = await upload(A, p.id, 'cover_single.stl');
  const j2 = await waitJob(A, up2.data.job.id);
  const s2 = (await A.post(`/api/models/${j2.result.modelId}/shares`, {})).data;
  await A.patch(`/api/shares/${s2.id}`, { revoke: true });
  assert.equal((await A.req('DELETE', `/api/shares/${s2.id}`)).status, 200);
  assert.equal((await A.get(`/api/projects/${p.id}/shares`)).data.length, 0);
  // 프로젝트 삭제(관리자) → 전부 제거
  assert.ok(glbs().some((f) => f.includes(j2.result.modelId)));
  assert.equal((await A.req('DELETE', `/api/projects/${p.id}`)).status, 200);
  assert.equal((await A.get(`/api/projects/${p.id}`)).status, 404);
  assert.ok(!glbs().some((f) => f.includes(j2.result.modelId)), '프로젝트 GLB 제거');
  const log = (await A.get('/api/auth/audit')).data.map((l) => l.action);
  for (const a of ['model.delete', 'file.delete', 'share.delete', 'project.delete']) assert.ok(log.includes(a), a);
});
