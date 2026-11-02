// 모바일 오프라인 저장: IndexedDB 대기열에 저장 → 연결되면 자동 전송
// 같은 작업이 두 번 저장되지 않도록 작업마다 고유값(client_ref)을 붙여 보냄 (서버가 중복 확인)
const DB_NAME = 'cable-history-offline';
let dbp = null;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'asset_id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('저장 취소됨'));
  });
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function enqueue(job) {
  const item = { ...job, ref: uuid(), created: new Date().toISOString(), status: '대기', error: null, tries: 0 };
  item.id = await tx('queue', 'readwrite', s => s.add(item));
  notify();
  flush();
  return item;
}
export const listQueue = () => tx('queue', 'readonly', s => s.getAll());
export const removeJob = async (id) => { await tx('queue', 'readwrite', s => s.delete(id)); notify(); };
const putJob = (j) => tx('queue', 'readwrite', s => s.put(j));

export const saveCard = (card) => tx('cards', 'readwrite', s => s.put({ asset_id: card.asset.id, card, saved_at: new Date().toISOString() })).catch(() => {});
export const loadCard = (id) => tx('cards', 'readonly', s => s.get(Number(id)));

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const f of listeners) try { f(); } catch {} }

class NetErr extends Error {}
async function send(method, url, body) {
  let res;
  try { res = await fetch(url, { method, credentials: 'same-origin', ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); }
  catch { throw new NetErr('통신 연결 없음'); }
  if (res.status === 401) throw new NetErr('로그인이 필요합니다 (다시 로그인하면 이어서 전송)');
  if (res.status >= 500) throw new NetErr(`서버 오류 ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 ${res.status}`);
  return data;
}

async function upload(ownerType, ownerId, category, file, ref) {
  const fd = new FormData();
  fd.append('owner_type', ownerType); fd.append('owner_id', ownerId); fd.append('category', category); fd.append('client_ref', ref);
  fd.append('files', file.blob, file.name);
  return send('POST', '/api/files', fd);
}

async function runJob(j) {
  if (j.type === 'worklog') {
    if (!j.done_id) { const r = await send('POST', `/api/assets/${j.asset_id}/worklogs`, { ...j.payload, client_ref: j.ref }); j.done_id = r.id; await putJob(j); }
    for (let i = 0; i < (j.files || []).length; i++) {
      const f = j.files[i]; if (f.sent) continue;
      await upload('worklog', j.done_id, f.category, f, `${j.ref}-f${i}`); f.sent = true; await putJob(j);
    }
  } else if (j.type === 'photo') {
    for (let i = 0; i < j.files.length; i++) {
      const f = j.files[i]; if (f.sent) continue;
      await upload('asset', j.asset_id, f.category, f, `${j.ref}-f${i}`); f.sent = true; await putJob(j);
    }
  } else if (j.type === 'measurement') {
    const r = await send('POST', `/api/assets/${j.asset_id}/measurements`, { ...j.payload, client_ref: j.ref });
    j.result = r.results?.[0]?.auto_result;
  }
}

let flushing = false;
export async function flush() {
  if (flushing) return; flushing = true;
  try {
    const jobs = (await listQueue()).filter(j => j.status !== '실패');
    for (const j of jobs) {
      j.status = '전송 중'; j.tries++; await putJob(j); notify();
      try { await runJob(j); await tx('queue', 'readwrite', s => s.delete(j.id)); lastSent = { at: new Date(), label: j.label, result: j.result }; }
      catch (e) {
        if (e instanceof NetErr) { j.status = '대기'; j.error = e.message; await putJob(j); notify(); break; }
        j.status = '실패'; j.error = e.message; await putJob(j);
      }
      notify();
    }
  } finally { flushing = false; notify(); }
}
export let lastSent = null;
export async function retry(id) { const j = (await listQueue()).find(x => x.id === id); if (j) { j.status = '대기'; j.error = null; await putJob(j); flush(); } }

window.addEventListener('online', () => flush());
setInterval(() => { listQueue().then(q => { if (q.some(j => j.status === '대기')) flush(); }).catch(() => {}); }, 30000);
