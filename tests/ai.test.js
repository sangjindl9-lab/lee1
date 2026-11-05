// AI 도면 해석: 모의 Anthropic 서버로 요청 형식·부품 조립·허용 설정·한도·실패 시 규칙 기반 대체를 검증
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, stopServer, signup, upload, waitJob, newProject } from './helpers.js';

const SPEC = { product: '매입형 분전함', overall: [340, 115, 250], views: '정면·저면·우측면', ignored: ['구성도'], assumptions: ['몸체 벽 두께 1.6 추정'],
  parts: [
    { name: '커버', shape: 'box', position: [0, 0, 0], size: [340, 15, 250], cornerRadius: 12, material: 'painted', holes: [{ shape: 'rect', axis: 'y', center: [170, 7, 125], width: 300, height: 200 }], explode: 'front', explodeStep: 1, sourceDims: [340, 250, 15] },
    { name: '몸체', shape: 'shell', position: [15, 15, 15], size: [310, 100, 220], wall: 1.6, open: 'front', material: 'steel', holes: [{ axis: 'z', diameter: 27, center: [60, 50, 0] }], explode: 'none' },
    { name: '고정 볼트', shape: 'cylinder', position: [30, 0, 30], diameter: 6, length: 20, axis: 'y', material: 'stainless', explode: 'front', explodeStep: 2 },
  ] };
let mock, calls = [], failNext = false, A, B, proj;
before(async () => {
  mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const body = JSON.parse(b); calls.push({ headers: req.headers, body });
      if (failNext) { failNext = false; res.writeHead(529, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'overloaded' } })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: body.model, content: [{ type: 'tool_use', id: 't1', name: 'build_showroom_model', input: SPEC }], usage: { input_tokens: 3210, output_tokens: 1450 } }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  await startServer(); A = await signup('AI-A'); B = await signup('AI-B'); proj = await newProject(A, 'AI 도면', 'electric');
});
after(async () => { await stopServer(); mock.close(); delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL; });

test('AI-1. 허용 전: 업로드는 규칙 기반 초안, AI 요청 거부, 외부 전송 없음', async () => {
  const up = await upload(A, proj.id, 'three_view_block.dxf');
  const j = await waitJob(A, up.data.job.id);
  assert.equal((await A.get(`/api/models/${j.result.modelId}`)).data.model.method, 'views-reconstruct');
  const st = (await A.get('/api/ai/status')).data;
  assert.deepEqual([st.allowed, st.key, st.ok], [false, true, false]);
  const r = await A.post(`/api/files/${up.data.file.id}/ai-draft`);
  assert.equal(r.status, 400); assert.match(r.data.error, /AI 도면 해석/);
  assert.equal(calls.length, 0, '허용 전에는 도면을 외부로 보내지 않음');
});

test('AI-2. 허용 → AI 로 부품별 3D (커버·몸체·볼트, 분해 방향) + 요청 형식·사용량 기록', async () => {
  assert.equal((await A.put('/api/company', { externalAi: true })).data.external_ai_allowed, true);
  const up = await upload(A, proj.id, 'three_view_block.dxf', { name: 'panel.dxf' });
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  assert.equal(j.result.aiDraft, true, '업로드 즉시 AI 해석');
  const call = calls.at(-1);
  assert.equal(call.headers['x-api-key'], 'sk-test');
  assert.equal(call.body.tools[0].name, 'build_showroom_model');
  const content = call.body.messages[0].content;
  const imgs = content.filter((c) => c.type === 'image');
  assert.equal(imgs.length, 2, '도면 그림 + 윤곽 번호 그림');
  assert.equal(Buffer.from(imgs[0].source.data, 'base64').subarray(1, 4).toString(), 'PNG', 'DXF 를 그림으로 그려 보냄');
  const txt = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  assert.match(txt, /V1S1 전체 실루엣/, '윤곽 목록을 보냄');
  const d = (await A.get(`/api/models/${j.result.modelId}`)).data;
  assert.equal(d.model.method, 'ai-drawing');
  assert.equal(d.model.review_status, 'pending');
  assert.equal(d.model.provenance.reference, true);
  assert.deepEqual(d.model.parts.map((p) => p.name), ['커버', '몸체', '고정 볼트']);
  assert.deepEqual(d.model.stats.size.map(Math.round), [340, 115, 250]);
  const body = d.model.parts.find((p) => p.name === '몸체');
  assert.ok(body.volume < 310 * 100 * 220 * 0.2, '속이 빈 외함');
  const cover = d.model.parts.find((p) => p.name === '커버');
  assert.deepEqual(d.scene.data.parts[cover.id].explode.dir, [0, -1, 0], 'AI 가 정한 분해 방향(앞)');
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.aiDraft.product, '매입형 분전함'); assert.equal(a.aiDraft.usage.input_tokens, 3210);
  assert.equal((await A.get('/api/ai/status')).data.used, 1);
  // 다시 만들기 버튼
  const again = await A.post(`/api/files/${up.data.file.id}/ai-draft`);
  assert.equal(again.status, 201, JSON.stringify(again.data));
  assert.equal((await A.get('/api/ai/status')).data.used, 2);
  // 타사: 허용 안 됨·접근 불가
  assert.equal((await B.post(`/api/files/${up.data.file.id}/ai-draft`)).status, 404);
  assert.equal((await B.get('/api/ai/status')).data.allowed, false);
});

test('AI-4. 도면 윤곽 기반 부품(intersect·extrude): 3면도 외형을 교차해 정답 체적과 비교', async () => {
  // 3면도 블록: 정면(V?)+평면+측면 외형 교차 = 계단 블록 185,717 mm³ (구멍 제외 시 +구멍 체적)
  const up0 = await upload(A, proj.id, 'three_view_block.dxf', { name: 'probe.dxf' });
  await waitJob(A, up0.data.job.id);
  const a = (await A.get(`/api/files/${up0.data.file.id}`)).data.analysis;
  const g = a.groups.find((x) => x.side);
  const F = a.views.find((v) => v.id === g.front);
  // 정면 외형 중 계단 블록(큰 것) 실루엣 번호
  const si = F.silhouettes.findIndex((s) => Math.max(...s.pts.map((p) => p[0])) - Math.min(...s.pts.map((p) => p[0])) > 90) + 1;
  const T = a.views.find((v) => v.id === g.top), S = a.views.find((v) => v.id === g.side);
  const ti = T.silhouettes.findIndex((s) => Math.max(...s.pts.map((p) => p[0])) - Math.min(...s.pts.map((p) => p[0])) > 90) + 1;
  const old = [...SPEC.parts];
  SPEC.viewRoles = { [g.front]: 'front', [g.top]: g.topPos === 'below' ? 'bottom' : 'top', [g.side]: g.sidePos === 'left' ? 'left' : 'right' };
  SPEC.drawingScale = 1;
  SPEC.parts = [
    { name: '계단 블록', shape: 'intersect', profiles: [`${g.front}S${si}`, `${g.top}S${ti}`, `${g.side}S1`], material: 'steel', explode: 'none' },
    { name: '밑판', shape: 'extrude', profiles: [`${g.top}S${ti}`], from: 0, to: 5, material: 'steel', explode: 'down' },
  ];
  try {
    const r = await A.post(`/api/files/${up0.data.file.id}/ai-draft`);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const m = (await A.get(`/api/models/${r.data.modelId}`)).data.model;
    const blk = m.parts.find((p) => p.name === '계단 블록'), base = m.parts.find((p) => p.name === '밑판');
    assert.deepEqual(blk.bbox.max.map((v, i) => Math.round(v - blk.bbox.min[i])), [100, 60, 50], '외형 교차 크기 = 도면');
    const expect = 185717 + Math.PI * 100 * 20; // 실루엣 교차는 관통 구멍을 모름
    assert.ok(Math.abs(blk.volume - expect) / expect < 0.01, `교차 체적 ${blk.volume} ≈ ${expect.toFixed(0)}`);
    assert.deepEqual(base.bbox.max.map((v, i) => Math.round(v - base.bbox.min[i])), [100, 60, 5], '윤곽 돌출 두께 5');
    assert.ok(m.parts.every((p) => p.extras?.profiles?.length), '부품마다 사용한 윤곽 기록');
  } finally { SPEC.parts = old; delete SPEC.viewRoles; }
});

test('AI-3. AI 실패(서버 과부하) → 규칙 기반 초안으로 대체, 실패 사유 기록', async () => {
  failNext = true;
  const up = await upload(A, proj.id, 'three_view_block.dxf', { name: 'fail.dxf' });
  const j = await waitJob(A, up.data.job.id);
  assert.equal(j.status, 'done', j.error);
  assert.equal((await A.get(`/api/models/${j.result.modelId}`)).data.model.method, 'views-reconstruct');
  const a = (await A.get(`/api/files/${up.data.file.id}`)).data.analysis;
  assert.equal(a.aiDraft.status, 'failed'); assert.match(a.aiDraft.reason, /529/);
});
