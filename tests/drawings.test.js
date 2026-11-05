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
