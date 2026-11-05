// 핵심 흐름: 2D 도면(스캔·사진·벡터)만 올리면 → 자동 3D 초안 → 쇼룸 공유까지 (고객사별 격리)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, signup, upload, waitJob, newProject, Client } from './helpers.js';

let A, B, proj;
before(async () => { await startServer(); A = await signup('스캔A'); B = await signup('스캔B'); proj = await newProject(A, '스캔 도면', 'mold'); });
after(stopServer);

const STEP_BLOCK = 185717, PIN = 28274;

test('S. 스캔·사진 3면도(PNG·JPG·스캔PDF) → OCR 축척 → 투상도 결합 자동 3D (정답 체적 3% 이내)', async () => {
  for (const f of ['three_view_block_scan.png', 'three_view_block_scan.jpg', 'three_view_block_scan.pdf']) {
    const up = await upload(A, proj.id, f);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const j = await waitJob(A, up.data.job.id);
    assert.equal(j.status, 'done', j.error);
    assert.ok(j.result.modelId, `${f}: 업로드만으로 모델 생성`);
    const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
    assert.ok(a.raster, '래스터 분석');
    assert.equal(a.scaleHint, 2, `${f}: OCR 로 "SCALE 1:2" 읽음`);
    assert.equal(a.groups.length, 2, '물체 2개');
    const g1 = a.groups.find((g) => g.side);
    assert.ok(g1.top && g1.topPos === 'above' && g1.sidePos === 'right', '3각법 정면·평면·우측면');
    assert.equal(a.autoDraft.kind, 'views');
    assert.deepEqual([a.autoDraft.scale.scale, a.autoDraft.scale.source], [2, 'drawing']);
    const m = (await A.get(`/api/models/${a.autoDraft.modelId}`)).data.model;
    assert.equal(m.method, 'views-reconstruct');
    assert.equal(m.review_status, 'pending');
    assert.ok(m.provenance.reference && /참고용 AI 3D 시각화/.test(m.provenance.note));
    assert.ok(m.provenance.items.some((i) => /스캔/.test(i.what) && i.source === 'ai'), '스캔 외형은 AI 추정으로 표시');
    const vols = m.parts.map((p) => p.volume).sort((x, y) => y - x);
    assert.equal(vols.length, 2);
    assert.ok(Math.abs(vols[0] - STEP_BLOCK) / STEP_BLOCK < 0.03, `${f} 계단 블록 ${vols[0]}`);
    assert.ok(Math.abs(vols[1] - PIN) / PIN < 0.04, `${f} 원통 ${vols[1]}`);
  }
});

test('S-2. 사진 판재 도면(JPG) → 표기 "t=6"·"SCALE 1:2" 읽음 → 200×120×6 자동 돌출, 구멍 반영', async () => {
  const up = await upload(A, proj.id, 'bracket_plate_scan.jpg');
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.format, 'IMAGE');
  assert.equal(a.autoDraft.kind, 'extrude');
  assert.deepEqual([a.autoDraft.thickness.thickness, a.autoDraft.thickness.source], [6, 'drawing']);
  const outer = a.profiles.find((p) => p.role === 'outer');
  assert.equal(a.profiles.filter((p) => p.role === 'hole' && p.parent === outer.id).length, 6, '구멍 6개 (원 5 + 장공)');
  const m = (await A.get(`/api/models/${a.autoDraft.modelId}`)).data.model;
  const [w, h, t] = m.stats.size;
  assert.ok(Math.abs(w - 200) < 2 && Math.abs(h - 120) < 2 && t === 6, `크기 ${m.stats.size}`);
  const expect = 200 * 120 * 6 - 4 * Math.PI * 4.5 ** 2 * 6 - Math.PI * 20 ** 2 * 6 - (20 * 20 + Math.PI * 10 ** 2) * 6;
  assert.ok(Math.abs(m.parts[0].volume - expect) / expect < 0.03, `체적 ${m.parts[0].volume} ≈ ${expect.toFixed(0)}`);
  assert.equal(m.provenance.items.find((i) => /두께/.test(i.what)).source, 'drawing');
});

test('S-3. 벡터 도면도 업로드 즉시 초안: 단일 판재 PDF 는 표제란을 빼고 판재만, DXF 3면도는 결합', async () => {
  const up = await upload(A, proj.id, 'bracket_plate_1to2.pdf', { name: 'auto_bracket.pdf' });
  const j = await waitJob(A, up.data.job.id);
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.autoDraft.status, 'created', JSON.stringify(a.autoDraft));
  const m = (await A.get(`/api/models/${j.result.modelId}`)).data.model;
  assert.deepEqual(m.stats.size.slice(0, 2).map(Math.round), [200, 120], '표제란 제외');
  assert.equal(m.stats.partCount, 1);
  const up2 = await upload(A, proj.id, 'three_view_block.dxf', { name: 'auto_tv.dxf' });
  const j2 = await waitJob(A, up2.data.job.id);
  const m2 = (await A.get(`/api/models/${j2.result.modelId}`)).data.model;
  assert.equal(m2.method, 'views-reconstruct');
  // 타사는 초안 모델에 접근 불가
  assert.equal((await B.get(`/api/models/${m2.id}`)).status, 404);
});

test('S-4. 이미지 위장 파일 차단', async () => {
  const r = await upload(A, proj.id, Buffer.from('this is not a png file'), { name: 'fake.png' });
  assert.equal(r.status, 400);
});
