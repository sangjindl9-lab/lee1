// 실시간 상태 감시: 서버가 주기적으로 TCP 연결·HTTP 응답을 확인하거나, 외부 시스템이 상태를 보내옴(push)
// 결과는 '등록 상태(설계·사용 중 등)'와 별도로 저장하며, 확인 시각과 함께 표시합니다.
const net = require('net');
const { db } = require('../db');

const now = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().replace('T', ' ').slice(0, 19); };

function tcpCheck(host, port, timeout) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const s = net.connect({ host, port, timeout });
    const done = (ok, msg) => { s.destroy(); resolve({ ok, latency: Date.now() - t0, message: msg }); };
    s.on('connect', () => done(true, `TCP ${port} 연결됨`));
    s.on('timeout', () => done(false, `TCP ${port} 시간 초과(${timeout}ms)`));
    s.on('error', e => done(false, `TCP ${port} 연결 실패: ${e.code || e.message}`));
  });
}

async function httpCheck(host, port, pathName, timeout) {
  const t0 = Date.now();
  const proto = port === 443 ? 'https' : 'http';
  const url = `${proto}://${host}${port && ![80, 443].includes(port) ? ':' + port : ''}${pathName || '/'}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    // 응답이 오면 장비가 살아 있는 것으로 봄 (인증 요구 401 포함). 5xx 는 이상
    const ok = r.status < 500;
    return { ok, latency: Date.now() - t0, message: `HTTP ${r.status}`, degraded: !ok };
  } catch (e) {
    return { ok: false, latency: Date.now() - t0, message: `HTTP 실패: ${e.name === 'TimeoutError' ? '시간 초과' : (e.cause?.code || e.message)}` };
  }
}

function setStatus(m, status, { latency = null, message = null, source = 'poll', ok = false } = {}) {
  const t = now();
  const changed = status !== m.status;
  db.prepare(`UPDATE monitors SET status=?, last_checked_at=?, last_latency_ms=?, last_message=?, ${ok ? 'last_ok_at=?,' : ''} ${changed ? 'last_change_at=?,' : ''} consecutive_fail=? WHERE id=?`)
    .run(...[status, t, latency, message, ...(ok ? [t] : []), ...(changed ? [t] : []), ok ? 0 : (m.consecutive_fail || 0) + 1, m.id]);
  if (changed) db.prepare('INSERT INTO monitor_events(monitor_id, from_status, to_status, latency_ms, message, source) VALUES (?,?,?,?,?,?)').run(m.id, m.status, status, latency, message, source);
}

async function checkOne(m) {
  if (m.method === 'push') {
    // 외부 시스템이 정해진 시간 안에 보고하지 않으면 '응답 없음'
    if (m.last_ok_at || m.last_checked_at) {
      const last = new Date((m.last_checked_at || m.last_ok_at).replace(' ', 'T'));
      const ageSec = (Date.now() - new Date().getTimezoneOffset() * 60000 - last.getTime()) / 1000;
      if (ageSec > m.push_stale_sec && m.status !== '응답 없음') setStatus(m, '응답 없음', { message: `${Math.round(ageSec)}초 동안 보고 없음`, source: 'poll' });
    }
    return;
  }
  if (!m.host) return;
  const r = m.method === 'tcp' ? await tcpCheck(m.host, m.port || 80, m.timeout_ms) : await httpCheck(m.host, m.port || 80, m.path, m.timeout_ms);
  const fails = r.ok ? 0 : (m.consecutive_fail || 0) + 1;
  const status = r.ok ? (r.degraded ? '이상' : '정상') : (fails >= m.fail_threshold ? '응답 없음' : (m.status === '확인 전' ? '확인 전' : m.status));
  setStatus(m, status, { latency: r.latency, message: r.message, ok: r.ok });
  return { ...r, status };
}

let timer = null; let running = false;
function start() {
  if (timer || process.env.MONITOR_DISABLED === 'true') return;
  timer = setInterval(async () => {
    if (running) return; running = true;
    try {
      const due = db.prepare(`SELECT m.* FROM monitors m JOIN assets a ON a.id=m.asset_id WHERE m.enabled=1 AND a.retired=0
        AND (m.last_checked_at IS NULL OR m.method='push' OR (julianday('now','localtime') - julianday(m.last_checked_at)) * 86400 >= m.interval_sec)`).all();
      for (let i = 0; i < due.length; i += 20) await Promise.all(due.slice(i, i + 20).map(m => checkOne(m).catch(() => {})));
    } finally { running = false; }
  }, 5000);
  timer.unref();
}

function normalizeStatus(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['정상', 'ok', 'up', 'online', 'normal', '1', 'true'].includes(s)) return '정상';
  if (['응답 없음', 'down', 'offline', 'timeout', '0', 'false'].includes(s)) return '응답 없음';
  if (['이상', 'fail', 'fault', 'alarm', 'error', 'warning', 'degraded'].includes(s)) return '이상';
  return null;
}

module.exports = { start, checkOne, setStatus, normalizeStatus, now };
