import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import { config } from '../config';
import { DB, DB_TOKEN } from '../db/db';
import { users, userSessions } from '../db/schema';
import { decryptField, encryptField, randomToken, sha256 } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { checkPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from './password';

const INVALID = () => new UnauthorizedException({ code: 'INVALID_LOGIN', message: '아이디 또는 비밀번호가 올바르지 않습니다' });

export interface ClientInfo {
  ip: string;
  userAgent: string;
}

export interface IssuedSession {
  token: string;
  csrf: string;
  mfaPending: boolean;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  async login(loginId: string, password: string, client: ClientInfo): Promise<IssuedSession & { mustChangePassword: boolean }> {
    const id = loginId.trim().toLowerCase();
    const [u] = await this.db.select().from(users).where(eq(users.loginId, id));
    if (!u) {
      await dummyVerify(password);
      await this.audit.write({ action: 'LOGIN_FAIL', resource: 'auth', summary: `없는 아이디: ${id.slice(0, 40)}`, ...client });
      throw INVALID();
    }
    if (u.status === 'DISABLED') {
      await dummyVerify(password);
      await this.audit.write({ action: 'LOGIN_FAIL', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, summary: '비활성 계정', ...client });
      throw INVALID();
    }
    const now = new Date();
    if (u.lockedUntil && u.lockedUntil > now) {
      const mins = Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60000);
      throw new UnauthorizedException({ code: 'LOCKED', message: `로그인 실패가 반복되어 계정이 잠겼습니다. ${mins}분 후 다시 시도하거나 관리자에게 해제를 요청하세요` });
    }
    const ok = await verifyPassword(u.passwordHash, password);
    if (!ok) {
      const fails = u.failedLoginCount + 1;
      const lock = fails >= config.LOGIN_MAX_FAILS;
      await this.db
        .update(users)
        .set({ failedLoginCount: lock ? 0 : fails, lockedUntil: lock ? new Date(now.getTime() + config.LOGIN_LOCK_MINUTES * 60000) : u.lockedUntil })
        .where(eq(users.id, u.id));
      await this.audit.write({ action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAIL', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, summary: `비밀번호 불일치 ${fails}회`, ...client });
      throw INVALID();
    }
    await this.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, lastLoginIp: client.ip }).where(eq(users.id, u.id));
    const s = await this.issue(u.id, u.mfaEnabled, client);
    await this.audit.write({ action: u.mfaEnabled ? 'LOGIN_PASSWORD_OK' : 'LOGIN', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, ...client });
    return { ...s, mustChangePassword: u.mustChangePassword };
  }

  private async issue(userId: string, mfaPending: boolean, client: ClientInfo): Promise<IssuedSession> {
    const token = randomToken(32);
    const csrf = randomToken(24);
    const expiresAt = new Date(Date.now() + (mfaPending ? 5 * 60000 : config.SESSION_ABSOLUTE_HOURS * 3600000));
    await this.db.insert(userSessions).values({
      userId, tokenHash: sha256(token), csrfHash: sha256(csrf), mfaPending, ip: client.ip, userAgent: client.userAgent.slice(0, 300), expiresAt,
    });
    return { token, csrf, mfaPending, expiresAt };
  }

  /** OTP 확인 → 대기 세션을 폐기하고 정식 세션 발급 (세션 고정 공격 방지) */
  async completeMfa(sessionId: string, userId: string, code: string, client: ClientInfo): Promise<IssuedSession> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u?.mfaEnabled || !u.mfaSecretEnc) throw new BadRequestException({ code: 'MFA_NOT_ENABLED', message: '2단계 인증이 설정되어 있지 않습니다' });
    const valid = await this.checkTotp(decryptField(u.mfaSecretEnc), code);
    if (!valid) {
      await this.audit.write({ action: 'MFA_FAIL', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, ...client });
      throw new UnauthorizedException({ code: 'INVALID_OTP', message: '인증번호가 올바르지 않습니다' });
    }
    await this.db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
    const s = await this.issue(u.id, false, client);
    await this.audit.write({ action: 'LOGIN', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, summary: '2단계 인증 완료', ...client });
    return s;
  }

  private async checkTotp(secret: string, code: string) {
    if (!/^\d{6}$/.test(code)) return false;
    const r = await verifyTotp({ secret, token: code, epochTolerance: 30 });
    return r.valid;
  }

  /** 쿠키 토큰으로 세션 확인. 유휴·절대 만료, 폐기 여부를 검사 */
  async validate(token: string) {
    const [s] = await this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.tokenHash, sha256(token)), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())));
    if (!s) return null;
    const idleMs = config.SESSION_IDLE_MINUTES * 60000;
    if (Date.now() - s.lastSeenAt.getTime() > idleMs) {
      await this.db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, s.id));
      return null;
    }
    // DB 쓰기를 줄이기 위해 1분 이상 지났을 때만 갱신
    if (Date.now() - s.lastSeenAt.getTime() > 60000) {
      await this.db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, s.id));
    }
    const [u] = await this.db.select().from(users).where(eq(users.id, s.userId));
    if (!u || u.status !== 'ACTIVE') return null;
    return { session: s, user: u };
  }

  async logout(sessionId: string) {
    await this.db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
  }

  async revokeAll(userId: string, exceptSessionId?: string) {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), exceptSessionId ? ne(userSessions.id, exceptSessionId) : sql`true`));
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, client: ClientInfo) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u || !(await verifyPassword(u.passwordHash, current))) {
      throw new BadRequestException({ code: 'WRONG_PASSWORD', message: '현재 비밀번호가 올바르지 않습니다' });
    }
    const policy = checkPasswordPolicy(next, u.loginId);
    if (policy) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policy });
    if (await verifyPassword(u.passwordHash, next)) throw new BadRequestException({ code: 'SAME_PASSWORD', message: '이전과 다른 비밀번호를 사용해 주세요' });
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await this.revokeAll(userId, sessionId);
    await this.audit.write({ action: 'PASSWORD_CHANGE', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, ...client });
  }

  async mfaSetup(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    const secret = generateSecret();
    // 활성화 전까지는 임시 저장 (mfaEnabled=false 상태)
    await this.db.update(users).set({ mfaSecretEnc: encryptField(secret) }).where(eq(users.id, userId));
    const uri = generateURI({ issuer: 'SS-ERP', label: u.loginId, secret });
    return { secret, otpauthUrl: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  async mfaEnable(userId: string, code: string, client: ClientInfo) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u.mfaSecretEnc) throw new BadRequestException({ code: 'MFA_SETUP_FIRST', message: '먼저 인증 앱 등록을 시작해 주세요' });
    if (!(await this.checkTotp(decryptField(u.mfaSecretEnc), code))) {
      throw new BadRequestException({ code: 'INVALID_OTP', message: '인증번호가 올바르지 않습니다. 앱에 표시된 6자리 숫자를 입력해 주세요' });
    }
    await this.db.update(users).set({ mfaEnabled: true }).where(eq(users.id, userId));
    await this.audit.write({ action: 'MFA_ENABLE', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, ...client });
  }

  async mfaDisable(userId: string, password: string, client: ClientInfo) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!(await verifyPassword(u.passwordHash, password))) throw new BadRequestException({ code: 'WRONG_PASSWORD', message: '비밀번호가 올바르지 않습니다' });
    await this.db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, userId));
    await this.audit.write({ action: 'MFA_DISABLE', resource: 'auth', resourceId: u.id, userId: u.id, userName: u.name, ...client });
  }
}
