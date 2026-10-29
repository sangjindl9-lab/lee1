// 임시: 타사 결과(강원·정보통신공사·결과발표일 2026-09-29~10-29, 45건)와 비교 — [CMP] 로그
const REF = ['R26BK01785207', 'R26BK01786594', 'R26BK01792111', 'R26BK01780240', 'R26BK01785614', 'R26BK01787230', 'E012606966',
  'R26BK01781830', 'R26BK01779049', 'R26BK01778032', 'R26BK01777656', 'R26BK01771906', 'R26BK01774252', 'R26BK01769114', 'B3202603576',
  'LHM02322026-16218', 'R26BK01767617', 'R26BK01764143', 'R26BK01765596', 'B3202603600'];
export async function compare(base) {
  const q = (kind, rgn, ind = '정보통신공사') => `/api/award/${kind}?inqryDiv=2&inqryBgnDt=202609290000&inqryEndDt=202610292359&numOfRows=3000&pageNo=1`
    + (ind ? `&indstrytyNm=${encodeURIComponent(ind)}` : '') + (rgn ? `&prtcptLmtRgnCd=${rgn}` : '');
  const runs = [['공사 강원51', q('Cnstwk', '51')], ['공사 강원42', q('Cnstwk', '42')], ['공사 지역없음', q('Cnstwk', '')], ['물품 강원51', q('Thng', '51')], ['물품 지역없음', q('Thng', '')]];
  const seen = {};
  for (const [lab, path] of runs) {
    const t = Date.now();
    const d = await fetch(base + path, { signal: AbortSignal.timeout(300000) }).then((r) => r.json()).catch((e) => ({ error: e.message }));
    const items = d.items || [];
    console.log(`[CMP] ${lab} → ${d.error || `${d.totalCount}건 ${JSON.stringify(d.orgCounts)} truncated=${d.truncated}`} ${Date.now() - t}ms`);
    for (const r of items) {
      const hit = REF.find((x) => String(r.bidNtceNo).startsWith(x) || x.startsWith(String(r.bidNtceNo)) && r.bidNtceNo);
      if (hit && !seen[hit]) seen[hit] = `${lab} | ${r._org} ${r.bidNtceNo}-${r.bidNtceOrd} | ${r.bidwinnrNm} | 낙찰 ${r.sucsfbidAmt} (${r.sucsfbidRate}%) 예가 ${r.plnprc || r._plnprc || ''} 기초 ${r.bssamt || r._basic || r.presmptPrce || ''} 참여 ${r.prtcptCnum} 개찰 ${r.opengDt} rgn=${r.prtcptLmtRgnNm || ''}`;
    }
    if (lab === '공사 강원51') items.slice(0, 50).forEach((r) => { if (!REF.some((x) => String(r.bidNtceNo).startsWith(x))) console.log(`[CMP]   우리만: ${r._org} ${r.bidNtceNo} ${r.bidNtceNm} ${r.opengDt}`); });
  }
  for (const x of REF) console.log(`[CMP] ${x} → ${seen[x] || '없음'}`);
  // 없는 것은 공고번호로 직접 조회해 이유 확인
  for (const x of REF.filter((y) => !seen[y] && /^R26/.test(y))) {
    for (const kind of ['Cnstwk', 'Thng']) {
      const b = await fetch(`${base}/api/bid/getBidPblancListInfo${kind}PPSSrch?inqryDiv=2&bidNtceNo=${x}&numOfRows=5&pageNo=1&inqryBgnDt=202609010000&inqryEndDt=202610292359`).then((r) => r.json()).catch(() => ({}));
      const o = await fetch(`${base}/api/scs/getOpengResultListInfo${kind}PPSSrch?inqryDiv=3&bidNtceNo=${x}&numOfRows=5&pageNo=1`).then((r) => r.json()).catch(() => ({}));
      const bi = b.items?.[0]; const oi = o.items?.[0];
      if (bi || oi) console.log(`[CMP]   ${x} ${kind}: 공고=${bi ? `${bi.bidNtceNm} 업종제한=${bi.indstrytyLmtYn} 지역=${bi.prtcptLmtRgnNm || ''}` : '없음'} | 개찰=${oi ? `${oi.progrsDivCdNm} ${oi.opengDt}` : '없음'}`);
    }
  }
}
