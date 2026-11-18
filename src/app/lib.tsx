import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { sessionUser } from '../server/auth.ts';
import { run } from './actions.ts';

export async function me() { return sessionUser((await cookies()).get('sid')?.value); }
export async function requireUser(back = '/') { const u = await me(); if (!u) redirect(`/login?back=${encodeURIComponent(back)}`); return u!; }

export const LABEL: Record<string, Record<string, string>> = {
  payment: { unpaid: '결제 전', pending: '결제 대기', paid: '결제 완료', partially_refunded: '부분 환불됨', cancelled: '결제 취소됨', failed: '결제 실패' },
  escrow: { none: '해당 없음', test_simulated: '테스트 시뮬레이션(실제 대금 보호 아님)', held: '결제 사업자 보호 중', dispute_hold: '결제 사업자 지급 보류 중', released: '판매자에게 지급됨', refunded: '구매자에게 환불됨', unsupported: '대금 보호 미지원 거래' },
  delivery: { not_ready: '납품 전', submitted: '납품 제출됨(확인 중)', granted: '받을 수 있음', failed: '전달 실패(복구 중)', revoked: '접근 차단됨' },
  inspection: { not_started: '시작 전', in_progress: '검수 중', revision_requested: '수정 요청 중', confirmed: '구매확정', auto_confirmed: '자동확정', disputed: '분쟁으로 중단', closed_by_admin: '운영자 검수 종료' },
  dispute: { none: '없음', open: '진행 중', resolved: '결정됨' },
  refund: { none: '없음', requested: '환불 결정됨(실행 전)', processing: '결제 취소 처리 중', completed: '환불 완료', failed: '결제 취소 실패', post_settlement_review: '사후 환불·회수 검토 중' },
  payout: { not_eligible: '정산 조건 미충족', eligible: '정산 대기', requested: '지급 요청 접수', unknown: '지급 결과 확인 중', paid: '지급 완료', failed: '지급 실패', blocked: '정산 보류', void: '지급 없음' },
  scan: { pending: '대기', scanning: '검사 중', passed: '통과', flagged: '문제 발견', unscannable: '검사 불가' },
  product: { coming_soon: '출시 예정', draft: '작성 중', pending_review: '심사 대기', on_sale: '판매 중', rejected: '반려', suspended: '판매 제한', withdrawn: '판매 종료' },
};
const TONE: Record<string, string> = { paid: 'ok', granted: 'ok', confirmed: 'ok', auto_confirmed: 'ok', completed: 'ok', released: 'ok', passed: 'ok', on_sale: 'ok', eligible: 'ok',
  failed: 'bad', flagged: 'bad', cancelled: 'bad', revoked: 'bad', open: 'warn', blocked: 'warn', disputed: 'warn', dispute_hold: 'warn', unknown: 'warn', processing: 'warn', post_settlement_review: 'warn',
  unscannable: 'warn', test_simulated: 'warn', unsupported: 'warn', revision_requested: 'warn', pending_review: 'warn', requested: 'warn', rejected: 'bad', suspended: 'bad' };
export function St({ k, v }: { k: string; v: string }) { return <span className={`st ${TONE[v] || ''}`}><i />{LABEL[k]?.[v] || v}</span>; }
export const Hash = ({ v }: { v: string }) => <code className="hash" title={v}>{String(v).slice(0, 12)}</code>;
export const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** 서버 액션 폼. a = 액션 이름, back = 처리 후 돌아갈 주소 */
export function F({ a, back, h, children, className }: { a: string; back: string; h?: Record<string, any>; children?: ReactNode; className?: string }) {
  return (
    <form action={run} className={className}>
      <input type="hidden" name="_a" value={a} /><input type="hidden" name="_back" value={back} />
      {Object.entries(h || {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      {children}
    </form>
  );
}
export function Flash({ sp }: { sp: any }) {
  return <>{sp?.err && <p className="flash bad" role="alert">{sp.err}</p>}{sp?.ok && <p className="flash ok" role="status">{sp.ok}</p>}</>;
}
export const Lines = ({ text }: { text: string }) => { const l = String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean); return l.length ? <ul className="lines">{l.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted">적힌 내용 없음</p>; };
export const Row = ({ label, children }: { label: string; children: ReactNode }) => <div className="row"><dt>{label}</dt><dd>{children}</dd></div>;
export function In({ label, name, type = 'text', value, required, hint, area, rows }: { label: string; name: string; type?: string; value?: any; required?: boolean; hint?: string; area?: boolean; rows?: number }) {
  return <label className="in"><span>{label}{required && <b> 필수</b>}</span>
    {area ? <textarea name={name} defaultValue={value ?? ''} required={required} rows={rows || 3} /> : <input name={name} type={type} defaultValue={value ?? ''} required={required} />}
    {hint && <small>{hint}</small>}</label>;
}
export const Check = ({ label, name, on }: { label: string; name: string; on?: boolean }) => <label className="check"><input type="checkbox" name={name} defaultChecked={!!on} /> {label}</label>;
