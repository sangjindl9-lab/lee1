import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, all } from '../../../../server/db.ts';
import { getProduct, feePreview, fileProblems } from '../../../../server/catalog.ts';
import { won, dt } from '../../../../server/util.ts';
import { requireUser, F, Flash, St, Row, In } from '../../../lib.tsx';
import { FileTable, ScanNote, Upload } from '../../../parts.tsx';
import { ProductForm } from '../ProductForm.tsx';

export default async function Edit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const back = `/seller/products/${id}`;
  const u = await requireUser(back); const p = await getProduct(id);
  if (!p || p.seller_id !== u.id) notFound();
  const versions = await all(db, 'SELECT * FROM file_versions WHERE product_id=$1 ORDER BY id DESC', [id]);
  const files = await all(db, 'SELECT f.* FROM files f JOIN file_versions v ON v.id=f.version_id WHERE v.product_id=$1 ORDER BY f.id', [id]);
  const pre = p.option ? await feePreview(u.id, p.category, p.option.price) : null;
  const draft = versions.find((v) => v.status === 'draft');
  const problems = draft ? fileProblems(files.filter((f) => f.version_id === draft.id), p.deliverables) : [];
  return (<div style={{ maxWidth: 900 }}>
    <p><Link href="/seller">판매 관리</Link></p><h1>{p.title}</h1><p><St k="product" v={p.status} /> {p.status === 'on_sale' && <Link href={`/products/${id}`}>상품 화면 보기</Link>}{p.review_note && <span className="muted"> · 심사 의견: {p.review_note}</span>}</p>
    <Flash sp={await searchParams} />
    {pre && <div className="card"><h2>예상 정산액</h2><dl>
      <Row label="판매가"><span className="num">{won(pre.settlement.base)}</span></Row><Row label="수수료"><span className="num">−{won(pre.settlement.feeSupply)}</span> <span className="muted">{pre.policy.rateBps / 100}% · 부가세 −{won(pre.settlement.feeVat)}</span></Row>
      <Row label="결제 비용"><span className="num">−{won(pre.settlement.sellerPgFee)}</span>{pre.policy.pgFeeBearer === 'platform' && <span className="muted"> 플랫폼 부담</span>}</Row>
      {pre.settlement.withholdingIncomeTax > 0 && <Row label="원천징수 3.3%"><span className="num">−{won(pre.settlement.withholdingIncomeTax + pre.settlement.withholdingLocalTax)}</span></Row>}
      <Row label="1건 판매 시 지급액"><b className="num">{won(pre.settlement.net)}</b></Row></dl><p className="muted" style={{ fontSize: 13 }}>현재 수수료 정책 기준입니다. 실제 정산은 주문 시점의 정책으로 계산합니다</p></div>}
    <div className="card"><h2>납품 파일</h2><p className="sub">즉시 다운로드 상품은 판매 전에 실제 납품 파일을 등록해야 합니다. 심사에 제출한 버전은 잠겨서 파일을 바꿀 수 없고, 변경은 새 버전으로만 합니다</p>
      {versions.map((v) => { const vf = files.filter((f) => f.version_id === v.id); return (<div key={v.id} style={{ borderTop: '1px solid var(--line)', padding: '16px 0' }}>
        <h3>버전 {v.label} <span className="tag">{({ draft: '작성 중', submitted: '심사 제출됨(잠김)', published: '판매 중(잠김)', rejected: '반려', retired: '이전 버전(기존 주문용 보관)' } as any)[v.status]}</span>{p.current_version_id === v.id && <span className="tag" style={{ marginLeft: 4 }}>현재 판매 버전</span>} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{dt(v.created_at)}</span></h3>
        {vf.length ? <FileTable files={vf} dl={v.status === 'draft' ? (f) => <F a="file_remove" back={back} h={{ id: f.id }}><button className="link">삭제</button></F> : undefined} /> : <p className="muted">파일 없음</p>}
        {vf.some((f) => f.scan_detail?.length) && <details><summary className="muted" style={{ fontSize: 13 }}>검사 상세</summary><ul className="lines">{vf.flatMap((f) => (f.scan_detail || []).map((d: string, i: number) => <li key={`${f.id}-${i}`}>{f.filename}: {d}</li>))}</ul></details>}
        {v.status === 'draft' && <Upload versionId={v.id} back={back} />}</div>); })}
      {versions.length > 0 && <ScanNote />}
      {!draft && <F a="version_create" back={back} h={{ product_id: id }} className="inline"><In label="새 버전 이름" name="label" required /><button>버전 만들기</button></F>}
    </div>
    <div className="card"><h2>심사 제출</h2>
      {problems.length > 0 && <p className="flash bad">{problems.join(' / ')}</p>}
      {['draft', 'rejected', 'pending_review'].includes(p.status) || draft ? <F a="product_submit" back={back} h={{ id }}><button className="pri" disabled={!!draft && problems.length > 0}>심사에 제출</button></F> : <p className="muted">제출할 변경 사항이 없습니다</p>}</div>
    <h2 style={{ marginTop: 32 }}>상품 정보 수정</h2><ProductForm p={p} back={back} />
  </div>);
}
