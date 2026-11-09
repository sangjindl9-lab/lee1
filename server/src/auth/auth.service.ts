import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { randomUUID } from 'crypto';
import { DbService } from '../common/db.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { config } from '../common/config';
import { ApiError, AuthUser } from './auth.types';

authenticator.options = { window: 1 };

type Kind = 'access' | 'mfa' | 'stepup';
const TTL: Record<Kind, number> = { access: config.accessTtlSec, mfa: 300, stepup: 300 };

export function validatePassword(pw: string) {
  // 공공기관 일반 기준: 9자 이상, 영문·숫자·특수문자 중 3종 이상 또는 10자 이상 2종
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (pw.length < 9 || kinds < 3) throw new ApiError(400, 'WEAK_PASSWORD', '비밀번호는 9자 이상, 영문 대·소문자·숫자·특수문자 중 3종 이상이어야 합니다');
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Auth');
  constructor(private readonly db: DbService, private readonly crypto: CryptoService, private readonly audit: AuditService) {}

  /** 최초 설치 시 중앙 관리자 1명 생성 (환경변수로만) */
  async onModuleInit() {
    const n = await this.db.one<{ c: string }>('SELECT count(*)::int AS c FROM users');
    if (Number(n?.c) > 0) return;
    const { username, password, orgName } = config.bootstrapAdmin;
    if (!username || !password) { this.log.warn('사용자가 없습니다. BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD 로 최초 관리자를 만드세요'); return; }
    validatePassword(password);
    await this.db.tx(async q => {
      const [org] = await q(`INSERT INTO organizations(code, name, is_platform) VALUES ('PLATFORM',$1,true) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [orgName]);
      const [role] = await q(`SELECT id FROM roles WHERE code='central_admin'`);
      const [u] = await q(`INSERT INTO users(org_id, username, display_name, password_hash, role_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org.id, username, '중앙 관리자', await bcrypt.hash(password, 12), role.id]);
      await this.audit.log({ id: u.id, username, org_id: org.id }, 'system.bootstrap_admin', 'user', u.id, {}, q);
    });
    this.log.log(`최초 중앙 관리자(${username})를 만들었습니다. 첫 로그인 후 MFA를 설정해야 합니다`);
  }

  private async issue(userId: string, kind: Kind, ip: string | null): Promise<string> {
    const jti = randomUUID();
    await this.db.query(`INSERT INTO sessions(jti, user_id, kind, ip, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5))`, [jti, userId, kind, ip, TTL[kind]]);
    return jwt.sign({ sub: userId, kind }, this.crypto.jwtKey, { algorithm: 'HS256', expiresIn: TTL[kind], jwtid: jti, issuer: 'eum-smart-vms' });
  }

  async verifyToken(token: string, kind: Kind, ip: string | null = null): Promise<AuthUser> {
    let p: any;
    try { p = jwt.verify(token, this.crypto.jwtKey, { algorithms: ['HS256'], issuer: 'eum-smart-vms' }); }
    catch { throw new ApiError(401, 'INVALID_TOKEN', '인증이 만료되었거나 올바르지 않습니다'); }
    if (p.kind !== kind) throw new ApiError(401, 'INVALID_TOKEN', '토큰 종류가 올바르지 않습니다');
    const s = await this.db.one('SELECT revoked_at FROM sessions WHERE jti=$1 AND user_id=$2', [p.jti, p.sub]);
    if (!s || s.revoked_at) throw new ApiError(401, 'INVALID_TOKEN', '로그아웃되었거나 만료된 세션입니다');
    const u = await this.loadUser(p.sub);
    if (!u) throw new ApiError(401, 'INVALID_TOKEN', '사용자를 찾을 수 없거나 비활성 상태입니다');
    return { ...u, jti: p.jti, ip };
  }

  async loadUser(id: string): Promise<Omit<AuthUser, 'jti' | 'ip'> | null> {
    const u = await this.db.one(`
      SELECT u.id, u.username, u.display_name, u.org_id, o.name AS org_name, o.is_platform, r.code AS role, r.rank AS role_rank,
             r.requires_mfa, u.mfa_enabled,
             COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
      FROM users u JOIN organizations o ON o.id=u.org_id JOIN roles r ON r.id=u.role_id
      LEFT JOIN role_permissions rp ON rp.role_id=r.id
      WHERE u.id=$1 AND u.active GROUP BY u.id, o.id, r.id`, [id]);
    return u;
  }

  publicUser(u: Omit<AuthUser, 'jti' | 'ip'>) {
    const { id, username, display_name, org_id, org_name, role, permissions, mfa_enabled } = u;
    return { id, username, display_name, org_id, org_name, role, permissions, mfa_enabled, mfa_required: u.requires_mfa };
  }

  async login(username: string, password: string, ip: string | null, ua: string | null) {
    const row = await this.db.one(`SELECT id, org_id, password_hash, active, mfa_enabled, failed_logins, locked_until FROM users WHERE username=$1`, [username]);
    const fail = async (reason: string, status = 401, code = 'LOGIN_FAILED', msg = '아이디 또는 비밀번호가 올바르지 않습니다') => {
      await this.db.query(`INSERT INTO login_history(user_id, username, org_id, success, reason, ip, user_agent) VALUES ($1,$2,$3,false,$4,$5,$6)`, [row?.id ?? null, username, row?.org_id ?? null, reason, ip, ua]);
      throw new ApiError(status, code, msg);
    };
    if (!row) return fail('no_user');
    if (!row.active) return fail('inactive');
    if (row.locked_until && new Date(row.locked_until) > new Date()) return fail('locked', 423, 'ACCOUNT_LOCKED', '로그인 실패가 반복되어 계정이 잠겼습니다. 잠시 후 다시 시도하세요');
    if (!(await bcrypt.compare(password, row.password_hash))) {
      const n = row.failed_logins + 1;
      await this.db.query(`UPDATE users SET failed_logins=$2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + make_interval(mins => $4::int) ELSE locked_until END WHERE id=$1`,
        [row.id, n, config.loginMaxFailures, config.loginLockMinutes]);
      return fail('bad_password');
    }
    await this.db.query(`UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1`, [row.id]);
    if (row.mfa_enabled) {
      return { mfa_required: true, mfa_token: await this.issue(row.id, 'mfa', ip) };
    }
    return this.complete(row.id, ip, ua);
  }

  private async complete(userId: string, ip: string | null, ua: string | null) {
    const u = (await this.loadUser(userId))!;
    await this.db.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [userId]);
    await this.db.query(`INSERT INTO login_history(user_id, username, org_id, success, ip, user_agent) VALUES ($1,$2,$3,true,$4,$5)`, [userId, u.username, u.org_id, ip, ua]);
    await this.audit.log({ ...u, ip }, 'auth.login', 'user', userId, {});
    return { access_token: await this.issue(userId, 'access', ip), expires_in: TTL.access, user: this.publicUser(u) };
  }

  async mfaVerify(mfaToken: string, code: string, ip: string | null, ua: string | null) {
    const u = await this.verifyToken(mfaToken, 'mfa', ip);
    const row = await this.db.one('SELECT mfa_secret_enc FROM users WHERE id=$1', [u.id]);
    if (!row?.mfa_secret_enc || !authenticator.check(code, this.crypto.decrypt(row.mfa_secret_enc))) {
      await this.db.query(`INSERT INTO login_history(user_id, username, org_id, success, reason, ip, user_agent) VALUES ($1,$2,$3,false,'bad_mfa',$4,$5)`, [u.id, u.username, u.org_id, ip, ua]);
      throw new ApiError(401, 'MFA_FAILED', '인증 코드가 올바르지 않습니다');
    }
    await this.revoke(u.jti);
    return this.complete(u.id, ip, ua);
  }

  async mfaSetup(u: AuthUser) {
    const secret = authenticator.generateSecret(20);
    await this.db.query('UPDATE users SET mfa_secret_enc=$2 WHERE id=$1 AND NOT mfa_enabled', [u.id, this.crypto.encrypt(secret)]);
    const branding = await this.db.one(`SELECT value FROM system_settings WHERE key='branding'`);
    const issuer = branding?.value?.productName || 'EUM SMART VMS';
    return { secret, otpauth_url: authenticator.keyuri(u.username, issuer, secret) };
  }

  async mfaEnable(u: AuthUser, code: string) {
    const row = await this.db.one('SELECT mfa_secret_enc, mfa_enabled FROM users WHERE id=$1', [u.id]);
    if (row?.mfa_enabled) return { enabled: true };
    if (!row?.mfa_secret_enc || !authenticator.check(code, this.crypto.decrypt(row.mfa_secret_enc))) throw new ApiError(400, 'MFA_FAILED', '인증 코드가 올바르지 않습니다');
    await this.db.query('UPDATE users SET mfa_enabled=true WHERE id=$1', [u.id]);
    await this.audit.log(u, 'auth.mfa_enabled', 'user', u.id, {});
    return { enabled: true };
  }

  /** 중요 제어 명령 전 재인증 */
  async reauth(u: AuthUser, password: string, code?: string) {
    const row = await this.db.one('SELECT password_hash, mfa_enabled, mfa_secret_enc FROM users WHERE id=$1', [u.id]);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      await this.audit.log(u, 'auth.reauth_failed', 'user', u.id, { reason: 'password' });
      throw new ApiError(401, 'REAUTH_FAILED', '비밀번호가 올바르지 않습니다');
    }
    if (row.mfa_enabled && (!code || !authenticator.check(code, this.crypto.decrypt(row.mfa_secret_enc)))) {
      await this.audit.log(u, 'auth.reauth_failed', 'user', u.id, { reason: 'mfa' });
      throw new ApiError(401, 'REAUTH_FAILED', '인증 코드가 올바르지 않습니다');
    }
    await this.audit.log(u, 'auth.reauth', 'user', u.id, {});
    return { step_up_token: await this.issue(u.id, 'stepup', u.ip), expires_in: TTL.stepup };
  }

  async requireStepUp(u: AuthUser, token: string | undefined) {
    if (!token) throw new ApiError(403, 'STEP_UP_REQUIRED', '이 작업은 재인증이 필요합니다');
    const s = await this.verifyToken(token, 'stepup', u.ip);
    if (s.id !== u.id) throw new ApiError(403, 'STEP_UP_REQUIRED', '재인증 토큰이 현재 사용자와 다릅니다');
  }

  async revoke(jti: string) { await this.db.query('UPDATE sessions SET revoked_at=now() WHERE jti=$1 AND revoked_at IS NULL', [jti]); }

  async logout(u: AuthUser) {
    await this.revoke(u.jti);
    await this.audit.log(u, 'auth.logout', 'user', u.id, {});
    return { ok: true };
  }
}
