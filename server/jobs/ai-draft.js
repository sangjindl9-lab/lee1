// AI 도면 해석 3D 초안: 도면 그림 준비 → Claude 해석 → 부품 조립 → 모델 저장 (사용량 기록)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as storage from '../storage.js';
import { audit } from '../db/index.js';
import { interpretDrawing, buildFromSpec, explodeFromSpec, aiAvailable } from '../convert/ai.js';
import { IMAGE_EXTS } from '../convert/index.js';
import { createModel, previewKey } from './convert-job.js';

const run = promisify(execFile);
export const AI_MONTHLY_DEFAULT = 300;

/** 이 회사가 AI 해석을 쓸 수 있는지 (허용 설정 + 서버 키 + 월 한도) */
export async function aiStatus(c, companyId) {
  const { rows: [co] } = await c.query('SELECT external_ai_allowed, limits FROM companies WHERE id=$1', [companyId]);
  const limit = Number(co?.limits?.ai_drawings ?? AI_MONTHLY_DEFAULT);
  const { rows: [u] } = await c.query("SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='model.aidraft' AND at >= date_trunc('month', now())", [companyId]);
  return { allowed: !!co?.external_ai_allowed, key: aiAvailable(), used: u.n, limit, ok: !!co?.external_ai_allowed && aiAvailable() && u.n < limit };
}

/** AI 에 보낼 도면 그림 (긴 변 1568px PNG) */
async function drawingImage(file) {
  const src = storage.pathOf(file.company_id, file.storage_key);
  if (['dxf', 'dwg'].includes(file.ext)) {
    return storage.read(file.company_id, previewKey(file)).catch(() => { throw Object.assign(new Error('도면 그림이 없습니다. 다시 분석한 뒤 시도하세요'), { status: 400 }); });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eum3d-ai-'));
  try {
    const out = path.join(dir, 'p.png');
    if (file.ext === 'pdf') await run('pdftoppm', ['-png', '-scale-to', '1568', '-f', '1', '-l', '1', '-singlefile', src, path.join(dir, 'p')], { timeout: 120000 });
    else if (IMAGE_EXTS.includes(file.ext)) await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),min(1568,iw),-2)':'if(gt(iw,ih),-2,min(1568,ih))'", out], { timeout: 120000 });
    else throw Object.assign(new Error('2D 도면만 AI 해석할 수 있습니다'), { status: 400 });
    return await fs.readFile(out);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

/**
 * @param c   회사 범위 DB 연결 (tenant)
 * @param file files 행 (analysis 포함)
 */
export async function aiDraftFile(c, file, { userId } = {}) {
  const st = await aiStatus(c, file.company_id);
  if (!st.allowed) throw Object.assign(new Error('관리자가 [브랜드·쇼룸] 설정에서 "AI 도면 해석"을 켜야 사용할 수 있습니다'), { status: 400 });
  if (!st.key) throw Object.assign(new Error('서버에 AI 키(ANTHROPIC_API_KEY)가 설정되어 있지 않습니다'), { status: 400 });
  if (st.used >= st.limit) throw Object.assign(new Error(`이번 달 AI 도면 해석 한도(${st.limit}장)를 모두 썼습니다`), { status: 429 });
  const image = await drawingImage(file);
  const { spec, usage } = await interpretDrawing({ image, analysis: file.analysis, fileName: file.original_name });
  const base = file.original_name.replace(/\.[^.]+$/, '');
  const result = await buildFromSpec(spec, base);
  const m = await createModel(c, { file, result, glb: Buffer.from(result.glb), name: `${base} (AI 3D)` });
  await c.query("UPDATE models SET review_status='pending' WHERE id=$1", [m.id]);
  // AI 가 정한 분해 방향을 장면에 반영
  const ex = explodeFromSpec(result.parts, result.stats.size || [1, 1, 1]);
  const { rows: [sc] } = await c.query('SELECT data FROM scenes WHERE model_id=$1 AND version=1', [m.id]);
  if (sc) {
    for (const [id, e] of Object.entries(ex)) sc.data.parts[id] = { ...(sc.data.parts[id] || {}), explode: e };
    await c.query('UPDATE scenes SET data=$2 WHERE model_id=$1 AND version=1', [m.id, sc.data]);
  }
  const aiInfo = { status: 'created', modelId: m.id, product: spec.product, overall: spec.overall, parts: result.parts.length, ignored: spec.ignored || [], assumptions: spec.assumptions || [], usage, at: new Date().toISOString() };
  await c.query("UPDATE files SET status='converted', analysis = jsonb_set(coalesce(analysis,'{}'::jsonb), '{aiDraft}', $2::jsonb) WHERE id=$1", [file.id, JSON.stringify(aiInfo)]);
  await audit(c, { companyId: file.company_id, userId, action: 'model.aidraft', target: m.id,
    meta: { fileId: file.id, product: spec.product, parts: result.parts.length, model: usage.model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, ms: usage.ms } });
  return { modelId: m.id, spec, usage, stats: result.stats };
}
