/**
 * 나라장터(조달청) 계약정보 조회 — 공공데이터포털 '조달청_나라장터 계약정보서비스' (공사 계약)
 *  - 서비스키(일반 인증키, Decoding)가 필요. 오퍼레이션: getCntrctInfoListCnstwk (계약현황 공사 조회)
 *  - 기본 주소는 설정에서 바꿀 수 있다 (공공데이터포털 개편 시 주소가 바뀌는 경우가 있어 운영 전 확인 필요)
 *  - 날짜 조건은 한 번에 1개월 이내 — 더 긴 기간은 나누어 조회
 *  - 조회 결과는 '현장 등록 초안'으로만 쓰고, 사람이 확인해 저장한다
 */
import { httpJson } from '../retry';
import { ProviderContext, ProviderError } from '../types';

export interface G2bContract {
  contractNo: string; title: string; contractDate: string | null; institution: string | null; demandInstitution: string | null;
  supplyAmount: string | null; totalAmount: string | null; startDate: string | null; endDate: string | null; companies: string | null; raw: Record<string, unknown>;
}
export interface G2bSearch { from: string; to: string; keyword?: string; bizNo?: string }
export interface G2bProvider { readonly name: string; test(pc: ProviderContext): Promise<string>; search(pc: ProviderContext, q: G2bSearch): Promise<G2bContract[]> }

const DEFAULT_BASE = 'https://apis.data.go.kr/1230000/ao/CntrctInfoService';
const ymdhm = (d: string, end = false) => d.replace(/-/g, '') + (end ? '2359' : '0000');
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return String(o[k]).trim();
  return null;
};
const isoDate = (v: string | null) => {
  if (!v) return null;
  const m = v.replace(/\D/g, '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

export function mapG2b(it: Record<string, unknown>): G2bContract {
  const total = pick(it, 'totCntrctAmt', 'thtmCntrctAmt', 'cntrctAmt');
  const supply = pick(it, 'thtmCntrctSplyAmt', 'cntrctSplyAmt');
  return {
    contractNo: pick(it, 'untyCntrctNo', 'cntrctNo', 'dcsnCntrctNo') ?? '',
    title: pick(it, 'cnstwkNm', 'cntrctNm', 'bidNtceNm') ?? '(계약명 없음)',
    contractDate: isoDate(pick(it, 'cntrctCnclsDate', 'cntrctDate', 'cntrctCnclsDt')),
    institution: pick(it, 'cntrctInsttNm', 'cntrctInsttOfclNm'),
    demandInstitution: pick(it, 'dminsttNm', 'dmndInsttNm'),
    supplyAmount: supply ? supply.replace(/[^0-9]/g, '') : null,
    totalAmount: total ? total.replace(/[^0-9]/g, '') : null,
    startDate: isoDate(pick(it, 'cnstwkBgnDate', 'cntrctPrdBgnDate', 'thtmCnstwkBgnDate')),
    endDate: isoDate(pick(it, 'cnstwkCmpltnDate', 'cntrctPrdEndDate', 'thtmCnstwkCmpltnDate', 'ttalCnstwkCmpltnDate')),
    companies: pick(it, 'corpList', 'cntrctCorpList', 'corpNm'),
    raw: it,
  };
}

export class G2bOpenApi implements G2bProvider {
  readonly name = 'G2B_OPENAPI';
  private base(pc: ProviderContext) {
    return String(pc.settings.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  }
  private key(pc: ProviderContext) {
    const k = pc.secrets.serviceKey;
    if (!k) throw new ProviderError('서비스키가 없습니다', 'NO_KEY');
    return k;
  }
  async test(pc: ProviderContext) {
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const r = await this.search(pc, { from: today.slice(0, 8) + '01', to: today });
    return `연결됨 — 이번 달 공사 계약 ${r.length}건 조회`;
  }
  async search(pc: ProviderContext, q: G2bSearch) {
    if (Date.parse(q.to) - Date.parse(q.from) > 31 * 86400000) throw new ProviderError('나라장터 조회 기간은 한 번에 1개월 이내입니다', 'RANGE');
    const params = new URLSearchParams({ serviceKey: this.key(pc), numOfRows: '100', pageNo: '1', type: 'json', inqryDiv: '1', inqryBgnDt: ymdhm(q.from), inqryEndDt: ymdhm(q.to, true) });
    const url = `${this.base(pc)}/getCntrctInfoListCnstwk?${params}`;
    const r = await httpJson(url, { method: 'GET' });
    if (!r.ok) throw new ProviderError(`나라장터 응답 오류 (HTTP ${r.status})`, `HTTP_${r.status}`, false);
    if (/^\s*</.test(r.text)) {
      const msg = r.text.match(/<returnAuthMsg>([^<]+)/)?.[1] ?? r.text.match(/<resultMsg>([^<]+)/)?.[1] ?? 'XML 오류 응답';
      throw new ProviderError(`나라장터 오류: ${msg}`, 'G2B_ERROR', false);
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(r.text);
    } catch {
      throw new ProviderError('나라장터 응답을 읽을 수 없습니다', 'G2B_PARSE', false);
    }
    const header = body?.response?.header ?? body?.header;
    if (header && header.resultCode && !['00', '0'].includes(String(header.resultCode))) throw new ProviderError(`나라장터 오류: ${header.resultMsg ?? header.resultCode}`, `G2B_${header.resultCode}`, false);
    const items = body?.response?.body?.items ?? body?.body?.items ?? [];
    const list: Record<string, unknown>[] = Array.isArray(items) ? items : Array.isArray(items?.item) ? items.item : items?.item ? [items.item] : [];
    let out = list.map(mapG2b);
    if (q.keyword) out = out.filter((c) => [c.title, c.institution, c.demandInstitution].some((v) => v?.includes(q.keyword!)));
    if (q.bizNo) out = out.filter((c) => (c.companies ?? '').replace(/\D/g, '').includes(q.bizNo!.replace(/\D/g, '')));
    return out;
  }
}

/** 시연용 — 외부 호출 없이 고정 샘플 계약 3건 (운영 모드에서는 쓸 수 없음) */
export class G2bSample implements G2bProvider {
  readonly name = 'G2B_SAMPLE';
  async test() {
    return '샘플 연결 — 실제 나라장터를 조회하지 않습니다';
  }
  async search(_pc: ProviderContext, q: G2bSearch) {
    const base = q.from.slice(0, 8);
    const rows: G2bContract[] = [
      { contractNo: 'R26TA00918231', title: '○○초등학교 전기설비 개선공사', contractDate: `${base}05`, institution: '서울특별시교육청', demandInstitution: '서울○○초등학교', supplyAmount: '312000000', totalAmount: '343200000', startDate: `${base}10`, endDate: null, companies: '에스에스전력(주) 1018117536', raw: {} },
      { contractNo: 'R26TA00920114', title: '△△구청 청사 정보통신설비 교체공사', contractDate: `${base}12`, institution: '조달청 서울지방조달청', demandInstitution: '서울특별시 △△구', supplyAmount: '186500000', totalAmount: '205150000', startDate: `${base}15`, endDate: null, companies: '에스에스전력(주) 1018117536, 한빛통신기술 1078163213', raw: {} },
      { contractNo: 'R26TA00931007', title: '□□도서관 리모델링 건축공사', contractDate: `${base}20`, institution: '경기도 □□시', demandInstitution: '경기도 □□시', supplyAmount: '954000000', totalAmount: '1049400000', startDate: `${base}25`, endDate: null, companies: '에스에스건설 1048112345', raw: {} },
    ];
    const kw = q.keyword;
    return rows.filter((r) => !kw || [r.title, r.institution, r.demandInstitution].some((v) => v?.includes(kw))).filter((r) => !q.bizNo || (r.companies ?? '').includes(q.bizNo.replace(/\D/g, '')));
  }
}
