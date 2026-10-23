// SELFTEST=1: 철도 파일데이터(여러 파일 통합) 점검
export async function selfTest(base) {
  for (const src of ['kr', 'korail']) {
    const d = await fetch(`${base}/api/ext/${src}?numOfRows=1`).then((r) => r.json()).catch((e) => ({ error: e.message }));
    console.log(`[SELFTEST] ext ${src} → ${d.error || `${d.totalCount}건 file=${d.file} latest=${d.latest}`}`);
    const old = await fetch(`${base}/api/ext/${src}?from=2023-01-01&to=2023-12-31&numOfRows=1`).then((r) => r.json()).catch(() => ({}));
    console.log(`[SELFTEST] ext ${src} 2023년 공고 → ${old.totalCount ?? '-'}건 ${old.items?.[0]?.bidNtceNm || ''}`);
  }
}
