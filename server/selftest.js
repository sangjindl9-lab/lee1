// SELFTEST=1: 국가철도공단 개찰·낙찰 읽기 점검
export async function selfTest(base) {
  for (const type of ['award', 'openg']) {
    const t = Date.now();
    try {
      const d = await fetch(`${base}/api/krbid/${type}?numOfRows=5`).then((r) => r.json());
      console.log(`[SELFTEST] krbid ${type} → ${d.error ? `ERROR ${d.error}` : `total=${d.totalCount} (${d.from}~${d.to})`} ${Date.now() - t}ms`);
      for (const r of d.items || []) console.log(`[SELFTEST]   ${r.bidNtceNo} ${r.status} | ${r.bidNtceNm.slice(0, 40)} | ${r.winnerNm} ${r.winnerBizno} ${r.winnerAmt} ${r.winnerRate} | 하한${r.lowerRate} 예가${r.plnprc} 참가${r.bidderCount} ${r.detailError}`);
    } catch (e) { console.log(`[SELFTEST] krbid ${type} EXC ${e.message}`); }
  }
  const d = await fetch(`${base}/api/krbid/award?q=${encodeURIComponent('전기')}&from=2026-09-23&to=2026-10-23&numOfRows=3`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  console.log(`[SELFTEST] krbid award 1개월 '전기' → ${d.error || `total=${d.totalCount}`} :: ${(d.items || []).map((r) => `${r.bidNtceNm.slice(0, 30)}/${r.winnerNm}`).join(' | ')}`);
}
