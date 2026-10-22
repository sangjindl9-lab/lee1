/** 4단계 공통 — 현장 계약금액(최초 + 승인된 변경), 권한 범위, 금액 입력 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AccessContext } from '../access/context';
import { notFound } from '../common/errors';
import { D, moneyStr } from '../common/money';
import { DB, Tx } from '../db/db';
import { projects } from '../db/schema';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD');
export const optDate = dateStr.optional().nullable().or(z.literal('').transform(() => null));
export const optText = (max = 300) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const amt = z.union([z.string(), z.number()]).transform((v) => String(v ?? '').replace(/,/g, '').trim() || '0').refine((v) => /^-?\d{1,15}$/.test(v), '금액은 원 단위 정수');
export const posAmt = amt.refine((v) => Number(v) >= 0, '0 이상');
export const rateIn = z.union([z.string(), z.number()]).transform((v) => String(v ?? '0').trim() || '0').refine((v) => /^\d(\.\d{1,4})?$/.test(v) && Number(v) <= 1, '비율은 0~1 (예: 0.05)');
export const VersionDto = z.object({ version: z.coerce.number().int() });
export const ReasonDto = z.object({ reason: z.string().trim().min(2, '사유를 입력해 주세요').max(300) });

/** 현장 조회 (권한 범위 확인) */
export async function loadProject(db: DB | Tx, access: AccessService, ctx: AccessContext, projectId: string) {
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt)));
  if (!p || !access.canSeeProject(ctx, p.id)) throw notFound('현장');
  return p;
}

/** 현재 확정 계약금액(공급가) = 최초계약 + 승인된 변경계약 증감 */
export async function contractNow(db: DB | Tx, projectId: string) {
  const r = (await db.execute(sql`select p.supply_amount::text original, coalesce((select sum(delta_amount) from contract_revision r where r.project_id = p.id and r.status = 'APPROVED'),0)::text delta,
    coalesce((select sum(delta_amount) from contract_revision r where r.project_id = p.id and r.status in ('DRAFT','PENDING')),0)::text pending
    from project p where p.id = ${projectId}`)).rows[0] as { original: string; delta: string; pending: string } | undefined;
  if (!r) throw notFound('현장');
  return { original: moneyStr(r.original), current: moneyStr(D(r.original).plus(r.delta)), pending: moneyStr(r.pending) };
}

export function assertEditable(status: string, ok: string[], what: string) {
  if (!ok.includes(status)) throw new BadRequestException({ code: 'LOCKED', message: `${what}은(는) 지금 상태에서 고칠 수 없습니다` });
}

export const vatOf = (supply: Decimal.Value, rate: Decimal.Value) => D(supply).mul(rate).toDecimalPlaces(0, 1);
import type Decimal from 'decimal.js';
