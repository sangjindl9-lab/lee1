import Link from 'next/link';
import { CATEGORIES, FILE_KINDS } from '../server/catalog.ts';
import { won } from '../server/util.ts';
import { Row, St, Hash, size } from './lib.tsx';

export function ProductCard({ p }: { p: any }) {
  return (
    <Link href={`/products/${p.id}`} className="pcard">
      <h3>{p.title}</h3>
      <div className="sub" style={{ fontSize: 14 }}>{p.summary}</div>
      <div className="meta"><span className="tag">{p.kind === 'source' ? '소스코드' : '사용권'}</span><span className="tag">{CATEGORIES[p.category]}</span>
        {p.has_source && p.kind !== 'source' && <span className="tag">소스 제공</span>}{p.install_support && <span className="tag">설치 지원</span>}{p.external_paid && <span className="tag">외부 유료 서비스 필요</span>}</div>
      <div className="price">{won(p.price)}</div>
      <div className="muted" style={{ fontSize: 13 }}>{p.seller_name}{p.review_count > 0 && ` · 구매 후기 ${p.review_count}건 평균 ${p.rating}`}</div>
    </Link>
  );
}

export function Rights({ lic, kind }: { lic: any; kind: string }) {
  const yn = (b: boolean) => (b ? '가능' : '불가');
  return (<dl>
    <Row label="받는 권리">{kind === 'ip' ? '계약서에 정한 권리' : kind === 'custom' ? '계약서에 정한 산출물과 권리' : kind === 'source' ? '소스코드 인도와 아래 범위의 이용 권리' : '프로그램 사용권'}</Row>
    {lic?.term && <Row label="이용 기간">{lic.term === 'perpetual' ? '영구' : `기간제${lic.term_months ? ` ${lic.term_months}개월` : ''}`}{lic.max_users ? ` · 사용자 ${lic.max_users}명` : ''}{lic.max_devices ? ` · 기기 ${lic.max_devices}대` : ''}</Row>}
    {lic?.term && <Row label="이용 범위">수정 {yn(lic.can_modify)} · 상업적 이용 {yn(lic.can_commercial)} · 재배포 {yn(lic.can_redistribute)} · 재판매 {yn(lic.can_resell)}</Row>}
    {lic?.notes && <Row label="추가 조건">{lic.notes}</Row>}
    {kind !== 'ip' && kind !== 'custom' && <Row label="지식재산권">이전되지 않습니다. 소스 파일을 받아도 저작권은 판매자에게 남습니다</Row>}
  </dl>);
}
export function FileTable({ files, dl }: { files: any[]; dl?: (f: any) => any }) {
  return (<div className="scroll"><table><thead><tr><th>종류</th><th>파일</th><th className="r">크기</th><th>해시(SHA-256)</th><th>압축 안전성</th><th>비밀키·개인정보</th><th>악성 파일</th>{dl && <th />}</tr></thead>
    <tbody>{files.map((f) => <tr key={f.id}><td>{FILE_KINDS[f.kind] || f.kind}</td><td>{f.filename}</td><td className="r num">{size(Number(f.size_bytes))}</td><td><Hash v={f.sha256} /></td>
      <td><St k="scan" v={f.scan_archive} /></td><td><St k="scan" v={f.scan_secret} /></td><td><St k="scan" v={f.scan_malware} /></td>{dl && <td className="r">{dl(f)}</td>}</tr>)}</tbody></table></div>);
}
export const ScanNote = () => <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>해시는 같은 파일인지 확인하는 용도이며 기능이나 판매 권한을 증명하지 않습니다. 세 가지 검사는 서로 다른 항목이고, 어느 하나의 통과가 품질 전체를 보증하지 않습니다. 검사 불가는 검사하지 못했다는 뜻입니다</p>;


export function Upload({ versionId, back }: { versionId: number; back: string }) {
  return (<form action={`/api/upload?back=${encodeURIComponent(back)}`} method="post" encType="multipart/form-data" className="inline" style={{ marginTop: 12 }}>
    <input type="hidden" name="version_id" value={versionId} />
    <label className="in"><span>종류</span><select name="kind">{Object.entries(FILE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="in"><span>파일</span><input type="file" name="file" required /></label><button>올리기</button></form>);
}

