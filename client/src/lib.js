// 공통 유틸: API 호출, 날짜/금액 포맷, 코드표
export const KINDS = [
  { id: 'All', label: '전체', awardOnly: true },
  { id: 'Cnstwk', label: '공사' },
  { id: 'Servc', label: '용역' },
  { id: 'Thng', label: '물품' },
  { id: 'Frgcpt', label: '외자' },
  { id: 'Etc', label: '기타', bidOnly: true },
];

// 참가제한지역코드 (API 문서 기준)
export const REGIONS = [
  ['', '전체'], ['00', '전국(제한없음)'], ['51', '강원특별자치도'], ['42', '강원도(구코드)'], ['11', '서울특별시'], ['41', '경기도'],
  ['28', '인천광역시'], ['43', '충청북도'], ['44', '충청남도'], ['30', '대전광역시'], ['36', '세종특별자치시'], ['47', '경상북도'],
  ['48', '경상남도'], ['26', '부산광역시'], ['27', '대구광역시'], ['31', '울산광역시'], ['52', '전북특별자치도'], ['45', '전라북도(구코드)'],
  ['46', '전라남도'], ['29', '광주광역시'], ['12', '전남광주통합특별시'], ['50', '제주도'], ['99', '기타'],
];

export const INDUSTRY_PRESETS = ['전기공사업', '정보통신공사업', '소방시설공사업', '기계설비', '전문소방'];

export async function api(svc, op, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const r = await fetch(`/api/${svc}/${op}?${qs}`);  // svc 'award' → /api/award/:kind
  const data = await r.json().catch(() => ({ error: `서버 응답 오류 (${r.status})` }));
  if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const pad = (n) => String(n).padStart(2, '0');
export const toInputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toApiDt = (s, end) => (s ? s.replaceAll('-', '') + (end ? '2359' : '0000') : '');
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toInputDate(d); };
export const daysLater = (n) => daysAgo(-n);

export const won = (v) => {
  const n = Number(v);
  if (!v || Number.isNaN(n) || n === 0) return '-';
  return n.toLocaleString('ko-KR');
};
// 금액 짧게: 1.23억 / 4,500만
export const wonShort = (v) => {
  const n = Number(v);
  if (!v || Number.isNaN(n) || n === 0) return '-';
  if (n >= 1e8) return `${(n / 1e8).toFixed(2).replace(/\.?0+$/, '')}억`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  return n.toLocaleString('ko-KR');
};
export const dt = (s) => (s ? String(s).slice(0, 16) : '-');
export const shortDt = (s) => (s ? String(s).slice(5, 16) : '-');

export function dday(s) {
  if (!s) return null;
  const t = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  const diff = t.getTime() - Date.now();
  if (diff < 0) return { text: '마감', cls: 'closed' };
  const h = diff / 3600000;
  if (h < 24) return { text: `${Math.ceil(h)}시간`, cls: 'urgent' };
  const d = Math.ceil(h / 24);
  return { text: `D-${d}`, cls: d <= 3 ? 'soon' : '' };
}

// 개찰업체정보: "업체명^사업자번호^대표자^투찰금액^투찰률"
export function parseCorpInfo(s) {
  if (!s) return null;
  const [name, bizno, ceo, amt, rate] = String(s).split('^');
  return { name, bizno, ceo, amt, rate };
}

export const bizno = (s) => (s && s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : s || '-');

// 원문 링크: API가 주는 상세 URL 우선, 없으면 나라장터 메인
export const g2bLink = (item) => item?.bidNtceDtlUrl || item?.bidNtceUrl || 'https://www.g2b.go.kr';

// 로컬 저장 (설정·관심공고)
export function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 저장 불가 환경 무시 */ }
}

export async function exportExcel(rows, columns, filename) {
  const XLSX = await import('xlsx');
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, c.excel ? c.excel(r) : r[c.key] ?? ''])));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = columns.map((c) => ({ wch: c.wch || 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '목록');
  XLSX.writeFile(wb, filename);
}
