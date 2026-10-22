// SELFTEST=1: 철도기관 파일데이터 API 점검
export async function selfTest(base) {
  for (const src of ['kr', 'korail']) {
    for (const q of ['', '전기', '통신']) {
      const t = Date.now();
      try {
        const d = await fetch(`${base}/api/ext/${src}?q=${encodeURIComponent(q)}&numOfRows=3`).then((r) => r.json());
        console.log(`[SELFTEST] ${src} q=${q || '(전체)'} → ${d.error ? `ERROR ${d.error}` : `${d.totalCount}/${d.all}건 file=${d.file} latest=${d.latest}`} (${Date.now() - t}ms) :: ${JSON.stringify(d.items?.[0] || {}).slice(0, 400)}`);
      } catch (e) { console.log(`[SELFTEST] ${src} EXC ${e.message}`); }
    }
  }
}
