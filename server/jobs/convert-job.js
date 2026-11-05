import { tenant, audit } from '../db/index.js';
import * as storage from '../storage.js';
import { runConvert } from '../convert/pool.js';
import { progress } from './queue.js';
import { defaultScene } from '../../shared/scene.js';

export async function createModel(c, { file, result, glb, name }) {
  const { rows: [m] } = await c.query(
    `INSERT INTO models (company_id,project_id,source_file_id,source_file_version,name,method,parts,stats,provenance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [file.company_id, file.project_id, file.id, file.version, name, result.method,
      JSON.stringify(result.parts), result.stats, result.provenance]);
  const key = storage.keyFor(file.company_id, 'models', `${m.id}.glb`);
  await storage.put(file.company_id, key, glb);
  await c.query('UPDATE models SET glb_key=$2 WHERE id=$1', [m.id, key]);
  await c.query('INSERT INTO scenes (company_id,model_id,version,data) VALUES ($1,$2,1,$3)',
    [file.company_id, m.id, defaultScene(result.parts, name)]);
  return { ...m, glb_key: key };
}

/** 2D 도면(PDF) 미리보기 이미지 위치 */
export const previewKey = (f) => storage.keyFor(f.company_id, 'previews', `${f.id}.png`);

export async function processConvert(job) {
  const { fileId } = job.payload;
  const file = await tenant(job.company_id, async (c) => {
    const { rows } = await c.query("UPDATE files SET status='analyzing' WHERE id=$1 RETURNING *", [fileId]);
    return rows[0];
  });
  if (!file) throw new Error('파일을 찾을 수 없습니다');
  await progress(job, 0.1, '형식 분석·변환 중');
  const name = file.original_name.replace(/\.[^.]+$/, '');
  let out;
  try {
    out = await runConvert({ ext: file.ext, path: storage.pathOf(file.company_id, file.storage_key), name });
  } catch (e) {
    await tenant(job.company_id, (c) => c.query("UPDATE files SET status='failed', error=$2 WHERE id=$1", [file.id, e.message]));
    throw e;
  }
  await progress(job, 0.8, '저장 중');
  const { result, glb, preview } = out;
  if (preview) await storage.put(file.company_id, previewKey(file), preview);
  return tenant(job.company_id, async (c) => {
    if (result.analysisOnly) {
      await c.query("UPDATE files SET status='analyzed', analysis=$2, error=NULL WHERE id=$1", [file.id, result.analysis]);
      return { fileId: file.id, analysisOnly: true };
    }
    const m = await createModel(c, { file, result, glb, name });
    await c.query("UPDATE files SET status='converted', analysis=$2, error=NULL WHERE id=$1", [file.id, result.analysis]);
    await audit(c, { companyId: file.company_id, userId: job.created_by, action: 'model.create', target: m.id, meta: { fileId: file.id, method: result.method } });
    return { fileId: file.id, modelId: m.id };
  });
}
