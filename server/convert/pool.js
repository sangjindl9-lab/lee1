import { Worker } from 'node:worker_threads';

let w, seq = 0;
const waiting = new Map();
function worker() {
  if (w) return w;
  w = new Worker(new URL('./thread.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 3072 } });
  w.on('message', (m) => { const p = waiting.get(m.id); waiting.delete(m.id); m.ok ? p.resolve(m) : p.reject(new Error(m.error)); });
  w.on('error', (e) => { for (const p of waiting.values()) p.reject(e); waiting.clear(); w = null; });
  w.on('exit', () => { w = null; });
  w.unref();
  return w;
}
/** @returns {Promise<{result:any, glb:Buffer|null}>} */
export function runConvert(args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker().postMessage({ id, ...args });
  });
}
export const stopConvert = () => w?.terminate();
