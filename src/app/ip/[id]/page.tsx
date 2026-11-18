import { notFound } from 'next/navigation';
import { db, one, all } from '../../../server/db.ts';
import { RIGHT_TYPES, NDA_TEXT, canViewRoom, roomFiles } from '../../../server/ip.ts';
import { won, dt } from '../../../server/util.ts';
import { me, F, Flash, Row, Lines, In } from '../../lib.tsx';
import { FileTable, Upload } from '../../parts.tsx';

export default async function Listing({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<any> }) {
  const id = Number((await params).id); const back = `/ip/${id}`; const u = await me();
  const l = await one(db, 'SELECT l.*, s.display_name FROM ip_listings l JOIN sellers s ON s.user_id=l.seller_id WHERE l.id=$1', [id]);
  const owner = u?.id === l?.seller_id;
  if (!l || (!['listed', 'locked', 'sold'].includes(l.status) && !owner && !u?.operator_role)) notFound();
  const room = await canViewRoom(u, l); const files = room ? await roomFiles(id) : [];
  const grant = u && !owner ? await one(db, 'SELECT * FROM ip_access_grants WHERE listing_id=$1 AND user_id=$2', [id, u.id]) : null;
  const grants = owner ? await all(db, 'SELECT g.*, x.name, x.email FROM ip_access_grants g JOIN users x ON x.id=g.user_id WHERE g.listing_id=$1 ORDER BY g.id', [id]) : [];
  const draft = owner ? await one(db, "SELECT * FROM file_versions WHERE ip_listing_id=$1 AND status='draft' ORDER BY id DESC LIMIT 1", [id]) : null;
  const deals = owner ? await all(db, 'SELECT d.id, d.stage, x.name FROM ip_deals d JOIN users x ON x.id=d.buyer_id WHERE d.listing_id=$1 ORDER BY d.id DESC', [id]) : [];
  return (<><h1>{l.title}</h1><p><span className="tag">{RIGHT_TYPES[l.right_type]}</span> {l.is_exclusive && <span className="tag">독점</span>} <span className="tag">{({ draft: '작성 중', pending_review: '심사 대기', listed: '거래 가능', locked: '독점 거래 진행 중', sold: '거래 완료', withdrawn: '내림' } as any)[l.status]}</span></p><Flash sp={await searchParams} />
    <div className="grid split"><div>
      <div className="card"><h2>공개 소개</h2><p style={{ whiteSpace: 'pre-wrap' }}>{l.public_intro || '소개 없음'}</p><dl>
        <Row label="권리 대상">{l.subject || '-'}</Row><Row label="권리자">{l.right_holder}</Row><Row label="판매 권한의 근거">{l.seller_authority}</Row><Row label="공동 권리자">{l.co_owners || '없다고 등록됨'}</Row>
        <Row label="양도·이용허락 범위"><Lines text={l.scope} /></Row><Row label="기간·지역·분야">{[l.term, l.territory, l.field_of_use].filter(Boolean).join(' · ') || '협의'}</Row>
        <Row label="기존 이용허락·제약"><Lines text={l.existing_licenses} /></Row><Row label="제3자 구성요소"><Lines text={l.third_party} /></Row><Row label="포함 자산"><Lines text={l.included_assets} /></Row><Row label="제외 자산"><Lines text={l.excluded_assets} /></Row></dl>
        <p className="note" style={{ marginTop: 12 }}>위 내용은 판매자가 등록한 것입니다. 플랫폼은 항목과 증빙 제출 여부만 확인했으며 권리의 진위나 침해 여부를 검증·보증하지 않습니다. 계약 전에 직접 확인하고 필요하면 전문가 검토를 받으세요</p></div>
      <div className="card"><h2>비공개 자료실</h2>
        {room ? <>{files.length ? <FileTable files={files} dl={(f) => <a className="btn" href={`/api/room/${f.id}`}>열람</a>} /> : <p className="muted">등록된 자료가 없습니다</p>}<p className="muted" style={{ fontSize: 13 }}>열람할 때마다 기록이 남습니다</p></>
          : !u ? <p className="muted">로그인 후 열람을 요청할 수 있습니다</p> : grant ? <p className="muted">{grant.revoked_at ? '열람 권한이 회수되었습니다' : '비밀유지 조건에 동의했습니다. 판매자의 승인을 기다리고 있습니다'}</p>
            : ['listed', 'locked'].includes(l.status) && <F a="ip_access" back={back} h={{ id }}><p className="note">{NDA_TEXT}</p><label className="check" style={{ margin: '12px 0' }}><input type="checkbox" name="agree" required /> 위 비밀유지 조건에 동의합니다</label><button>열람 요청</button></F>}
        {owner && <>{draft ? <Upload versionId={draft.id} back={back} /> : <F a="version_create" back={back} h={{ ip_listing_id: id }} className="inline"><In label="자료 묶음 이름" name="label" required /><button>자료 올리기 시작</button></F>}
          <h3 style={{ marginTop: 16 }}>열람 요청</h3>{grants.length ? grants.map((g) => <div className="msg acts" key={g.id}><span>{g.name} {g.email} · 동의 {dt(g.nda_agreed_at)} · {g.revoked_at ? '회수됨' : g.approved_at ? '승인됨' : '대기'}</span>
            {(!g.approved_at || g.revoked_at) && <F a="ip_access_decide" back={back} h={{ id: g.id, approve: 1 }}><button>승인</button></F>}{g.approved_at && !g.revoked_at && <F a="ip_access_decide" back={back} h={{ id: g.id, approve: 0 }}><button>회수</button></F>}</div>) : <p className="muted">없음</p>}</>}</div>
    </div><aside><div className="card"><div className="muted" style={{ fontSize: 13 }}>희망 금액</div><div className="price-lg">{l.asking_price ? won(l.asking_price) : '협의'}</div><p className="muted">{l.display_name}</p>
      {u && !owner && l.status === 'listed' && <F a="ip_deal_start" back={back} h={{ id }}><button className="pri" style={{ width: '100%' }}>거래 상담 시작</button></F>}
      {l.status === 'locked' && !owner && <p className="muted">다른 독점 거래가 진행 중입니다</p>}
      {owner && l.status === 'draft' && <F a="ip_submit" back={back} h={{ id }}><button className="pri">심사에 제출</button></F>}</div>
      {owner && <div className="card"><h3>진행 중인 거래</h3>{deals.length ? deals.map((d) => <div key={d.id} className="msg"><a href={`/ip/deals/${d.id}`}>{d.name}</a> <span className="tag">{d.stage}</span></div>) : <p className="muted">없음</p>}</div>}
      <div className="card"><h3>거래 절차</h3><ol className="lines"><li>상담</li><li>비밀유지 조건 합의</li><li>자료 열람</li><li>권리·기술 확인</li><li>거래 조건 확정</li><li>계약과 결제</li><li>자산 인도</li><li>권리 이전 절차 확인</li><li>완료·정산</li></ol></div></aside></div></>);
}
