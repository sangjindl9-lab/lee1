import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, signup, upload, waitJob, newProject } from './helpers.js';

let A, B, proj;
before(async () => { await startServer(); A = await signup('도면A'); B = await signup('도면B'); proj = await newProject(A, '도면 변환', 'machine'); });
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

test('H-2. 스캔 PDF → 업로드·미리보기는 되고 3D 생성은 거부(안내)', async () => {
  const up = await upload(A, proj.id, 'scanned_drawing.pdf');
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.pdfType, 'scanned');
  assert.equal(a.convertible, false);
  assert.match(a.warnings[0], /스캔/);
  assert.equal((await A.get(`/api/files/${up.data.file.id}/preview`)).status, 200);
  const r = await A.post(`/api/files/${up.data.file.id}/extrude`, { thickness: 5, scale: 1 });
  assert.equal(r.status, 400);
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
