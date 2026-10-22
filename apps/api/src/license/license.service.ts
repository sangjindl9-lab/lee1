import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createPublicKey, verify } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config';
import { DB, DB_TOKEN } from '../db/db';
import { licenseState, systemSettings, users } from '../db/schema';

/**
 * 판매자 공개키 (Ed25519). 대응하는 개인키는 판매자만 보관하며 고객 배포본에 절대 포함하지 않는다.
 * 키 교체 시 LICENSE_PUBLIC_KEY 환경변수로 덮어쓸 수 있다.
 */
const VENDOR_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+37Vdo3KNm4wMx7f0qzOvOMHBcHaiwcH3LqcuB9rBSI=
-----END PUBLIC KEY-----`;

const TRIAL_DAYS = 30;
const TRIAL_MAX_USERS = 10;

const Payload = z.object({
  licenseId: z.string(),
  licensee: z.string(),
  bizRegNo: z.string(),
  maxUsers: z.number().int().positive(),
  issuedAt: z.string(),
  expiresAt: z.string(), // YYYY-MM-DD (해당일 23:59:59 KST 까지 유효)
  modules: z.array(z.string()).default([]),
  edition: z.string().default('standard'),
});
export type LicensePayload = z.infer<typeof Payload>;

export interface LicenseStatus {
  mode: 'TRIAL' | 'LICENSED' | 'EXPIRED' | 'INVALID';
  licensee?: string;
  bizRegNo?: string;
  maxUsers: number;
  activeUsers: number;
  expiresAt: string;
  daysLeft: number;
  writable: boolean;
  message: string;
}

export function parseLicense(text: string, publicKeyPem = config.LICENSE_PUBLIC_KEY ? Buffer.from(config.LICENSE_PUBLIC_KEY, 'base64').toString() : VENDOR_PUBLIC_KEY): LicensePayload {
  const clean = text.trim().replace(/\s+/g, '');
  const [body, sig] = clean.split('.');
  if (!body || !sig) throw new Error('라이선스 형식이 올바르지 않습니다');
  const ok = verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('라이선스 서명이 올바르지 않습니다. 발급받은 원문을 그대로 붙여 넣어 주세요');
  return Payload.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
}

@Injectable()
export class LicenseService {
  private cache: { at: number; status: LicenseStatus } | null = null;

  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  private async installDate(): Promise<Date> {
    const [row] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, 'install_date'));
    if (row) return new Date(row.value as string);
    const now = new Date().toISOString();
    await this.db.insert(systemSettings).values({ key: 'install_date', value: now }).onConflictDoNothing();
    const [again] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, 'install_date'));
    return new Date(again.value as string);
  }

  async status(force = false): Promise<LicenseStatus> {
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.status;
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.status, 'ACTIVE'));
    const [row] = await this.db.select().from(licenseState).where(eq(licenseState.id, 1));
    const now = Date.now();
    let status: LicenseStatus;
    if (row) {
      try {
        const p = parseLicense(row.licenseText);
        const end = new Date(p.expiresAt + 'T23:59:59+09:00').getTime();
        const daysLeft = Math.ceil((end - now) / 86400000);
        const expired = end < now;
        status = {
          mode: expired ? 'EXPIRED' : 'LICENSED', licensee: p.licensee, bizRegNo: p.bizRegNo, maxUsers: p.maxUsers, activeUsers: n,
          expiresAt: p.expiresAt, daysLeft, writable: !expired,
          message: expired ? '라이선스가 만료되어 조회만 가능합니다' : `${p.licensee} 정식 라이선스`,
        };
      } catch (e) {
        status = { mode: 'INVALID', maxUsers: 0, activeUsers: n, expiresAt: '', daysLeft: 0, writable: false, message: (e as Error).message };
      }
    } else {
      const start = await this.installDate();
      const end = start.getTime() + TRIAL_DAYS * 86400000;
      const daysLeft = Math.ceil((end - now) / 86400000);
      status = {
        mode: end < now ? 'EXPIRED' : 'TRIAL', maxUsers: TRIAL_MAX_USERS, activeUsers: n,
        expiresAt: new Date(end).toISOString().slice(0, 10), daysLeft, writable: end >= now,
        message: end < now ? '평가판 기간이 끝났습니다. 라이선스를 등록해 주세요' : `평가판 사용 중 (${daysLeft}일 남음)`,
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

  async install(text: string) {
    let p: LicensePayload;
    try {
      p = parseLicense(text);
    } catch (e) {
      throw new BadRequestException({ code: 'LICENSE_INVALID', message: (e as Error).message });
    }
    await this.db
      .insert(licenseState)
      .values({ id: 1, licenseText: text.trim() })
      .onConflictDoUpdate({ target: licenseState.id, set: { licenseText: text.trim(), installedAt: new Date() } });
    this.cache = null;
    return p;
  }

  /** 사용자 추가 가능 여부 */
  async assertSeatAvailable() {
    const s = await this.status(true);
    if (s.activeUsers >= s.maxUsers) {
      throw new BadRequestException({ code: 'SEAT_LIMIT', message: `라이선스 사용자 수(${s.maxUsers}명)를 모두 사용 중입니다. 사용하지 않는 계정을 비활성화하거나 라이선스를 늘려 주세요` });
    }
  }
}
