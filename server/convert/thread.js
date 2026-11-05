// 변환은 별도 스레드에서 실행해 API 응답이 막히지 않도록 한다.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import { convertFile } from './index.js';

parentPort.on('message', async ({ id, ext, path, name }) => {
  try {
    const r = await convertFile({ ext, buf: fs.readFileSync(path), name });
    const glb = r.glb ? Buffer.from(r.glb) : null;
    delete r.glb;
    parentPort.postMessage({ id, ok: true, result: r, glb });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e.message || String(e) });
  }
});
