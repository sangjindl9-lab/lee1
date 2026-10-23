// SELFTEST=1: 한국수자원공사 연동 점검 (각 구분 건수 + 원본 필드 샘플)
export async function selfTest(base) {
  for (const kind of ['cntrwk', 'servc', 'gds', 'dmscpt', 'rst']) {
    const t = Date.now();
    try {
      const d = await fetch(`${base}/api/kwater/${kind}?numOfRows=2&raw=1`).then((r) => r.json());
      console.log(`[SELFTEST] kwater ${kind} → ${d.error ? `ERROR ${d.error}` : `total=${d.totalCount} (${d.from}~${d.to})`} ${Date.now() - t}ms`);
      for (const r of d.items || []) {
        const { raw, ...rest } = r;
        console.log(`[SELFTEST]   ${JSON.stringify(rest).slice(0, 500)}`);
        console.log(`[SELFTEST]   raw ${JSON.stringify(raw).slice(0, 1200)}`);
      }
    } catch (e) { console.log(`[SELFTEST] kwater ${kind} EXC ${e.message}`); }
  }
}
