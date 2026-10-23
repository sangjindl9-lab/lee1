import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPublicKey, verify } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { formatBizNo, normalizeBizNo } from '../common/bizno';
import { DB, DB_TOKEN } from '../db/db';
import { companies, licenseState, systemSettings, users } from '../db/schema';

/**
 * 판매자 공개키 (Ed25519). 대응하는 비밀키는 판매자(라이선스 발급 관리 사이트)만 보관하며 고객 배포본에 절대 포함하지 않는다.
 * 키 교체 시 LICENSE_PUBLIC_KEY 환경변수(PEM 을 base64 로 인코딩)로 덮어쓸 수 있다.
 */
const VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAzmZz2pV35OlM8U9UfB43y8mY46XE47sG/pPLh9nsmNc=
-----END PUBLIC KEY-----`;

const TRIAL_DAYS = 30;
const TRIAL_MAX_USERS = 10;
/** 만료 며칠 전부터 화면에 갱신 안내를 띄우는지 */
export const RENEW_NOTICE_DAYS = 30;
/** 발급 서버에 갱신 라이선스를 확인하는 간격 */
const SYNC_INTERVAL_MS = 6 * 3600_000;
const ACTIVATION_KEY = 'license_activation_code';
const LAST_SYNC_KEY = 'license_last_sync';
const APP_VERSION = '1.0.0';

const Payload = z.object({
  licenseId: z.string(),
  licensee: z.string(),
  bizRegNo: z.string(),
  maxUsers: z.number().int().positive(),
  issuedAt: z.string(),
  expiresAt: z.string(), // YYYY-MM-DD (해당일 23:59:59 KST 까지 유효)
  modules: z.array(z.string()).default([]),
  edition: z.string().default('standard'),
  /** HOSTED(공급사 서버에서 운영) | ONPREM(고객사 설치) — 표시용 */
  deployment: z.string().optional(),
});
export type LicensePayload = z.infer<typeof Payload>;

export interface LicenseStatus {
  mode: 'TRIAL' | 'LICENSED' | 'EXPIRED' | 'INVALID';
  licenseId?: string;
  licensee?: string;
  bizRegNo?: string;
  edition?: string;
  maxUsers: number;
  activeUsers: number;
  issuedAt?: string;
  expiresAt: string;
  daysLeft: number;
  writable: boolean;
  /** 만료가 가까워 갱신 안내가 필요한지 */
  renewSoon: boolean;
  message: string;
  online: { connected: boolean; lastSyncAt: string | null; lastError: string | null };
}

function publicKeyPem() {
  return config.LICENSE_PUBLIC_KEY ? Buffer.from(config.LICENSE_PUBLIC_KEY, 'base64').toString() : VENDOR_PUBLIC_KEY;
}

export function parseLicense(text: string, pem = publicKeyPem()): LicensePayload {
  const clean = text.trim().replace(/\s+/g, '');
  const [body, sig] = clean.split('.');
  if (!body || !sig) throw new Error('라이선스 형식이 올바르지 않습니다');
  let ok = false;
  try {
    ok = verify(null, Buffer.from(body), createPublicKey(pem), Buffer.from(sig, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('라이선스 서명이 올바르지 않습니다. 발급받은 원문을 그대로 붙여 넣어 주세요');
  return Payload.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
}

const endOf = (p: LicensePayload) => new Date(p.expiresAt + 'T23:59:59+09:00').getTime();

@Injectable()
export class LicenseService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('License');
  private cache: { at: number; status: LicenseStatus } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;

  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  onModuleInit() {
    if (config.NODE_ENV === 'test' || !config.LICENSE_SERVER_URL) return;
    // 서버가 뜬 직후 한 번, 이후 6시간마다 발급 서버에서 갱신된 라이선스를 받아 온다
    setTimeout(() => void this.sync().catch(() => undefined), 15_000).unref();
    this.timer = setInterval(() => void this.sync().catch(() => undefined), SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async setting(key: string): Promise<string | null> {
    const [row] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return row ? String(row.value) : null;
  }

  private async putSetting(key: string, value: string) {
    await this.db.insert(systemSettings).values({ key, value }).onConflictDoUpdate({ target: systemSettings.key, set: { value } });
  }

  private async installDate(): Promise<Date> {
    const v = await this.setting('install_date');
    if (v) return new Date(v);
    await this.db.insert(systemSettings).values({ key: 'install_date', value: new Date().toISOString() }).onConflictDoNothing();
    return new Date((await this.setting('install_date'))!);
  }

  /** 이 서버에 등록된 회사들의 사업자등록번호 */
  private async companyBizNos(): Promise<string[]> {
    return (await this.db.select({ b: companies.bizRegNo }).from(companies)).map((r) => normalizeBizNo(r.b));
  }

  /** 서명 + 사업자등록번호 확인. 다른 회사용 라이선스는 받지 않는다 */
  private async verifyForThisServer(text: string): Promise<LicensePayload> {
    const p = parseLicense(text);
    const bizNos = await this.companyBizNos();
    if (bizNos.length && !bizNos.includes(normalizeBizNo(p.bizRegNo))) {
      throw new Error(`이 라이선스는 사업자등록번호 ${formatBizNo(p.bizRegNo)}(${p.licensee}) 전용입니다. 회사 정보의 사업자등록번호를 확인해 주세요`);
    }
    return p;
  }

  async status(force = false): Promise<LicenseStatus> {
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.status;
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.status, 'ACTIVE'));
    const [row] = await this.db.select().from(licenseState).where(eq(licenseState.id, 1));
    const online = { connected: !!(config.LICENSE_SERVER_URL && (await this.activationCode())), lastSyncAt: await this.setting(LAST_SYNC_KEY), lastError: this.lastError };
    const now = Date.now();
    let status: LicenseStatus;
    if (row) {
      try {
        const p = await this.verifyForThisServer(row.licenseText);
        const end = endOf(p);
        const daysLeft = Math.ceil((end - now) / 86400000);
        const expired = end < now;
        status = {
          mode: expired ? 'EXPIRED' : 'LICENSED', licenseId: p.licenseId, licensee: p.licensee, bizRegNo: p.bizRegNo, edition: p.edition,
          maxUsers: p.maxUsers, activeUsers: n, issuedAt: p.issuedAt, expiresAt: p.expiresAt, daysLeft, writable: !expired,
          renewSoon: !expired && daysLeft <= RENEW_NOTICE_DAYS,
          message: expired ? '라이선스가 만료되어 조회만 가능합니다. 공급사에 갱신을 요청해 주세요' : daysLeft <= RENEW_NOTICE_DAYS ? `라이선스가 ${daysLeft}일 뒤 만료됩니다. 공급사에 갱신을 요청해 주세요` : `${p.licensee} 정식 라이선스`,
          online,
        };
      } catch (e) {
        status = { mode: 'INVALID', maxUsers: 0, activeUsers: n, expiresAt: '', daysLeft: 0, writable: false, renewSoon: false, message: (e as Error).message, online };
      }
    } else {
      const start = await this.installDate();
      const end = start.getTime() + TRIAL_DAYS * 86400000;
      const daysLeft = Math.ceil((end - now) / 86400000);
      status = {
        mode: end < now ? 'EXPIRED' : 'TRIAL', maxUsers: TRIAL_MAX_USERS, activeUsers: n,
        expiresAt: new Date(end).toISOString().slice(0, 10), daysLeft, writable: end >= now, renewSoon: end >= now && daysLeft <= 7,
        message: end < now ? '평가판 기간이 끝났습니다. 라이선스를 등록해 주세요' : `평가판 사용 중 (${daysLeft}일 남음)`,
        online,
      };
    }
    // 테스트 환경에서는 라이선스 때문에 업무 테스트가 막히지 않도록 쓰기 허용
    if (config.NODE_ENV === 'test' && process.env.LICENSE_ENFORCE !== 'true') status.writable = true;
    this.cache = { at: now, status };
    return status;
  }

  async isWritable() {
    return (await this.status()).writable;
  }

  private async save(text: string) {
    await this.db
      .insert(licenseState)
      .values({ id: 1, licenseText: text.trim() })
      .onConflictDoUpdate({ target: licenseState.id, set: { licenseText: text.trim(), installedAt: new Date() } });
    this.cache = null;
  }

  async install(text: string) {
    let p: LicensePayload;
    try {
      p = await this.verifyForThisServer(text);
    } catch (e) {
      throw new BadRequestException({ code: 'LICENSE_INVALID', message: (e as Error).message });
    }
    await this.save(text);
    return p;
  }

  /** 사용자 추가 가능 여부 */
  async assertSeatAvailable() {
    const s = await this.status(true);
    if (s.activeUsers >= s.maxUsers) {
      throw new BadRequestException({ code: 'SEAT_LIMIT', message: `라이선스 사용자 수(${s.maxUsers}명)를 모두 사용 중입니다. 사용하지 않는 계정을 비활성화하거나 라이선스를 늘려 주세요` });
    }
  }

  // ── 온라인 갱신 (선택) ────────────────────────────────────────────
  //  공급사 발급 서버에 '설치 코드'로 연결해 두면, 공급사가 갱신·변경 발급한 라이선스를 자동으로 받는다.
  //  인터넷이 안 되는 설치형 고객은 연결하지 않고 라이선스 문자열을 직접 붙여 넣으면 된다.

  private async activationCode(): Promise<string | null> {
    return (await this.setting(ACTIVATION_KEY)) || config.LICENSE_ACTIVATION_CODE || null;
  }

  async connect(code: string) {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{8,40}$/.test(clean)) throw new BadRequestException({ code: 'ACTIVATION_INVALID', message: '설치 코드 형식이 올바르지 않습니다' });
    if (!config.LICENSE_SERVER_URL) throw new BadRequestException({ code: 'LICENSE_SERVER_OFF', message: '이 서버는 온라인 라이선스 확인이 꺼져 있습니다. 라이선스 문자열을 직접 등록해 주세요' });
    const result = await this.sync(clean);
    if (!result.ok) throw new BadRequestException({ code: 'ACTIVATION_FAILED', message: result.message });
    await this.putSetting(ACTIVATION_KEY, clean);
    this.cache = null;
    return result;
  }

  /**
   * 발급 서버에 이 서버의 사업자번호·사용자 수를 보내고, 더 새로 발급된 라이선스가 있으면 받아서 등록한다.
   * 공급사가 '사용 중지'하면 만료일이 지난 라이선스가 새로 발급되어 내려오므로 조회 전용으로 바뀐다.
   */
  async sync(codeOverride?: string): Promise<{ ok: boolean; updated: boolean; message: string }> {
    const code = codeOverride ?? (await this.activationCode());
    if (!config.LICENSE_SERVER_URL || !code) return { ok: false, updated: false, message: '온라인 연결 안 됨' };
    const [row] = await this.db.select().from(licenseState).where(eq(licenseState.id, 1));
    let current: LicensePayload | null = null;
    if (row) {
      try {
        current = parseLicense(row.licenseText);
      } catch {
        current = null;
      }
    }
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.status, 'ACTIVE'));
    try {
      const res = await fetch(`${config.LICENSE_SERVER_URL.replace(/\/$/, '')}/api/v1/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, bizRegNos: await this.companyBizNos(), activeUsers: n, licenseId: current?.licenseId ?? null, appVersion: APP_VERSION }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { license?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? `발급 서버 응답 오류 (${res.status})`);
      await this.putSetting(LAST_SYNC_KEY, new Date().toISOString());
      this.lastError = null;
      if (!body.license) return { ok: true, updated: false, message: '발급된 라이선스가 아직 없습니다' };
      const next = await this.verifyForThisServer(body.license);
      // 더 나중에 발급된 라이선스만 받는다 (공급사가 갱신·변경·중지한 결과)
      if (current && next.licenseId === current.licenseId && next.issuedAt <= current.issuedAt) {
        return { ok: true, updated: false, message: '최신 라이선스를 사용 중입니다' };
      }
      if (current && new Date(next.issuedAt).getTime() < new Date(current.issuedAt).getTime()) {
        return { ok: true, updated: false, message: '최신 라이선스를 사용 중입니다' };
      }
      await this.save(body.license);
      this.log.log(`라이선스 갱신: ${next.licensee} ~${next.expiresAt} ${next.maxUsers}명`);
      return { ok: true, updated: true, message: `라이선스를 받았습니다 (${next.expiresAt}까지, ${next.maxUsers}명)` };
    } catch (e) {
      this.lastError = (e as Error).message;
      this.cache = null;
      return { ok: false, updated: false, message: this.lastError };
    }
  }
}
