/**
 * CODEF — 홈택스 전자세금계산서 통합 조회 (매입·매출 수집)
 *  문서: docs/reference/CODEF_전자세금계산서_통합조회_API.pdf (2026-09-28 기준)
 *  - 토큰: https://oauth.codef.io/oauth/token (client_credentials, Basic 인증)
 *  - 요청: JSON 을 URL 인코딩해 본문으로 전송, 응답은 URL 디코딩 후 JSON
 *  - 비밀번호는 CODEF 공개키(RSA, PKCS#1 v1.5)로 암호화
 *  - 간편인증·보안카드 등 추가인증: CF-03002 + continue2Way → 사용자가 인증 후 is2Way 요청
 *  - 조회기간 3개월 단위로 나누어 요청
 */
import { constants, publicEncrypt } from 'crypto';
import { httpJson } from '../retry';
import { CollectRequest, CollectResult, CollectedInvoice, HometaxProvider, ProviderContext, ProviderError } from '../types';

const PATH = '/v1/kr/public/nt/tax-invoice/integrated-check-list';
const host = (mode: string) => (mode === 'LIVE' ? 'https://api.codef.io' : 'https://development.codef.io');
const tokens = new Map<string, { token: string; until: number }>();

export function codefEncodeBody(body: unknown) {
  return encodeURIComponent(JSON.stringify(body));
}
export function codefDecode(text: string) {
  const t = text.trim();
  const decoded = t.startsWith('{') ? t : decodeURIComponent(t.replace(/\+/g, ' '));
  return JSON.parse(decoded) as { result: { code: string; message: string; extraMessage?: string; transactionId?: string }; data: unknown };
}
export function rsaEncrypt(publicKeyB64: string, plain: string) {
  const body = publicKeyB64.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(plain, 'utf8')).toString('base64');
}

const ymd = (d: string) => d.replace(/-/g, '');
const iso = (d?: string | null) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);
const num = (v: unknown) => String(v ?? '').replace(/[^0-9.-]/g, '') || '0';

/** 3개월 단위로 기간 나누기 */
export function splitQuarters(from: string, to: string) {
  const out: [string, string][] = [];
  let s = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (s <= end) {
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 3, s.getUTCDate() - 1));
    const ee = e < end ? e : end;
    out.push([s.toISOString().slice(0, 10), ee.toISOString().slice(0, 10)]);
    s = new Date(ee.getTime() + 86400000);
  }
  return out;
}

export function mapCodefInvoice(x: Record<string, any>, inquiryType: string): CollectedInvoice {
  const lines = (Array.isArray(x.resTradeItemList) ? x.resTradeItemList : x.resTradeItemList ? [x.resTradeItemList] : []).map((l: Record<string, any>) => ({
    itemDate: iso(l.resPurchaseExpiryDate), name: l.resTaxItemName || null, spec: l.resStandards || null, qty: l.resQuantity || null,
    unitPrice: l.resUnitPrice || null, supplyAmount: num(l.resSupplyValue), vatAmount: num(l.resTaxAmt), remark: l.resNote || null,
  }));
  return {
    approvalNo: (x.resApprovalNo || '').replace(/\s/g, '') || null,
    writeDate: iso(x.resReportingDate) ?? iso(x.resIssueDate)!,
    issueDate: iso(x.resIssueDate),
    sendDate: iso(x.resSendDate),
    invoiceType: x.resETaxInvoiceType || null,
    docKind: inquiryType === '03' || inquiryType === '04' ? 'EXEMPT' : 'TAX',
    purpose: String(x.resReceiptOrCharge ?? '').includes('영수') ? 'RECEIPT' : 'CHARGE',
    supplier: { bizNo: num(x.resSupplierRegNumber).replace(/-/g, ''), name: x.resSupplierCompanyName, ceo: x.resSupplierName, address: x.resSupplierBusinessPlace, bizType: x.resSupplierBusinessTypes, bizItem: x.resSupplierBusinessItems, email: x.resEmail },
    buyer: { bizNo: num(x.resContractorRegNumber).replace(/-/g, ''), name: x.resContractorCompanyName, ceo: x.resContractorName, address: x.resContractorBusinessPlace, bizType: x.resContractorBusinessTypes, bizItem: x.resContractorBusinessItems, email: x.resEmail1 },
    supplyAmount: num(x.resSupplyValue),
    vatAmount: num(x.resTaxAmt),
    totalAmount: num(x.resTotalAmount),
    remark: x.resNote || null,
    modifyReason: x.resReasonModification && x.resReasonModification !== '해당없음' ? x.resReasonModification : null,
    lines,
    raw: x,
  };
}

export class CodefHometaxProvider implements HometaxProvider {
  readonly name = 'CODEF';

  private async token(pc: ProviderContext) {
    const id = pc.secrets.clientId, secret = pc.secrets.clientSecret;
    if (!id || !secret) throw new ProviderError('CODEF Client ID·Secret 이 설정되지 않았습니다 (관리 > 외부 연동)', 'NOT_CONFIGURED');
    const cached = tokens.get(id);
    if (cached && cached.until > Date.now()) return cached.token;
    const r = await httpJson('https://oauth.codef.io/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
      body: 'grant_type=client_credentials&scope=read',
    });
    if (!r.ok) throw new ProviderError(`CODEF 인증 실패 (HTTP ${r.status}) — Client ID·Secret 을 확인하세요`, 'AUTH_FAILED');
    const j = JSON.parse(r.text) as { access_token: string; expires_in: number };
    tokens.set(id, { token: j.access_token, until: Date.now() + (j.expires_in - 600) * 1000 });
    return j.access_token;
  }

  private async call(pc: ProviderContext, body: Record<string, unknown>) {
    const token = await this.token(pc);
    const r = await httpJson(host(pc.mode) + PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: codefEncodeBody(body),
      timeoutMs: 600_000,
    });
    if (r.status === 401) {
      tokens.delete(pc.secrets.clientId);
      throw new ProviderError('CODEF 토큰이 만료되었습니다. 다시 시도합니다', 'TOKEN_EXPIRED', true);
    }
    return codefDecode(r.text);
  }

  private loginBody(pc: ProviderContext, login: Record<string, string>) {
    const loginType = (login.loginType || (pc.settings.loginType as string) || '1') as '0' | '1' | '5';
    const pk = pc.secrets.publicKey;
    const enc = (v?: string) => {
      if (!v) return '';
      if (!pk) throw new ProviderError('CODEF 공개키(RSA)가 설정되지 않았습니다', 'NOT_CONFIGURED');
      return rsaEncrypt(pk, v);
    };
    const b: Record<string, unknown> = { organization: '0002', loginType };
    if (loginType === '1') {
      b.id = login.id || pc.secrets.hometaxId;
      b.userPassword = enc(login.password || pc.secrets.hometaxPassword);
      b.secureCardSkipYN = '1';
      if (!b.id) throw new ProviderError('홈택스 아이디가 없습니다', 'NOT_CONFIGURED');
    } else if (loginType === '0') {
      b.certType = '1';
      b.certFile = pc.secrets.certFile;
      b.keyFile = pc.secrets.keyFile;
      b.certPassword = enc(pc.secrets.certPassword);
      if (!b.certFile || !b.keyFile) throw new ProviderError('공동인증서 파일이 설정되지 않았습니다', 'NOT_CONFIGURED');
    } else {
      Object.assign(b, { loginTypeLevel: login.loginTypeLevel || '1', userName: login.userName, loginIdentity: login.loginIdentity, phoneNo: login.phoneNo, telecom: login.telecom ?? '', id: login.ssoId ?? '' });
      if (!login.userName || !login.loginIdentity || !login.phoneNo) throw new ProviderError('간편인증에는 이름·생년월일·휴대폰번호가 필요합니다', 'BAD_INPUT');
    }
    if (pc.settings.identity) b.identity = String(pc.settings.identity).replace(/-/g, '');
    return b;
  }

  private searchBody(req: CollectRequest, from: string, to: string, inquiryType: string) {
    return { inquiryType, searchType: '01', startDate: ymd(from), endDate: ymd(to), sortby: '1', orderBy: '1', transeType: req.direction === 'SALES' ? '01' : '02', type: '0' };
  }

  private interpret(res: ReturnType<typeof codefDecode>, inquiryType: string): { kind: 'DONE'; invoices: CollectedInvoice[] } | { kind: 'NEED_AUTH'; method: string; twoWayInfo: Record<string, unknown>; extraInfo?: Record<string, unknown>; message: string } {
    const code = res.result?.code;
    if (code === 'CF-03002') {
      const d = res.data as Record<string, any>;
      return { kind: 'NEED_AUTH', method: d.method ?? 'simpleAuth', twoWayInfo: { jobIndex: d.jobIndex, threadIndex: d.threadIndex, jti: d.jti, twoWayTimestamp: d.twoWayTimestamp }, extraInfo: d.extraInfo, message: '휴대폰(간편인증 앱)에서 인증을 완료한 뒤 [인증 완료]를 눌러 주세요' };
    }
    if (code === 'CF-00000') {
      const data = res.data;
      const list = Array.isArray(data) ? data : data && typeof data === 'object' && Object.keys(data).length ? [data] : [];
      return { kind: 'DONE', invoices: (list as Record<string, any>[]).filter((x) => x.resApprovalNo || x.resSupplyValue).map((x) => mapCodefInvoice(x, inquiryType)) };
    }
    const retryable = ['CF-00012', 'CF-09999', 'CF-12001'].includes(code);
    throw new ProviderError(`CODEF 오류 ${code}: ${res.result?.message ?? ''} ${res.result?.extraMessage ?? ''}`.trim(), code, retryable, res.result);
  }

  async test(pc: ProviderContext) {
    await this.token(pc);
    if (!pc.secrets.publicKey) throw new ProviderError('공개키(RSA)가 비어 있습니다', 'NOT_CONFIGURED');
    return `CODEF 인증 성공 (${pc.mode === 'LIVE' ? '정식' : '데모'} 서버)`;
  }

  private types(pc: ProviderContext) {
    return pc.settings.includeExempt ? ['01', '03'] : ['01'];
  }

  /** 문서 종류 × 3개월 구간을 차례로 조회. 추가인증이 필요하면 거기서 멈추고 지금까지 받은 자료를 함께 돌려준다 */
  private async run(pc: ProviderContext, req: CollectRequest, start: { typeIndex: number; from: string }, acc: CollectedInvoice[]): Promise<CollectResult> {
    const types = this.types(pc);
    for (let ti = start.typeIndex; ti < types.length; ti++) {
      const t = types[ti];
      for (const [f, e] of splitQuarters(ti === start.typeIndex ? start.from : req.from, req.to)) {
        const r = this.interpret(await this.call(pc, { ...this.loginBody(pc, req.login), ...this.searchBody(req, f, e, t) }), t);
        if (r.kind === 'NEED_AUTH') return { ...r, twoWayInfo: { ...r.twoWayInfo, _from: f, _to: e, _ti: ti }, partial: acc };
        acc.push(...r.invoices);
      }
    }
    return { kind: 'DONE', invoices: acc };
  }

  collect(pc: ProviderContext, req: CollectRequest) {
    return this.run(pc, req, { typeIndex: 0, from: req.from }, []);
  }

  async continueAuth(pc: ProviderContext, req: CollectRequest, twoWayInfo: Record<string, unknown>, answer: Record<string, string>): Promise<CollectResult> {
    const { _from, _to, _ti, ...info } = twoWayInfo as Record<string, string | number>;
    const ti = Number(_ti ?? 0);
    const t = this.types(pc)[ti];
    const body: Record<string, unknown> = { ...this.loginBody(pc, req.login), ...this.searchBody(req, String(_from), String(_to), t), is2Way: true, twoWayInfo: info };
    if (answer.secureCardNumber1) Object.assign(body, { secureCardNumber1: answer.secureCardNumber1, secureCardNumber2: answer.secureCardNumber2 });
    else body.simpleAuth = answer.simpleAuth ?? '1';
    const first = this.interpret(await this.call(pc, body), t);
    if (first.kind === 'NEED_AUTH') return { ...first, twoWayInfo: { ...first.twoWayInfo, _from, _to, _ti: ti }, partial: [] };
    // 인증된 세션으로 남은 구간 이어서 조회
    const next = new Date(Date.parse(String(_to)) + 86400000).toISOString().slice(0, 10);
    const start = next > req.to ? { typeIndex: ti + 1, from: req.from } : { typeIndex: ti, from: next };
    return this.run(pc, req, start, [...first.invoices]);
  }
}
