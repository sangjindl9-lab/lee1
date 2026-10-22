import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte, sql, SQL } from 'drizzle-orm';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { auditLogs } from '../db/schema';
import { sha256 } from '../common/crypto';
import type { AccessContext } from '../access/context';

const GENESIS = '0'.repeat(64);
/** 감사로그에 남기지 않을 민감 필드 */
const REDACT = new Set(['passwordHash', 'password', 'mfaSecretEnc', 'bankAccountEnc', 'tokenHash', 'csrfHash', 'newPassword', 'currentPassword', 'bankAccount']);

function redact(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(redact);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = REDACT.has(k) ? '[보호됨]' : redact(val);
    return out;
  }
  return v;
}

/** 키 정렬된 JSON — 해시가 항상 같은 값이 되도록 */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
}

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  companyId?: string | null;
  userId?: string | null;
  userName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function hashOf(prevHash: string, e: Omit<typeof auditLogs.$inferInsert, 'hash' | 'prevHash' | 'id'> & { createdAt: Date }) {
  return sha256(
    prevHash +
      stable({
        companyId: e.companyId ?? null, userId: e.userId ?? null, userName: e.userName ?? null, action: e.action,
        resource: e.resource, resourceId: e.resourceId ?? null, summary: e.summary ?? null,
        before: e.before ?? null, after: e.after ?? null, ip: e.ip ?? null, createdAt: e.createdAt.toISOString(),
      }),
  );
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  /** 업무 변경과 같은 트랜잭션 안에서 호출하면 둘 다 저장되거나 둘 다 취소된다 */
  async write(entry: AuditEntry, tx?: Tx) {
    const run = async (t: Tx) => {
      // 체인 순서를 보장하기 위해 감사로그 기록을 직렬화
      await t.execute(sql`select pg_advisory_xact_lock(7340001)`);
      const [last] = await t.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
      const prevHash = last?.hash ?? GENESIS;
      const row = {
        companyId: entry.companyId ?? null,
        userId: entry.userId ?? null,
        userName: entry.userName ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        summary: entry.summary ?? null,
        before: (redact(entry.before) as object) ?? null,
        after: (redact(entry.after) as object) ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent?.slice(0, 300) ?? null,
        createdAt: new Date(Math.floor(Date.now())),
      };
      // jsonb 는 저장 후 키 순서가 바뀌므로 해시는 정규화된 값으로 계산
      const normalized = { ...row, before: row.before ? JSON.parse(JSON.stringify(row.before)) : null, after: row.after ? JSON.parse(JSON.stringify(row.after)) : null };
      const hash = hashOf(prevHash, normalized);
      await t.insert(auditLogs).values({ ...row, prevHash, hash });
    };
    if (tx) return run(tx);
    return this.db.transaction(run);
  }

  fromCtx(ctx: AccessContext, e: Omit<AuditEntry, 'userId' | 'userName' | 'ip' | 'userAgent' | 'companyId'> & { companyId?: string | null }, tx?: Tx) {
    return this.write(
      { ...e, companyId: e.companyId === undefined ? ctx.companyId : e.companyId, userId: ctx.user.id, userName: ctx.user.name, ip: ctx.ip, userAgent: ctx.userAgent },
      tx,
    );
  }

  async list(companyId: string, q: { from?: string; to?: string; resource?: string; action?: string; resourceId?: string; page: number; size: number }) {
    const conds: SQL[] = [eq(auditLogs.companyId, companyId)];
    if (q.from) conds.push(gte(auditLogs.createdAt, new Date(q.from + 'T00:00:00+09:00')));
    if (q.to) conds.push(lte(auditLogs.createdAt, new Date(q.to + 'T23:59:59.999+09:00')));
    if (q.resource) conds.push(eq(auditLogs.resource, q.resource));
    if (q.action) conds.push(eq(auditLogs.action, q.action));
    if (q.resourceId) conds.push(eq(auditLogs.resourceId, q.resourceId));
    const where = and(...conds);
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    const rows = await this.db
      .select({
        id: auditLogs.id, createdAt: auditLogs.createdAt, userName: auditLogs.userName, action: auditLogs.action,
        resource: auditLogs.resource, resourceId: auditLogs.resourceId, summary: auditLogs.summary, ip: auditLogs.ip,
        before: auditLogs.before, after: auditLogs.after,
      })
      .from(auditLogs).where(where).orderBy(desc(auditLogs.id)).limit(q.size).offset((q.page - 1) * q.size);
    return { total: count, rows };
  }

  /** 전체 체인을 처음부터 다시 계산해 변조 여부 확인 */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
    let prev = GENESIS;
    let checked = 0;
    let lastId = 0;
    for (;;) {
      const rows = await this.db.select().from(auditLogs).where(sql`${auditLogs.id} > ${lastId}`).orderBy(asc(auditLogs.id)).limit(1000);
      if (!rows.length) break;
      for (const r of rows) {
        const expected = hashOf(prev, { ...r, createdAt: r.createdAt });
        if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAt: r.id };
        prev = r.hash;
        checked++;
        lastId = r.id;
      }
    }
    return { ok: true, checked };
  }
}
