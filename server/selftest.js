// SELFTEST=1: 나라장터 통합 12개 기관이 실제로 조회되는지 점검
const AGENCIES = ['인천국제공항공사', '한국환경공단', '한국국토정보공사', '한국지역난방공사', '에스알', '강원랜드',
  '한국석유공사', '한국조폐공사', '정보통신산업진흥원', '한국과학기술연구원', '한국전기연구원', '한국과학기술정보연구원'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

export async function selfTest(base) {
  const now = new Date();
  const from = new Date(now.getTime() - 29 * 86400000);
  const dates = { inqryBgnDt: `${ymd(from)}0000`, inqryEndDt: `${ymd(now)}2359` };
  for (const name of AGENCIES) {
    const counts = [];
    let sample = '';
    for (const kind of ['Cnstwk', 'Servc', 'Thng']) {
      for (const field of ['ntceInsttNm', 'dminsttNm']) {
        const qs = new URLSearchParams({ ...dates, inqryDiv: '1', [field]: name, numOfRows: '3', pageNo: '1' });
        try {
          const d = await fetch(`${base}/api/bid/getBidPblancListInfo${kind}PPSSrch?${qs}`).then((r) => r.json());
          counts.push(`${kind}.${field === 'ntceInsttNm' ? '공고' : '수요'}=${d.error ? 'ERR' : d.totalCount}`);
          if (!sample && d.items?.[0]) sample = `${d.items[0].bidNtceNo} ${d.items[0].ntceInsttNm} / ${d.items[0].bidNtceNm}`;
        } catch (e) { counts.push(`${kind}=EXC`); }
      }
    }
    const qs = new URLSearchParams({ ...dates, inqryDiv: '2', ntceInsttNm: name, numOfRows: '1', pageNo: '1' });
    const o = await fetch(`${base}/api/scs/getOpengResultListInfoCnstwkPPSSrch?${qs}`).then((r) => r.json()).catch(() => ({}));
    console.log(`[SELFTEST] ${name} :: ${counts.join(' ')} 개찰(공사)=${o.error ? 'ERR' : o.totalCount} :: ${sample}`);
  }
}
