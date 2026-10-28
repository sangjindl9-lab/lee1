// 저장소: 아티팩트 db(개인 전용 경로) 우선, 없으면 브라우저 저장소
const LS_KEY = 'jeoksan.projects.v1';
let dbRef = null; // { col }

async function connectDb() {
  try {
    if (!window.claude?.use) return null;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return null;
    const id = await user.id();
    if (!id) return null;
    dbRef = { col: db.collection('data/users/' + id) };
    return dbRef;
  } catch { return null; }
}

function lsLoad() {
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function lsSave(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* 저장 불가 환경 */ }
}

export async function loadAll() {
  const r = await connectDb();
  if (r) {
    try {
      const snap = await r.col.get();
      const list = snap.docs.filter((d) => String(d.id).startsWith('proj_')).map((d) => d.data()).filter(Boolean).map((d) => (typeof d.json === 'string' ? JSON.parse(d.json) : d));
      return { mode: 'cloud', list };
    } catch { /* fall through */ }
  }
  return { mode: 'local', list: lsLoad() };
}

export async function saveProject(p, all) {
  lsSave(all);
  if (!dbRef) return 'local';
  try {
    await dbRef.col.doc('proj_' + p.id).set({ json: JSON.stringify(p), name: p.name, updated: p.updated });
    return 'cloud';
  } catch (e) {
    return 'error:' + (e?.code || e?.message || '');
  }
}

export async function deleteProject(id, all) {
  lsSave(all);
  if (!dbRef) return;
  try { await dbRef.col.doc('proj_' + id).delete(); } catch { /* ignore */ }
}

export async function saveFile(filename, data) {
  try {
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) {
      await dl.save({ filename, data });
      return 'ok';
    }
  } catch (e) {
    if (e?.code === 'declined') return 'declined';
    if (e?.code && e.code !== 'unavailable' && e.code !== 'not_granted') return 'error:' + e.code;
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    return 'ok';
  } catch { return 'error'; }
}
