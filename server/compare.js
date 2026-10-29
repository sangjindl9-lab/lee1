// 임시: 타사 비교(강원·전기공사·10/23~10/29, 33건) — [CMP]
export async function compare(base) {
  const url = `${base}/api/award/Cnstwk?inqryDiv=2&inqryBgnDt=202610230000&inqryEndDt=202610292359&numOfRows=3000&pageNo=1&indstrytyNm=${encodeURIComponent('전기공사')}&prtcptLmtRgnCd=51`;
  for (const round of [1, 2]) {
    const a = await fetch(url).then((r) => r.json()).catch((e) => ({ error: e.message }));
    console.log(`[CMP] ${round}차 → ${a.error || `${a.totalCount}건 ${JSON.stringify(a.orgCounts)}`}`);
    for (const r of (a.items || []).filter((x) => x._org !== 'g2b')) console.log(`[CMP]   ${r._org} ${r.bidNtceNo} ${r.bidNtceNm} | ${r.dminsttNm} | ${r.bidwinnrNm} ${r.bidwinnrBizno} ${r.sucsfbidAmt} ${r.awardStatus}`);
    await new Promise((r) => setTimeout(r, 60000));
  }
}
