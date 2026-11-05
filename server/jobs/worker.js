import { claim, finish, fail, recoverStale } from './queue.js';
import { processConvert } from './convert-job.js';
import { processRender } from './render.js';

const handlers = { convert: processConvert, render: processRender };
let stopping = false;
const lanes = [];

async function lane(types) {
  while (!stopping) {
    let job;
    try { job = await claim(types); } catch (e) { console.error('[worker] claim', e.message); }
    if (!job) { await new Promise((r) => setTimeout(r, 800)); continue; }
    const t0 = Date.now();
    try {
      const result = await handlers[job.type](job);
      await finish(job, result);
      console.log(`[worker] ${job.type} ${job.id} 완료 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(`[worker] ${job.type} ${job.id} 실패:`, e.message);
      await fail(job, e).catch(() => {});
    }
  }
}

export function startWorker() {
  recoverStale().catch(() => {});
  // 변환과 렌더링을 별도 레인으로 처리 (렌더가 길어도 변환은 계속 진행)
  lanes.push(lane(['convert']), lane(['render']));
  console.log('[worker] 시작');
}
export async function stopWorker() { stopping = true; await Promise.race([Promise.all(lanes), new Promise((r) => setTimeout(r, 3000))]); }
