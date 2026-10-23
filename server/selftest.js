// SELFTEST=1: 업체명 스트리밍 검색 — 첫 결과까지 걸리는 시간
export async function selfTest(base) {
  for (const q of ['에스에스전력', '한빛전기', '서화통신']) {
    const t = Date.now(); let first = 0; let n = 0; let end = null;
    try {
      const res = await fetch(`${base}/api/corps/stream?q=${encodeURIComponent(q)}`);
      const text = await new Promise(async (resolve) => {
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop();
          for (const l of lines) { if (!l) continue; const m = JSON.parse(l); if (m.type === 'rows' && m.items.length && !first) first = Date.now() - t; if (m.type === 'rows') n += m.items.length; if (m.type === 'end') end = m; }
        }
        resolve();
      });
      console.log(`[SELFTEST] stream '${q}' 첫결과 ${first}ms, 전체 ${Date.now() - t}ms, ${n}곳 partial=${end?.partial}`);
    } catch (e) { console.log(`[SELFTEST] stream '${q}' EXC ${e.message}`); }
  }
}
