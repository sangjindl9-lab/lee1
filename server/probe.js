// 임시: 방위사업청 공개수의 결과·낙찰업체 상세 조회 방법 확인 [PROBE]
import { d2bRows } from './d2b.js';
const R = 'https://apis.data.go.kr/1690000/BidResultInfoService';
async function call(op, params) {
  const qs = new URLSearchParams({ numOfRows: '20', pageNo: '1', ...params });
  const t = await fetch(`${R}/${op}?serviceKey=${encodeURIComponent(process.env.DATA_GO_KR_KEY)}&${qs}`, { signal: AbortSignal.timeout(40000) }).then((r) => r.text());
  const total = (t.match(/<totalCount>(\d+)/) || [])[1];
  const items = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map((f) => [f[1], f[2]])));
  console.log(`[PROBE] ${op} ${JSON.stringify(params)} → total=${total} items=${items.length} ${items.length ? JSON.stringify(items[0]).slice(0, 900) : t.slice(0, 300).replace(/\s+/g, ' ')}`);
  return items;
}
export async function probe() {
  let list = [];
  for (const p of [{ ntatPlanDateBegin: '20261020', ntatPlanDateEnd: '20261029' }, { opengDateBegin: '20261020', opengDateEnd: '20261029' }]) {
    const it = await call('getFcltyOthbcVltrnNtatResultList', p).catch((e) => { console.log('[PROBE] fail', e.message); return []; });
    if (it.length && !list.length) list = it;
  }
  const x = list.find((i) => /전기|통신/.test(i.othbcNtatNm || i.cntrwkNm || '')) || list[0];
  if (x) {
    const d = x.ntatPlanDate || x.opengDate || String(x.opengDt || '').slice(0, 8);
    await call('getFcltyOthbcVltrnNtatResultDetail', { orntCode: x.orntCode, cntrwkNo: x.cntrwkNo, ntatPlanDate: d, pblancNo: x.pblancNo || '', pblancOdr: x.pblancOdr || '' }).catch(() => {});
    await call('getFcltyOthbcVltrnNtatResultMnufList', { orntCode: x.orntCode, cntrwkNo: x.cntrwkNo, ntatPlanDate: d }).catch(() => {});
  }
  // 경쟁입찰 결과 상세(낙찰업체) — 보관본 1건으로
  const rows = await d2bRows('fcltyResult', process.env.DATA_GO_KR_KEY).catch(() => []);
  const y = rows.find((r) => /낙찰/.test(r.bidResult || '')) || rows[0];
  if (y) {
    const od = y.opengDate || String(y.opengDt || '').replace(/\D/g, '').slice(0, 8);
    await call('getFcltyCmpetBidResultDetail', { orntCode: y.orntCode, cntrwkNo: y.cntrwkNo, opengDate: od, pblancNo: y.pblancNo, pblancOdr: y.pblancOdr }).catch(() => {});
    await call('getFcltyCmpetBidResultMnufList', { orntCode: y.orntCode, cntrwkNo: y.cntrwkNo, ntatPlanDate: od }).catch(() => {});
  }
}
