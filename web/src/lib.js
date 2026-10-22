// 공통: API 호출, 날짜·금액 표시, 라벨
let csrf = null;
export const setCsrf = t => { csrf = t; };

export class ApiError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError(0, '인터넷 연결을 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || '요청을 처리하지 못했어요.', data.code);
  return data;
}

export const WK = ['일', '월', '화', '수', '목', '금', '토'];
export const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const nightsBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
export const fmtD = s => { if (!s) return ''; const d = parseD(s); return `${d.getMonth() + 1}월 ${d.getDate()}일(${WK[d.getDay()]})`; };
export const fmtShort = s => { if (!s) return ''; const d = parseD(s); return `${d.getMonth() + 1}.${d.getDate()}`; };
export const fmtDT = s => { const d = new Date(s); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const fmtYM = s => { const d = new Date(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월`; };
export const won = n => '₩' + Math.round(Number(n) || 0).toLocaleString('ko-KR');
export const man = n => { const v = Number(n) / 10000; return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + '만'; };
export const todayLocal = () => ymd(new Date());

export const CAT_NAMES = { hanok: '한옥', ocean: '오션뷰', forest: '산·숲', city: '도심', pool: '풀빌라', camp: '캠핑', cabin: '독채' };
export const STATUS = {
  requested: ['승인 대기', 'st-warn'], confirmed: ['예약 확정', 'st-ok'], completed: ['숙박 완료', 'st-mute'],
  declined: ['호스트 거절', 'st-bad'], cancelled: ['취소됨', 'st-bad'], expired: ['응답 기한 만료', 'st-mute'],
};
export const LSTATUS = {
  draft: ['작성 중', 'st-mute'], pending: ['심사 중', 'st-warn'], approved: ['게시 중', 'st-ok'],
  rejected: ['보완 요청', 'st-bad'], suspended: ['게시 중지', 'st-bad'],
};
export const photo = (id, thumb) => (id ? `/photos/${id}${thumb ? '-t' : ''}.webp` : null);

export const initial = name => (name || '?').trim().slice(0, 1);
const AV = ['#2F6E5A', '#8A5A2B', '#5A4E8C', '#3D6E8C', '#9C4A5E', '#4F6B2F'];
export const avColor = s => AV[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
