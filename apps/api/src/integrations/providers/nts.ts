/**
 * 국세청 사업자등록 상태조회 (공공데이터포털 data.go.kr 15081808)
 *  POST https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=… body {"b_no":[…]} (한 번에 100건)
 *  b_stt_cd: 01 계속사업자, 02 휴업자, 03 폐업자
 */
import { httpJson } from '../retry';
import { BizStatus, BizStatusProvider, ProviderContext, ProviderError } from '../types';

export class NtsBizStatusProvider implements BizStatusProvider {
  readonly name = 'NTS_OPENAPI';
  async check(pc: ProviderContext, bizNos: string[]): Promise<BizStatus[]> {
    const key = pc.secrets.serviceKey;
    if (!key) throw new ProviderError('공공데이터포털 서비스키가 설정되지 않았습니다 (관리 > 외부 연동)', 'NOT_CONFIGURED');
    const out: BizStatus[] = [];
    for (let i = 0; i < bizNos.length; i += 100) {
      const chunk = bizNos.slice(i, i + 100).map((b) => b.replace(/-/g, ''));
      const r = await httpJson(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}&returnType=JSON`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ b_no: chunk }),
      });
      if (!r.ok) throw new ProviderError(`사업자 상태조회 실패 (HTTP ${r.status}) ${r.text.slice(0, 200)}`, `HTTP_${r.status}`, false);
      const j = JSON.parse(r.text) as { data?: { b_no: string; b_stt: string; b_stt_cd: string; tax_type: string; end_dt: string }[] };
      for (const d of j.data ?? []) {
        out.push({
          bizNo: d.b_no, label: d.b_stt || d.tax_type || '확인 불가', taxType: d.tax_type,
          status: d.b_stt_cd === '01' ? 'ACTIVE' : d.b_stt_cd === '02' ? 'SUSPENDED' : d.b_stt_cd === '03' ? 'CLOSED' : 'UNKNOWN',
          closedDate: d.end_dt && /^\d{8}$/.test(d.end_dt) ? `${d.end_dt.slice(0, 4)}-${d.end_dt.slice(4, 6)}-${d.end_dt.slice(6)}` : null,
        });
      }
    }
    return out;
  }
  async test(pc: ProviderContext) {
    const [r] = await this.check(pc, ['1248100998']);
    return `국세청 상태조회 연결 성공 (예시 조회 결과: ${r?.label ?? '응답 없음'})`;
  }
}
