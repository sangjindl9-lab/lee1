// SELFTEST=1: 방위사업청 시설공사 입찰결과 파일 점검
export async function selfTest(base) {
  let t = Date.now();
  const d = await fetch(`${base}/api/ext/d2bfac?numOfRows=3&from=2025-01-01&to=2025-12-31`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  console.log(`[SELFTEST] d2bfac 2025 → ${d.error || `${d.totalCount}/${d.all}건 file=${d.file}`} ${Date.now() - t}ms`);
  (d.items || []).forEach((r) => console.log(`[SELFTEST]   ${r.opengDt} ${r.bidNtceNm} | ${r.winnerNm} ${r.winnerBizno} ${r.winnerCeo} | 낙찰율 ${r.rate} 예가 ${r.plnprc}`));
  t = Date.now();
  const a = await fetch(`${base}/api/award/Cnstwk?inqryDiv=2&inqryBgnDt=202511010000&inqryEndDt=202511072359&numOfRows=500&pageNo=1&bidNtceNm=${encodeURIComponent('전기')}`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  const mine = (a.items || []).filter((r) => r._org === 'd2b');
  console.log(`[SELFTEST] award 2025-11 첫주 '전기' → ${a.error || `total=${a.totalCount} orgs=${JSON.stringify(a.orgCounts)}`} ${Date.now() - t}ms`);
  mine.slice(0, 3).forEach((r) => console.log(`[SELFTEST]   d2b ${r.bidNtceNm} | ${r.bidwinnrNm} ${r.bidwinnrBizno} | ${r.sucsfbidAmt} (${r.sucsfbidRate}%)`));
  const bz = (d.items || []).find((r) => r.winnerBizno)?.winnerBizno;
  if (bz) {
    t = Date.now();
    const c = await fetch(`${base}/api/corps/${bz}/detail`).then((r) => r.json()).catch((e) => ({ error: e.message }));
    console.log(`[SELFTEST] corp ${bz} → ${c.error || `${c.basic?.name} 낙찰이력 ${c.awards?.length}건 (군 ${c.d2bCount})`} ${Date.now() - t}ms`);
  }
}
