/**
 * 외부 연동 설정·실행 기록
 *  - 기능(kind)마다 공급업체(provider)를 고르고 테스트/운영 모드를 분리한다.
 *  - API 키·비밀번호는 AES-256-GCM 으로 암호화 저장, 화면·응답에는 '설정됨'만 보낸다.
 *  - 모든 외부 호출은 integration_job 에 기록되고, 일시 장애는 자동 재시도한다.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { decryptField, encryptField } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { companies, integrationConfigs, integrationJobs } from '../db/schema';
import { CodefHometaxProvider } from './providers/codef';
import { NtsBizStatusProvider } from './providers/nts';
import { AnthropicOcr, BuiltinPdfOcr, ClovaOcr, SampleOcr } from './providers/ocr';
import { BarobillIssueProvider, PopbillIssueProvider, SandboxIssueProvider } from './providers/tax-issue';
import { withRetry } from './retry';
import { BizStatusProvider, HometaxProvider, IntegrationKind, Mode, OcrProvider, ProviderContext, ProviderError, TaxIssueProvider } from './types';

interface FieldDef { key: string; label: string; secret?: boolean; required?: boolean; help?: string; type?: 'text' | 'textarea' | 'select' | 'checkbox'; options?: { value: string; label: string }[] }
interface ProviderDef { id: string; label: string; description: string; fields: FieldDef[]; testOnly?: boolean; verified: boolean; docs?: string }

export const CATALOG: Record<IntegrationKind, { label: string; description: string; providers: ProviderDef[] }> = {
  TAX_ISSUE: {
    label: '전자세금계산서 발행', description: '매출 세금계산서를 국세청에 발행·전송합니다. 테스트 모드 발행은 법적 효력이 없습니다.',
    providers: [
      { id: 'POPBILL', label: '팝빌 (POPBiLL)', description: '팝빌 연동회원 가입 후 발급받은 LinkID·SecretKey 사용. 테스트 모드는 팝빌 테스트베드(국세청 미전송)', verified: true, docs: 'https://developers.popbill.com',
        fields: [{ key: 'linkId', label: 'LinkID', required: true }, { key: 'secretKey', label: 'SecretKey', secret: true, required: true }, { key: 'corpNum', label: '팝빌 회원 사업자번호', required: true, help: '우리 회사 사업자번호 (숫자 10자리)' }] },
      { id: 'BAROBILL', label: '바로빌 (BaroBill)', description: '연동인증키(CERTKEY) 필요. 계약 후 테스트 서버에서 항목 검증을 마쳐야 발행할 수 있습니다', verified: false, docs: 'https://dev.barobill.co.kr',
        fields: [{ key: 'certKey', label: '연동인증키 (CERTKEY)', secret: true, required: true }, { key: 'corpNum', label: '사업자번호', required: true }, { key: 'userId', label: '바로빌 아이디' }] },
      { id: 'SANDBOX', label: '가상 발행 (연동 없음)', description: '외부로 보내지 않고 발행 흐름만 확인합니다. 화면·출력물에 "가상 발행(효력 없음)"으로 표시됩니다', verified: true, testOnly: true, fields: [] },
    ],
  },
  HOMETAX: {
    label: '홈택스 세금계산서 수집', description: '홈택스의 매입·매출 전자세금계산서를 가져옵니다. 키가 없으면 홈택스에서 내려받은 엑셀을 올려도 됩니다.',
    providers: [
      { id: 'CODEF', label: 'CODEF (코드에프)', description: '전자세금계산서 통합 조회 API. 데모 서버(테스트)·정식 서버(운영) 구분', verified: true, docs: 'https://developer.codef.io',
        fields: [
          { key: 'clientId', label: 'Client ID', secret: true, required: true }, { key: 'clientSecret', label: 'Client Secret', secret: true, required: true },
          { key: 'publicKey', label: 'RSA 공개키 (Public Key)', secret: true, required: true, type: 'textarea', help: 'CODEF 홈페이지 > 키 관리에서 복사' },
          { key: 'loginType', label: '홈택스 로그인 방식', type: 'select', options: [{ value: '1', label: '홈택스 아이디' }, { value: '0', label: '공동인증서' }, { value: '5', label: '간편인증 (수집할 때마다 휴대폰 인증)' }] },
          { key: 'hometaxId', label: '홈택스 아이디', secret: true, help: '아이디 로그인일 때' }, { key: 'hometaxPassword', label: '홈택스 비밀번호', secret: true, help: '아이디 로그인일 때 — CODEF 공개키로 다시 암호화해 전송' },
          { key: 'certFile', label: '인증서 der 파일 (Base64)', secret: true, type: 'textarea' }, { key: 'keyFile', label: '인증서 key 파일 (Base64)', secret: true, type: 'textarea' }, { key: 'certPassword', label: '인증서 비밀번호', secret: true },
          { key: 'identity', label: '사업자번호 (여러 사업장일 때)' }, { key: 'includeExempt', label: '면세 계산서도 수집', type: 'checkbox' },
        ] },
    ],
  },
  BIZ_STATUS: {
    label: '사업자 휴폐업 조회', description: '국세청 사업자등록 상태(계속·휴업·폐업)를 조회해 거래처에 표시합니다.',
    providers: [{ id: 'NTS_OPENAPI', label: '국세청 사업자등록 상태조회 (공공데이터포털)', description: 'data.go.kr 에서 활용신청 후 받은 일반 인증키(Decoding)', verified: true, docs: 'https://www.data.go.kr/data/15081808/openapi.do', fields: [{ key: 'serviceKey', label: '서비스키', secret: true, required: true }] }],
  },
  OCR: {
    label: '문서 인식 (OCR·AI)', description: '발주서·거래명세표·세금계산서·영수증 사진/PDF에서 품목과 금액을 읽습니다. 결과는 사람이 확인한 뒤에만 등록됩니다.',
    providers: [
      { id: 'BUILTIN_PDF', label: '내장 PDF 인식', description: '글자가 들어 있는 전자 PDF를 외부 전송 없이 읽습니다. 사진·스캔본은 읽지 못합니다', verified: true, fields: [] },
      { id: 'ANTHROPIC', label: 'AI 문서인식 (Claude)', description: '사진·스캔본·PDF 모두. Anthropic API 키 필요 (문서가 Anthropic 으로 전송됨)', verified: true, docs: 'https://docs.claude.com', fields: [{ key: 'apiKey', label: 'API 키', secret: true, required: true }, { key: 'model', label: '모델', help: '비워 두면 claude-sonnet-5-5' }] },
      { id: 'CLOVA', label: '네이버 CLOVA OCR', description: 'General OCR 도메인의 Invoke URL·Secret Key 필요', verified: true, docs: 'https://api.ncloud-docs.com/docs/ai-application-service-ocr', fields: [{ key: 'invokeUrl', label: 'APIGW Invoke URL', required: true }, { key: 'secretKey', label: 'Secret Key', secret: true, required: true }] },
      { id: 'SAMPLE', label: '샘플 인식 (테스트 전용)', description: '어떤 파일을 올려도 같은 샘플 결과 — 시연·교육용. 운영 모드에서는 사용할 수 없습니다', verified: true, testOnly: true, fields: [] },
    ],
  },
};

const DEFAULTS: Partial<Record<IntegrationKind, { provider: string; mode: Mode; enabled: boolean }>> = {
  TAX_ISSUE: { provider: 'SANDBOX', mode: 'TEST', enabled: true },
  OCR: { provider: 'BUILTIN_PDF', mode: 'LIVE', enabled: true },
};

const PROVIDERS = {
  TAX_ISSUE: { POPBILL: new PopbillIssueProvider(), BAROBILL: new BarobillIssueProvider(), SANDBOX: new SandboxIssueProvider() } as Record<string, TaxIssueProvider>,
  HOMETAX: { CODEF: new CodefHometaxProvider() } as Record<string, HometaxProvider>,
  BIZ_STATUS: { NTS_OPENAPI: new NtsBizStatusProvider() } as Record<string, BizStatusProvider>,
  OCR: { BUILTIN_PDF: new BuiltinPdfOcr(), ANTHROPIC: new AnthropicOcr(), CLOVA: new ClovaOcr(), SAMPLE: new SampleOcr() } as Record<string, OcrProvider>,
};
type ProviderOf<K extends IntegrationKind> = K extends 'TAX_ISSUE' ? TaxIssueProvider : K extends 'HOMETAX' ? HometaxProvider : K extends 'BIZ_STATUS' ? BizStatusProvider : OcrProvider;

const SaveDto = z.object({
  provider: z.string().min(1).max(30),
  mode: z.enum(['TEST', 'LIVE']),
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()).default({}),
  /** 값이 있으면 교체, null 이면 삭제, 빠진 키는 유지 */
  secrets: z.record(z.string(), z.string().max(20000).nullable()).default({}),
});

@Injectable()
export class IntegrationsService {
  /** 테스트에서 공급업체를 가짜로 바꿔 끼우기 위한 덮어쓰기 */
  static overrides: Partial<Record<IntegrationKind, Record<string, unknown>>> = {};

  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  async resolve<K extends IntegrationKind>(companyId: string, kind: K): Promise<{ provider: ProviderOf<K>; pc: ProviderContext; providerId: string; enabled: boolean } | null> {
    const [c] = await this.db.select().from(integrationConfigs).where(and(eq(integrationConfigs.companyId, companyId), eq(integrationConfigs.kind, kind)));
    const def = DEFAULTS[kind];
    if (!c && !def) return null;
    const providerId = c?.provider ?? def!.provider;
    const mode = (c?.mode ?? def!.mode) as Mode;
    const enabled = c ? c.enabled : def!.enabled;
    const provider = ((IntegrationsService.overrides[kind] ?? {})[providerId] ?? (PROVIDERS[kind] as Record<string, unknown>)[providerId]) as ProviderOf<K> | undefined;
    if (!provider) return null;
    let secrets: Record<string, string> = {};
    if (c?.secretsEnc) {
      try {
        secrets = JSON.parse(decryptField(c.secretsEnc));
      } catch {
        throw new ProviderError('저장된 연동 비밀값을 읽을 수 없습니다 (암호화 키가 바뀌었는지 확인)', 'SECRET_DECRYPT');
      }
    }
    const settings = { ...(c?.settings ?? {}) };
    if ((kind === 'TAX_ISSUE') && !settings.corpNum) {
      const [co] = await this.db.select({ bizRegNo: companies.bizRegNo }).from(companies).where(eq(companies.id, companyId));
      settings.corpNum = co?.bizRegNo;
    }
    return { provider, pc: { mode, settings, secrets }, providerId, enabled };
  }

  async require<K extends IntegrationKind>(companyId: string, kind: K) {
    const r = await this.resolve(companyId, kind);
    if (!r || !r.enabled) throw new BadRequestException({ code: 'INTEGRATION_OFF', message: `${CATALOG[kind].label} 연동이 설정되지 않았습니다. 관리 > 외부 연동에서 설정하세요` });
    return r;
  }

  /** 외부 호출 실행 + 기록 + 재시도 */
  async run<T>(ctx: AccessContext, kind: IntegrationKind, providerId: string, mode: Mode, action: string, fn: (attempt: number) => Promise<T>, opts: { summary?: string; attempts?: number; resultOf?: (v: T) => unknown; jobId?: string; /** 후속 처리(저장 등)가 끝난 뒤 호출한 쪽이 직접 완료 처리 */ leaveOpen?: boolean } = {}) {
    const jobId = opts.jobId ?? (await this.db.insert(integrationJobs).values({ companyId: ctx.companyId!, kind, provider: providerId, mode, action, summary: opts.summary, createdById: ctx.user.id, createdByName: ctx.user.name }).returning())[0].id;
    try {
      const { value, attempts } = await withRetry(fn, {
        attempts: opts.attempts ?? 3,
        baseMs: process.env.NODE_ENV === 'test' ? 5 : 800,
        onRetry: (a, e) => this.db.update(integrationJobs).set({ attempts: a, errorMessage: `재시도 중: ${(e as Error).message}` }).where(eq(integrationJobs.id, jobId)).then(() => undefined),
      });
      if (opts.leaveOpen) await this.db.update(integrationJobs).set({ attempts }).where(eq(integrationJobs.id, jobId));
      else await this.db.update(integrationJobs).set({ status: 'SUCCESS', attempts, finishedAt: new Date(), errorMessage: null, result: (opts.resultOf?.(value) ?? null) as never }).where(eq(integrationJobs.id, jobId));
      return { jobId, value };
    } catch (e) {
      const pe = e as ProviderError & { attempts?: number };
      await this.db.update(integrationJobs).set({ status: 'FAILED', attempts: pe.attempts ?? 1, finishedAt: new Date(), errorCode: pe.code ?? 'ERROR', errorMessage: pe.message?.slice(0, 1000) }).where(eq(integrationJobs.id, jobId));
      throw Object.assign(e as object, { jobId });
    }
  }

  async list(ctx: AccessContext) {
    const rows = await this.db.select().from(integrationConfigs).where(eq(integrationConfigs.companyId, ctx.companyId!));
    return (Object.keys(CATALOG) as IntegrationKind[]).map((kind) => {
      const c = rows.find((r) => r.kind === kind);
      const def = DEFAULTS[kind];
      return {
        kind, ...CATALOG[kind],
        config: c ? { provider: c.provider, mode: c.mode, enabled: c.enabled, settings: c.settings, secretKeys: c.secretKeys, lastTestAt: c.lastTestAt, lastTestOk: c.lastTestOk, lastTestMessage: c.lastTestMessage, updatedAt: c.updatedAt }
          : def ? { provider: def.provider, mode: def.mode, enabled: def.enabled, settings: {}, secretKeys: [], lastTestAt: null, lastTestOk: null, lastTestMessage: null, updatedAt: null, isDefault: true } : null,
      };
    });
  }

  async save(ctx: AccessContext, kind: IntegrationKind, dto: z.infer<typeof SaveDto>) {
    const cat = CATALOG[kind];
    const pdef = cat.providers.find((p) => p.id === dto.provider);
    if (!pdef) throw new BadRequestException({ code: 'BAD_PROVIDER', message: '지원하지 않는 공급업체입니다' });
    if (pdef.testOnly && dto.mode === 'LIVE' && kind !== 'TAX_ISSUE') throw new BadRequestException({ code: 'TEST_ONLY', message: `${pdef.label}은(는) 테스트 모드에서만 사용할 수 있습니다` });
    if (pdef.testOnly && kind === 'TAX_ISSUE' && dto.mode === 'LIVE') throw new BadRequestException({ code: 'TEST_ONLY', message: '가상 발행은 운영 모드로 쓸 수 없습니다. 실제 발행은 팝빌 등 연동사를 선택하세요' });
    const [cur] = await this.db.select().from(integrationConfigs).where(and(eq(integrationConfigs.companyId, ctx.companyId!), eq(integrationConfigs.kind, kind)));
    let secrets: Record<string, string> = {};
    if (cur?.secretsEnc && cur.provider === dto.provider) secrets = JSON.parse(decryptField(cur.secretsEnc));
    const allowed = new Set(pdef.fields.filter((f) => f.secret).map((f) => f.key));
    for (const [k, v] of Object.entries(dto.secrets)) {
      if (!allowed.has(k)) continue;
      if (v === null) delete secrets[k];
      else if (v.trim()) secrets[k] = v.trim();
    }
    const settings = Object.fromEntries(Object.entries(dto.settings).filter(([k]) => pdef.fields.some((f) => f.key === k && !f.secret)));
    const missing = pdef.fields.filter((f) => f.required && (f.secret ? !secrets[f.key] : !settings[f.key] && !(kind === 'TAX_ISSUE' && f.key === 'corpNum'))).map((f) => f.label);
    if (dto.enabled && missing.length) throw new BadRequestException({ code: 'MISSING_FIELDS', message: `사용하려면 다음 값이 필요합니다: ${missing.join(', ')}` });
    const values = {
      provider: dto.provider, mode: dto.mode, enabled: dto.enabled, settings, secretsEnc: Object.keys(secrets).length ? encryptField(JSON.stringify(secrets)) : null, secretKeys: Object.keys(secrets),
      updatedById: ctx.user.id, updatedAt: new Date(),
    };
    await this.db.transaction(async (tx) => {
      if (cur) await tx.update(integrationConfigs).set({ ...values, lastTestAt: null, lastTestOk: null, lastTestMessage: null }).where(eq(integrationConfigs.id, cur.id));
      else await tx.insert(integrationConfigs).values({ ...values, companyId: ctx.companyId!, kind, createdById: ctx.user.id });
      await this.audit.fromCtx(ctx, {
        action: 'UPDATE', resource: 'integration', resourceId: kind,
        summary: `외부 연동 설정: ${cat.label} → ${pdef.label} (${dto.mode === 'LIVE' ? '운영' : '테스트'}, ${dto.enabled ? '사용' : '사용 안 함'})${cur && cur.mode !== dto.mode ? ` · 모드 변경 ${cur.mode}→${dto.mode}` : ''}`,
        before: cur ? { provider: cur.provider, mode: cur.mode, enabled: cur.enabled, settings: cur.settings, secretKeys: cur.secretKeys } : null,
        after: { provider: dto.provider, mode: dto.mode, enabled: dto.enabled, settings, secretKeys: Object.keys(secrets) },
      }, tx);
    });
    return this.list(ctx);
  }

  async test(ctx: AccessContext, kind: IntegrationKind) {
    const r = await this.resolve(ctx.companyId!, kind);
    if (!r) throw new BadRequestException({ code: 'INTEGRATION_OFF', message: '먼저 공급업체를 선택해 저장하세요' });
    let ok = false;
    let message = '';
    try {
      const { value } = await this.run(ctx, kind, r.providerId, r.pc.mode, 'TEST', () => (r.provider as { test(pc: ProviderContext): Promise<string> }).test(r.pc), { attempts: 1, summary: '연결 테스트' });
      ok = true;
      message = value;
    } catch (e) {
      message = (e as Error).message;
    }
    await this.db.update(integrationConfigs).set({ lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 500) }).where(and(eq(integrationConfigs.companyId, ctx.companyId!), eq(integrationConfigs.kind, kind)));
    return { ok, message };
  }

  async jobs(ctx: AccessContext, kind?: string, limit = 50) {
    return this.db.select().from(integrationJobs).where(and(eq(integrationJobs.companyId, ctx.companyId!), ...(kind ? [eq(integrationJobs.kind, kind)] : []))).orderBy(desc(integrationJobs.startedAt)).limit(limit);
  }

  async job(ctx: AccessContext, id: string) {
    const [j] = await this.db.select().from(integrationJobs).where(and(eq(integrationJobs.id, id), eq(integrationJobs.companyId, ctx.companyId!)));
    return j ?? null;
  }
}

const KindParam = z.enum(['TAX_ISSUE', 'HOMETAX', 'BIZ_STATUS', 'OCR']);

@ApiTags('관리 · 외부 연동')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get()
  @RequirePermission('integration', 'read')
  list(@Ctx() ctx: AccessContext) {
    return this.svc.list(ctx);
  }

  /** 다른 화면에서 '연동됨/미연동' 표시용 (비밀값 없음) */
  @Get('status')
  async status(@Ctx() ctx: AccessContext) {
    const out: Record<string, { provider: string; mode: string; enabled: boolean; verified: boolean; testOnly: boolean; label: string } | null> = {};
    for (const kind of Object.keys(CATALOG) as IntegrationKind[]) {
      const r = await this.svc.resolve(ctx.companyId!, kind).catch(() => null);
      const p = r ? CATALOG[kind].providers.find((x) => x.id === r.providerId) : null;
      out[kind] = r && p ? { provider: r.providerId, mode: r.pc.mode, enabled: r.enabled, verified: p.verified, testOnly: !!p.testOnly, label: p.label } : null;
    }
    return out;
  }

  @Put(':kind')
  @RequirePermission('integration', 'update')
  save(@Ctx() ctx: AccessContext, @Param('kind', new ZodPipe(KindParam)) kind: IntegrationKind, @Body(new ZodPipe(SaveDto)) dto: z.infer<typeof SaveDto>) {
    return this.svc.save(ctx, kind, dto);
  }

  @Post(':kind/test')
  @HttpCode(200)
  @RequirePermission('integration', 'update')
  test(@Ctx() ctx: AccessContext, @Param('kind', new ZodPipe(KindParam)) kind: IntegrationKind) {
    return this.svc.test(ctx, kind);
  }

  @Get('jobs')
  @RequirePermission('integration', 'read')
  jobs(@Ctx() ctx: AccessContext, @Query('kind') kind?: string) {
    return this.svc.jobs(ctx, kind && /^[A-Z_]{2,20}$/.test(kind) ? kind : undefined);
  }
}
