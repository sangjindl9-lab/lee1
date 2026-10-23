// SELFTEST=1: 한국수자원공사 API 명세(openapi.json) 파라미터 확인
const one = (s) => s.replace(/\s+/g, ' ');
export async function selfTest() {
  for (const u of ['https://www.data.go.kr/catalog/15101635/openapi.json', 'https://www.data.go.kr/catalog/15101620/openapi.json']) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      let spec; try { spec = JSON.parse(t); } catch { console.log(`[KWSPEC] ${u} ${r.status} not json ${one(t).slice(0, 300)}`); continue; }
      console.log(`[KWSPEC] ${u} host=${spec.host || spec.servers?.[0]?.url} base=${spec.basePath || ''}`);
      for (const [p, v] of Object.entries(spec.paths || {})) {
        const op = v.get || v.post || {};
        const params = (op.parameters || []).map((x) => `${x.name}${x.required ? '*' : ''}(${one(x.description || '').slice(0, 60)})`).join(', ');
        console.log(`[KWSPEC] ${p} ${op.summary || ''} :: ${params}`);
        const schema = JSON.stringify(op.responses?.['200'] || {}).slice(0, 1500);
        console.log(`[KWSPEC] ${p} resp ${schema}`);
      }
      const defs = spec.definitions || spec.components?.schemas || {};
      for (const [n, d] of Object.entries(defs)) console.log(`[KWSPEC] def ${n} :: ${Object.entries(d.properties || {}).map(([k, x]) => `${k}(${one(x.description || '').slice(0, 30)})`).join(', ').slice(0, 2500)}`);
    } catch (e) { console.log(`[KWSPEC] ${u} EXC ${e.message}`); }
  }
}
