// SELFTEST=1: 수자원공사 용역·낙찰결과 점검
export async function selfTest(base) {
  for (const kind of ['servc', 'rst']) {
    try {
      const d = await fetch(`${base}/api/kwater/${kind}?numOfRows=3000&raw=1`).then((r) => r.json());
      if (d.error) { console.log(`[SELFTEST] kwater ${kind} ERROR ${d.error}`); continue; }
      const items = d.items || [];
      console.log(`[SELFTEST] kwater ${kind} total=${d.totalCount}`);
      if (kind === 'servc') items.slice(0, 2).forEach((r) => console.log(`[SELFTEST]   ${r.bidNtceNm} | ${r.method} | ${r.status} | ${r.ntceDt}`));
      if (kind === 'rst') {
        const by = {}; for (const r of items) by[r.status] = (by[r.status] || 0) + 1;
        const withW = items.filter((r) => r.winnerNm);
        console.log(`[SELFTEST]   상태별 ${JSON.stringify(by)} 업체명있음=${withW.length}`);
        withW.slice(0, 3).forEach((r) => console.log(`[SELFTEST]   ${r.status} ${r.bidNtceNm} | ${r.winnerNm} ${r.winnerAmt} | raw ${JSON.stringify(r.raw)}`));
        const elec = items.filter((r) => /전기|통신/.test(r.bidNtceNm));
        console.log(`[SELFTEST]   전기·통신 ${elec.length}건: ${elec.slice(0, 5).map((r) => `${r.bidNtceNm}/${r.status}/${r.winnerNm}`).join(' | ')}`);
      }
    } catch (e) { console.log(`[SELFTEST] kwater ${kind} EXC ${e.message}`); }
  }
}
