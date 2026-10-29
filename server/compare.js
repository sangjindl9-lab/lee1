// 임시: 타사 비교 2차 — 수자원공사 낙찰결과 원본, 방위사업청 수의 건 확인 [CMP]
export async function compare(base) {
  const d = await fetch(`${base}/api/kwater/rst?from=2026-09-29&to=2026-10-29&raw=1&numOfRows=3000`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  console.log(`[CMP] kwater rst → ${d.error || d.totalCount}`);
  for (const r of (d.items || []).filter((x) => /B3202603576|B3202603600/.test(x.bidNtceNo))) console.log(`[CMP]   ${r.bidNtceNo} ${r.bidNtceNm} | ${JSON.stringify(r.raw).slice(0, 1200)}`);
  const a = await fetch(`${base}/api/award/Cnstwk?inqryDiv=2&inqryBgnDt=202609290000&inqryEndDt=202610292359&numOfRows=3000&pageNo=1&indstrytyNm=${encodeURIComponent('정보통신공사')}&prtcptLmtRgnCd=51`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  console.log(`[CMP] 공사 강원51(수정 후) → ${a.error || `${a.totalCount}건 ${JSON.stringify(a.orgCounts)}`}`);
  for (const r of (a.items || []).filter((x) => x._org !== 'g2b')) console.log(`[CMP]   ${r._org} ${r.bidNtceNo} ${r.bidNtceNm} | ${r.bidwinnrNm} ${r.sucsfbidAmt}`);
}
