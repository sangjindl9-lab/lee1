/**
 * 전자세금계산서 발행 어댑터
 *  - POPBILL: 팝빌 공식 Node SDK (popbill). 테스트(IsTest)는 팝빌 테스트베드 — 국세청 전송은 모의 처리되므로 효력 없음
 *  - BAROBILL: 계약 후 바로빌 테스트 서버에서 필드 검증이 끝나야 사용 (검증 전에는 발행을 막는다)
 *  - SANDBOX: 내장 가상 발행 — 외부로 아무것도 보내지 않고 '가상 발행'으로만 표시. 법적 효력 없음
 */
import { IssueRequest, IssueResult, Mode, ProviderContext, ProviderError, TaxIssueProvider } from '../types';

const ymd = (d: string) => d.replace(/-/g, '');
const int = (v: string) => String(v).split('.')[0];

function popbillService(pc: ProviderContext) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TaxinvoiceService = require('popbill/lib/TaxinvoiceService');
  const linkId = String(pc.settings.linkId ?? '');
  if (!linkId || !pc.secrets.secretKey) throw new ProviderError('팝빌 LinkID·SecretKey 가 설정되지 않았습니다 (관리 > 외부 연동)', 'NOT_CONFIGURED');
  return new TaxinvoiceService({ LinkID: linkId, SecretKey: pc.secrets.secretKey, IsTest: pc.mode !== 'LIVE', IPRestrictOnOff: true, UseStaticIP: false, UseLocalTimeYN: true });
}
function call<T>(fn: (ok: (v: T) => void, err: (e: { code: number; message: string }) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn(resolve, (e) => reject(new ProviderError(`팝빌 오류 ${e?.code ?? ''}: ${e?.message ?? '알 수 없는 오류'}`, `POPBILL_${e?.code ?? 'ERR'}`, typeof e?.code === 'number' && (e.code === -99999999 || e.code === -11000000), e))),
  );
}
function popbillNts(info: { stateCode?: number; ntsresult?: string; ntsconfirmNum?: string }, mode: Mode): Omit<IssueResult, 'providerKey'> {
  const r = String(info.ntsresult ?? '');
  // 테스트 환경은 국세청 전송이 모의 처리되므로 어떤 결과든 '미전송'으로 본다
  if (mode !== 'LIVE') return { approvalNo: info.ntsconfirmNum ?? null, ntsStatus: 'NOT_SENT', message: '팝빌 테스트 환경 — 국세청에 전송되지 않습니다', raw: info };
  const ntsStatus = /성공|완료/.test(r) ? 'SENT' : /실패/.test(r) ? 'FAILED' : 'WAITING';
  return { approvalNo: info.ntsconfirmNum ?? null, ntsStatus, message: r || `상태코드 ${info.stateCode ?? ''}`, raw: info };
}

export class PopbillIssueProvider implements TaxIssueProvider {
  readonly name = 'POPBILL';
  isLegal(mode: Mode) {
    return mode === 'LIVE';
  }
  async test(pc: ProviderContext) {
    const svc = popbillService(pc);
    const corp = String(pc.settings.corpNum ?? '').replace(/-/g, '');
    if (!/^\d{10}$/.test(corp)) throw new ProviderError('팝빌 회원 사업자번호(10자리)를 입력해 주세요', 'NOT_CONFIGURED');
    const bal = await call<number>((ok, err) => svc.getBalance(corp, ok, err));
    return `팝빌 연결 성공 (${pc.mode === 'LIVE' ? '운영' : '테스트'}) · 잔여 포인트 ${bal}`;
  }
  async issue(pc: ProviderContext, req: IssueRequest): Promise<IssueResult> {
    const svc = popbillService(pc);
    const corp = req.supplier.bizNo;
    const ti = {
      issueType: '정발행', chargeDirection: '정과금', writeDate: ymd(req.writeDate), purposeType: req.purpose === 'RECEIPT' ? '영수' : '청구',
      taxType: req.taxType === 'EXEMPT' ? '면세' : req.taxType === 'ZERO' ? '영세' : '과세',
      supplyCostTotal: int(req.supplyAmount), taxTotal: int(req.vatAmount), totalAmount: int(req.totalAmount),
      invoicerCorpNum: req.supplier.bizNo, invoicerMgtKey: req.mgtKey, invoicerCorpName: req.supplier.name, invoicerCEOName: req.supplier.ceo,
      invoicerAddr: req.supplier.address ?? '', invoicerBizType: req.supplier.bizType ?? '', invoicerBizClass: req.supplier.bizItem ?? '', invoicerEmail: req.supplier.email ?? '',
      invoiceeType: '사업자', invoiceeCorpNum: req.buyer.bizNo, invoiceeCorpName: req.buyer.name, invoiceeCEOName: req.buyer.ceo,
      invoiceeAddr: req.buyer.address ?? '', invoiceeBizType: req.buyer.bizType ?? '', invoiceeBizClass: req.buyer.bizItem ?? '', invoiceeEmail1: req.buyer.email ?? '',
      remark1: req.remark ?? '',
      ...(req.modifyCode ? { modifyCode: req.modifyCode, orgNTSConfirmNum: req.originalApprovalNo } : {}),
      detailList: req.lines.slice(0, 99).map((l) => ({ serialNum: l.lineNo, purchaseDT: l.itemDate ? ymd(l.itemDate) : ymd(req.writeDate), itemName: l.name ?? '', spec: l.spec ?? '', qty: l.qty ?? '', unitCost: l.unitPrice ?? '', supplyCost: int(l.supplyAmount), tax: int(l.vatAmount), remark: l.remark ?? '' })),
    };
    const r = await call<{ code: number; message: string; ntsConfirmNum?: string }>((ok, err) => svc.registIssue(corp, ti, false, false, '', '', '', '', ok, err));
    const st = pc.mode === 'LIVE' ? { approvalNo: r.ntsConfirmNum ?? null, ntsStatus: 'WAITING' as const, message: '발행 완료 — 국세청 전송 대기 (보통 다음 날 전송)' } : { approvalNo: r.ntsConfirmNum ?? null, ntsStatus: 'NOT_SENT' as const, message: '팝빌 테스트 환경 발행 — 국세청에 전송되지 않으며 법적 효력이 없습니다' };
    return { ...st, providerKey: req.mgtKey, raw: r };
  }
  async status(pc: ProviderContext, providerKey: string, corpNum: string) {
    const svc = popbillService(pc);
    const info = await call<{ stateCode?: number; ntsresult?: string; ntsconfirmNum?: string }>((ok, err) => svc.getInfo(corpNum, 'SELL', providerKey, ok, err));
    return popbillNts(info, pc.mode);
  }
  async cancel(pc: ProviderContext, providerKey: string, corpNum: string, memo: string) {
    const svc = popbillService(pc);
    await call((ok, err) => svc.cancelIssue(corpNum, 'SELL', providerKey, memo, ok, err));
  }
}

export class BarobillIssueProvider implements TaxIssueProvider {
  readonly name = 'BAROBILL';
  isLegal(mode: Mode) {
    return mode === 'LIVE';
  }
  private notReady(): never {
    throw new ProviderError('바로빌 발행 연동은 바로빌 계약 후 연동인증키(CERTKEY)로 테스트 서버(testws.baroservice.com)에서 항목 검증을 마쳐야 사용할 수 있습니다. 지금은 팝빌 또는 가상 발행을 선택하세요', 'NOT_VERIFIED');
  }
  async test(pc: ProviderContext): Promise<string> {
    if (!pc.secrets.certKey) throw new ProviderError('바로빌 연동인증키(CERTKEY)가 없습니다', 'NOT_CONFIGURED');
    return this.notReady();
  }
  issue(): Promise<IssueResult> {
    return this.notReady();
  }
  status(): Promise<Omit<IssueResult, 'providerKey'>> {
    return this.notReady();
  }
  cancel(): Promise<void> {
    return this.notReady();
  }
}

/** 내장 가상 발행 — 외부로 보내지 않는다. 화면에는 항상 '가상 발행(효력 없음)'으로 표시 */
export class SandboxIssueProvider implements TaxIssueProvider {
  readonly name = 'SANDBOX';
  isLegal() {
    return false;
  }
  async test() {
    return '가상 발행 모드 — 외부 연동 없이 발행 흐름만 확인합니다 (국세청 전송 없음)';
  }
  async issue(_pc: ProviderContext, req: IssueRequest): Promise<IssueResult> {
    return { approvalNo: null, providerKey: req.mgtKey, ntsStatus: 'NOT_SENT', message: '가상 발행 — 국세청에 전송되지 않았으며 법적 효력이 없습니다' };
  }
  async status() {
    return { approvalNo: null, ntsStatus: 'NOT_SENT' as const, message: '가상 발행 — 국세청 미전송' };
  }
  async cancel() {
    /* 외부 연동 없음 */
  }
}
