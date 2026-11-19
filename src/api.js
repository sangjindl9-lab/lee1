import { startDemo } from './demo.js';

export const DEMO = import.meta.env.MODE === 'demo';

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장소를 못 쓰는 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

function getToken() {
  let t = store.get('eum_token');
  if (!t) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    t = Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
    store.set('eum_token', t);
  }
  return t;
}

// onMsg: 서버가 보낸 메시지, onStatus: 연결 상태(true/false)
export function connect(onMsg, onStatus) {
  const token = getToken();
  if (DEMO) {
    const core = startDemo();
    const s = core.connect((m) => setTimeout(() => onMsg(JSON.parse(JSON.stringify(m))), 0), { ip: '체험판', ua: navigator.userAgent });
    s.recv({ t: 'hello', token });
    onStatus(true);
    return { send: (m) => s.recv(m.t === 'hello' ? { ...m, token } : m), reset: () => { store.del('eum_token'); store.del('eum_demo_db'); } };
  }
  let ws; let closed = false; let retry = 0;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; onStatus(true); ws.send(JSON.stringify({ t: 'hello', token })); };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* 무시 */ } };
    ws.onclose = () => { onStatus(false); if (!closed) setTimeout(open, Math.min(8000, 800 * 2 ** retry++)); };
  };
  open();
  return {
    send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m.t === 'hello' ? { ...m, token } : m)); },
    reset: () => { closed = true; store.del('eum_token'); ws.close(); },
  };
}
