import { db, one } from './db.ts';
import { AppError, hashPassword, verifyPassword, randomId, audit, str } from './util.ts';
import type { User } from './util.ts';
import { config } from './config.ts';

const attempts = new Map<string, { n: number; until: number }>();

export async function register(input: { email: any; password: any; name: any }): Promise<User> {
  const email = str(input.email, 200).toLowerCase(); const name = str(input.name, 60); const pw = String(input.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('이메일 형식이 올바르지 않습니다');
  if (pw.length < 10) throw new AppError('비밀번호는 10자 이상이어야 합니다');
  if (!name) throw new AppError('이름을 입력하세요');
  if (await one(db, 'SELECT 1 FROM users WHERE email=$1', [email])) throw new AppError('이미 가입된 이메일입니다');
  return one(db, 'INSERT INTO users(email,password_hash,name) VALUES ($1,$2,$3) RETURNING id,email,name,operator_role,status', [email, hashPassword(pw), name]);
}
export async function login(emailRaw: any, pw: any) {
  const email = str(emailRaw, 200).toLowerCase();
  const a = attempts.get(email);
  if (a && a.n >= 5 && a.until > Date.now()) throw new AppError('로그인 시도가 많습니다. 15분 뒤 다시 시도하세요', 429);
  const u = await one(db, 'SELECT * FROM users WHERE email=$1', [email]);
  if (!u || u.status !== 'active' || !verifyPassword(String(pw || ''), u.password_hash)) {
    attempts.set(email, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60000 });
    throw new AppError('이메일 또는 비밀번호가 올바르지 않습니다');
  }
  attempts.delete(email);
  const sid = randomId(32);
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES ($1,$2, now() + interval '14 days')", [sid, u.id]);
  return sid;
}
export async function sessionUser(sid: string | undefined): Promise<(User & { stepup: boolean }) | null> {
  if (!sid) return null;
  const r = await one(db, `SELECT u.id,u.email,u.name,u.operator_role,u.status, (s.stepup_at > now() - interval '30 minutes') AS stepup
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at > now() AND u.status='active'`, [sid]);
  return r && { ...r, stepup: !!r.stepup };
}
export const logout = (sid: string) => db.query('DELETE FROM sessions WHERE id=$1', [sid]);
/** 민감 작업 전 비밀번호 재확인(관리자 추가 인증, 계좌 변경) */
export async function stepUp(sid: string, userId: number, pw: any) {
  const u = await one(db, 'SELECT password_hash FROM users WHERE id=$1', [userId]);
  if (!u || !verifyPassword(String(pw || ''), u.password_hash)) throw new AppError('비밀번호가 올바르지 않습니다');
  await db.query('UPDATE sessions SET stepup_at=now() WHERE id=$1', [sid]);
}
/** 최초 실행 시 최고관리자와 기본 수수료 정책을 만든다 */
export async function bootstrap() {
  if (config.adminEmail && config.adminPassword && !(await one(db, "SELECT 1 FROM users WHERE operator_role='super'"))) {
    const ex = await one(db, 'SELECT id FROM users WHERE email=$1', [config.adminEmail.toLowerCase()]);
    if (ex) await db.query("UPDATE users SET operator_role='super' WHERE id=$1", [ex.id]);
    else await db.query("INSERT INTO users(email,password_hash,name,operator_role) VALUES ($1,$2,'최고관리자','super')", [config.adminEmail.toLowerCase(), hashPassword(config.adminPassword)]);
    await audit(null, null, 'bootstrap.admin');
  }
  if (!(await one(db, "SELECT 1 FROM fee_policies WHERE scope='default'"))) {
    await db.query("INSERT INTO fee_policies(scope, rate_bps, pg_fee_bearer, note) VALUES ('default', 1000, 'seller', '초기 기본값. 운영 전 조정 필요')");
  }
}
export async function setOperatorRole(actor: User, userId: number, role: string | null) {
  if (actor.operator_role !== 'super') throw new AppError('최고관리자만 운영자 권한을 바꿀 수 있습니다', 403);
  if (role && !['review', 'support', 'settlement', 'super'].includes(role)) throw new AppError('권한 값이 올바르지 않습니다');
  await db.query('UPDATE users SET operator_role=$2 WHERE id=$1', [userId, role]);
  await audit(null, actor, 'operator.role', 'user', userId, role || '해제');
}
