import { db, one, all } from './db.ts';
import { AppError, str } from './util.ts';
import type { User } from './util.ts';

export const COMPANY_ROLES: Record<string, string> = { admin: '관리자', buyer: '구매 담당자', inspector: '검수 담당자' };
export async function createCompany(user: User, name: string, approvalRequired: boolean) {
  if (str(name).length < 2) throw new AppError('기업명을 입력하세요');
  return db.tx(async (t) => {
    const id = (await one(t, 'INSERT INTO companies(name, purchase_approval_required) VALUES ($1,$2) RETURNING id', [str(name, 80), approvalRequired])).id;
    await t.query("INSERT INTO company_members(company_id, user_id, role) VALUES ($1,$2,'admin')", [id, user.id]);
    return id as number;
  });
}
export async function setMember(user: User, companyId: number, email: string, role: string) {
  if (!(await one(db, "SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2 AND role='admin'", [companyId, user.id]))) throw new AppError('기업 관리자만 구성원을 바꿀 수 있습니다', 403);
  if (!COMPANY_ROLES[role]) throw new AppError('역할을 선택하세요');
  const u = await one(db, 'SELECT id FROM users WHERE email=$1', [str(email).toLowerCase()]);
  if (!u) throw new AppError('가입된 회원 이메일이 아닙니다');
  if (u.id === user.id && role !== 'admin') throw new AppError('자신의 관리자 권한은 내릴 수 없습니다');
  await db.query('INSERT INTO company_members(company_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (company_id, user_id) DO UPDATE SET role=EXCLUDED.role', [companyId, u.id, role]);
}
export const myCompanies = (userId: number) => all(db, 'SELECT c.*, m.role FROM companies c JOIN company_members m ON m.company_id=c.id WHERE m.user_id=$1 ORDER BY c.id', [userId]);
export const members = (companyId: number) => all(db, 'SELECT m.role, u.name, u.email FROM company_members m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY m.created_at', [companyId]);
