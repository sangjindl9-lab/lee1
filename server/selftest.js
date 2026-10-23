// SELFTEST=1: 업체검색 점검
export async function selfTest(base) {
  for (const q of ['서화통신', '에스에스전력', '2258113758']) {
    const t = Date.now();
    const d = await fetch(`${base}/api/corps/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch((e) => ({ error: e.message }));
    console.log(`[SELFTEST] corps '${q}' → ${d.error || `${d.totalCount}곳 partial=${d.partial}`} ${Date.now() - t}ms :: ${(d.items || []).slice(0, 4).map((c) => `${c.name}/${c.ceo}/${c.tel}/${c.rgnNm}`).join(' | ')}`);
  }
  const t = Date.now();
  const d = await fetch(`${base}/api/corps/2258113758/detail`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  console.log(`[SELFTEST] corp detail → ${d.error || ''} ${Date.now() - t}ms basic=${d.basic?.name} 업종=${(d.industries || []).map((x) => x.name).join(',')} 낙찰=${d.awards?.length} :: ${(d.awards || []).slice(0, 3).map((a) => `${a.bidNtceNm}/${a.sucsfbidAmt}`).join(' | ')}`);
}
