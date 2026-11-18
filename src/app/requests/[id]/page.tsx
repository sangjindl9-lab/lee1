import { redirect } from 'next/navigation';
import { db, all } from '../../../server/db.ts';
import { getRequest, WORK_TYPES } from '../../../server/custom.ts';
import { AppError, won, dt } from '../../../server/util.ts';
import { me, F, Flash, Row, In, Lines } from '../../lib.tsx';

export default async function Request({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const back = `/requests/${id}`; const u = await me();
  let r: any; try { r = await getRequest(u, id); } catch (e) { if (e instanceof AppError) redirect('/requests'); throw e; }
  const mine = u?.id === r.buyer_id;
  const quotes = u ? await all(db, `SELECT q.*, s.display_name FROM quotes q JOIN sellers s ON s.user_id=q.seller_id WHERE q.request_id=$1 AND ($2 OR q.seller_id=$3) ORDER BY q.total_amount`, [id, mine || !!u.operator_role, u.id]) : [];
  return (<><h1>{r.title}</h1><p className="muted">{WORK_TYPES[r.work_type]} · {r.buyer_name} · {dt(r.created_at)}</p><Flash sp={await searchParams} />
    <div className="card"><dl><Row label="개발 목적"><Lines text={r.purpose} /></Row><Row label="기능 요구사항"><Lines text={r.requirements} /></Row><Row label="실행 환경"><Lines text={r.environment} /></Row>
      <Row label="예산">{r.budget_min || r.budget_max ? `${r.budget_min ? won(r.budget_min) : ''} ~ ${r.budget_max ? won(r.budget_max) : ''}` : '협의'}</Row><Row label="납기">{r.due_date ? dt(r.due_date).slice(0, 12) : '협의'}</Row>
      <Row label="소스코드 제공">{r.source_terms || '협의'}</Row><Row label="권리 귀속">{r.rights_ownership || '협의'}</Row><Row label="유지보수">{r.maintenance || '협의'}</Row></dl></div>
    {mine && <h2>받은 견적 {quotes.length}건 <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>낮은 금액순</span></h2>}
    {quotes.map((q) => <div className="card" key={q.id}><div className="acts" style={{ justifyContent: 'space-between' }}><h3>{q.display_name}</h3><b className="num">{won(q.total_amount)}</b></div><dl>
      <Row label="작업 범위"><Lines text={q.scope} /></Row><Row label="제외 범위"><Lines text={q.out_of_scope} /></Row><Row label="검수 기준"><Lines text={q.inspection_criteria} /></Row><Row label="수정 범위">{q.revision_scope || '-'}</Row><Row label="지원 조건">{q.support_terms || '-'}</Row>
      <Row label="단계"><table><tbody>{q.stages.map((s: any, i: number) => <tr key={i}><td>{i + 1}단계 {s.title}</td><td>{s.deliverables}</td><td className="num">{s.days}일</td><td className="r num">{won(s.amount)}</td></tr>)}</tbody></table></Row></dl>
      {mine && q.status === 'submitted' && r.status === 'open' && <F a="quote_accept" back={back} h={{ id: q.id }}><button className="pri">이 견적으로 계약 협의 시작</button></F>}{q.status !== 'submitted' && <span className="tag">{({ accepted: '채택됨', declined: '미채택', withdrawn: '철회' } as any)[q.status]}</span>}</div>)}
    {u && !mine && r.status === 'open' && !quotes.length && <div className="card"><h2>견적 제안</h2><p className="muted">승인된 판매자만 제안할 수 있습니다. 단계마다 산출물과 금액을 정하면, 구매자는 단계별로 결제하고 그 뒤에 작업을 시작합니다</p>
      <F a="quote_submit" back={back} h={{ id }}><In label="작업 범위" name="scope" area required /><In label="제외 범위" name="out_of_scope" area required /><In label="검수 기준" name="inspection_criteria" area required /><In label="수정 범위" name="revision_scope" /><In label="지원 조건" name="support_terms" />
        {[1, 2, 3, 4].map((n) => <div className="inline" key={n} style={{ marginBottom: 8 }}><In label={`${n}단계 제목`} name="stage_title" value={n === 1 ? '요구사항 및 화면 설계' : ''} /><In label="산출물" name="stage_deliverables" /><In label="금액(원)" name="stage_amount" type="number" /><In label="기간(일)" name="stage_days" type="number" /></div>)}
        <p className="muted" style={{ fontSize: 13 }}>마지막 단계는 최종 소스와 설치·실행 문서가 있어야 납품으로 인정됩니다</p><button className="pri">견적 제출</button></F></div>}
  </>);
}
