import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db, all } from '../../../server/db.ts';
import { getContract } from '../../../server/custom.ts';
import { getProvider } from '../../../server/providers/sim.ts';
import { AppError, won, dt } from '../../../server/util.ts';
import { requireUser, F, Flash, Row, In, Lines, St } from '../../lib.tsx';
import { FileTable, Upload } from '../../parts.tsx';

export default async function Contract({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const back = `/contracts/${id}`; const u = await requireUser(back);
  let c: any; try { c = await getContract(u, id); } catch (e) { if (e instanceof AppError) redirect('/me?err=' + encodeURIComponent(e.message)); throw e; }
  const t = c.version.terms; const isBuyer = u.id === c.buyer_id; const isSeller = u.id === c.seller_id;
  const agreed = isBuyer ? c.version.buyer_agreed_at : c.version.seller_agreed_at;
  const caps = getProvider().capabilities();
  const drafts = isSeller ? await all(db, "SELECT v.*, m.id AS mid FROM file_versions v JOIN milestones m ON m.id=v.milestone_id WHERE m.contract_id=$1 AND v.status='draft' ORDER BY v.id", [id]) : [];
  const files = drafts.length ? await all(db, 'SELECT * FROM files WHERE version_id IN (SELECT v.id FROM file_versions v JOIN milestones m ON m.id=v.milestone_id WHERE m.contract_id=$1) ORDER BY id', [id]) : [];
  const messages = await all(db, 'SELECT m.*, x.name FROM messages m JOIN users x ON x.id=m.sender_id WHERE m.contract_id=$1 ORDER BY m.id', [id]);
  return (<><h1>{t.title}</h1>
    <p>{({ negotiating: '협의 중', active: '진행 중', completed: '완료', terminated: '해지' } as any)[c.status]} · 계약 버전 {c.current_version_no} {c.version.is_draft && <span className="tag">법률 검토 전 초안</span>}</p><Flash sp={await searchParams} />
    <div className="grid split"><div>
      <div className="card"><h2>계약 조건</h2><dl>
        {t.requirements && <Row label="요구사항"><Lines text={t.requirements} /></Row>}{t.scope && <Row label="작업 범위"><Lines text={t.scope} /></Row>}{t.outOfScope && <Row label="제외 범위"><Lines text={t.outOfScope} /></Row>}
        {t.inspectionCriteria && <Row label="검수 기준"><Lines text={t.inspectionCriteria} /></Row>}{t.revisionScope && <Row label="수정 범위">{t.revisionScope}</Row>}{t.sourceTerms && <Row label="소스코드 제공">{t.sourceTerms}</Row>}{t.rightsOwnership && <Row label="권리 귀속">{t.rightsOwnership}</Row>}
        {t.text && <Row label="거래 조건"><span style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span></Row>}{t.rightType && <Row label="양도·이용허락 범위">{t.scope}{t.isExclusive ? ' · 독점' : ' · 비독점'}</Row>}
        <Row label="총액"><b className="num">{won(t.total ?? t.amount)}</b></Row>
        {(t.changes || []).map((ch: any, i: number) => <Row key={i} label={`변경 ${i + 1}`}>기존: {ch.existingScope} → 추가: {ch.addedScope} · +{won(ch.amountDelta)} · +{ch.daysDelta}일</Row>)}
        <Row label="구매자 동의">{dt(c.version.buyer_agreed_at)}</Row><Row label="판매자 동의">{dt(c.version.seller_agreed_at)}</Row></dl>
        {(isBuyer || isSeller) && !agreed && <F a="contract_agree" back={back} h={{ id }}><button className="pri" style={{ marginTop: 12 }}>이 조건에 동의</button></F>}
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>양측이 동의한 버전은 고칠 수 없습니다. 조건을 바꾸려면 변경 계약으로 새 버전을 만듭니다. 이 문서는 법률 검토를 거치기 전까지 초안입니다</p>
        {u.operator_role && c.version.is_draft && <F a="ad_legal" back={back} h={{ id: c.version.id }}><button>법률 검토 완료로 표시</button></F>}</div>
      {c.milestones.length > 0 && <div className="card"><h2>단계</h2>
        {c.milestones.map((m: any) => { const prevDone = c.milestones.filter((x: any) => x.seq < m.seq).every((x: any) => ['accepted', 'cancelled'].includes(x.status)); const myDrafts = drafts.filter((d) => d.mid === m.id);
          return (<div key={m.id} style={{ borderTop: '1px solid var(--line)', padding: '16px 0' }}>
            <div className="acts" style={{ justifyContent: 'space-between' }}><h3>{m.seq}단계 {m.title}</h3><b className="num">{won(m.amount)}</b></div>
            <p className="sub">{m.deliverables}{m.due_date && ` · 기한 ${dt(m.due_date).slice(0, 12)}`}{m.required_files.length > 0 && ' · 소스와 설치 문서 필수'}</p>
            <p><span className="tag">{({ planned: '결제 전', awaiting_payment: '결제 대기', in_progress: '작업 중', delivered: '납품됨', accepted: '승인됨', cancelled: '취소' } as any)[m.status]}</span> {m.order_id && <><St k="payment" v={m.payment_status} /> <St k="inspection" v={m.inspection_status} /> <Link href={`/orders/${m.order_id}`}>거래 작업실</Link></>}</p>
            {isBuyer && c.status === 'active' && ['planned', 'awaiting_payment'].includes(m.status) && (prevDone ? <F a="milestone_pay" back={back} h={{ id: m.id }} className="inline">
              <label className="in"><span>결제수단</span><select name="method">{Object.entries(caps.methodLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="check"><input type="checkbox" name="agree" required /> 이 단계의 산출물·금액·검수 기준을 확인했습니다</label><button className="pri">이 단계 결제</button></F> : <p className="muted">앞 단계가 승인되면 결제할 수 있습니다</p>)}
            {isSeller && m.payment_status === 'paid' && ['in_progress', 'delivered'].includes(m.status) && <>
              {myDrafts.map((d) => { const df = files.filter((f) => f.version_id === d.id); return (<div key={d.id} className="note" style={{ marginTop: 8 }}><b>납품 준비: {d.label}</b>
                {df.length > 0 && <FileTable files={df} dl={(f) => <F a="file_remove" back={back} h={{ id: f.id }}><button className="link">삭제</button></F>} />}<Upload versionId={d.id} back={back} />
                <F a="milestone_deliver" back={back} h={{ id: m.id, version_id: d.id }}><button className="pri" style={{ marginTop: 8 }}>이 파일로 납품 제출</button></F></div>); })}
              {!myDrafts.length && <F a="version_create" back={back} h={{ milestone_id: m.id }} className="inline"><In label="납품 버전 이름" name="label" required /><button>납품 준비 시작</button></F>}
              <p className="muted" style={{ fontSize: 13 }}>화면 캡처나 시연 영상(증빙 자료)만으로는 납품이 되지 않습니다. 제출한 납품물은 잠깁니다</p></>}
            {isSeller && m.status !== 'accepted' && m.payment_status !== 'paid' && <p className="muted">이 단계의 결제가 확인된 뒤 작업을 시작하세요</p>}
          </div>); })}</div>}
      {c.milestones.length > 0 && <div className="card"><h2>변경 계약</h2><p className="sub">계약에 없던 요구는 무료 수정이 아니라 변경 계약으로 다룹니다. 금액·기간 변경에 양측이 동의해야 반영됩니다</p>
        {c.changes.map((ch: any) => <div key={ch.id} className="msg"><b>{({ proposed: '제안됨', agreed: '합의됨', rejected: '거절됨', withdrawn: '철회' } as any)[ch.status]}</b> 기존: {ch.existing_scope} → 추가: {ch.added_scope} · +{won(ch.amount_delta)} · +{ch.days_delta}일 · {ch.in_original_scope === true ? '원래 범위 안' : ch.in_original_scope === false ? '범위 밖(추가 개발)' : '범위 판단 필요'}
          {ch.status === 'proposed' && (isBuyer ? !ch.buyer_agreed_at : isSeller && !ch.seller_agreed_at) && <span className="acts" style={{ marginTop: 4 }}><F a="change_decide" back={back} h={{ id: ch.id, agree: 1 }}><button className="pri">동의</button></F><F a="change_decide" back={back} h={{ id: ch.id, agree: 0 }}><button>거절</button></F></span>}</div>)}
        {c.status === 'active' && (isBuyer || isSeller) && <details><summary>변경 제안</summary><F a="change_propose" back={back} h={{ id }}><In label="기존 범위(관련 부분)" name="existing_scope" area required /><In label="추가·변경할 범위" name="added_scope" area required />
          <label className="in"><span>범위 분류</span><select name="in_original_scope"><option value="no">계약 범위 밖(추가 개발)</option><option value="yes">계약 범위 안(수정)</option><option value="">판단 필요</option></select></label>
          <div className="inline"><In label="추가 금액(원)" name="amount_delta" type="number" /><In label="추가 기간(일)" name="days_delta" type="number" /></div><button>제안</button></F></details>}</div>}
      <div className="card"><h2>요청·답변 기록</h2>{messages.map((m) => <div className="msg" key={m.id}><b>{m.name}</b><time>{dt(m.created_at)}</time><div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div>)}
        {(isBuyer || isSeller) && <F a="message" back={back} h={{ contract_id: id }}><In label="내용" name="body" area required /><button>보내기</button></F>}</div>
    </div><aside><div className="card"><h3>계약 버전</h3>{c.versions.map((v: any) => <div key={v.id} className="msg">버전 {v.version_no} {v.buyer_agreed_at && v.seller_agreed_at ? '양측 동의(잠김)' : '동의 대기'}<time>{dt(v.created_at)}</time></div>)}</div>
      <div className="card"><h3>단계별 안전거래</h3><ul className="lines"><li>단계마다 별도의 주문과 결제를 만듭니다. 전체 금액을 한 번에 맡겨 두고 나눠 지급하는 방식이 아닙니다</li><li>각 단계는 결제 확인 → 작업 → 납품 → 검수 → 정산을 따로 거칩니다</li><li>앞 단계가 승인되어야 다음 단계를 결제할 수 있습니다</li></ul></div></aside></div>
  </>);
}
