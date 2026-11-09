import { Injectable } from '@nestjs/common';
import { DbService, Q } from './db.service';
import { canonicalJson, sha256Hex } from './crypto.service';

export interface AuditActor { id?: string | null; username?: string | null; org_id?: string | null; ip?: string | null }

function rowDigest(r: { ts: string; org_id: any; user_id: any; username: any; action: string; target_type: any; target_id: any; detail: any; ip: any }) {
  return canonicalJson({ ts: r.ts, org_id: r.org_id ?? null, user_id: r.user_id ?? null, username: r.username ?? null, action: r.action, target_type: r.target_type ?? null, target_id: r.target_id ?? null, detail: r.detail ?? {}, ip: r.ip ?? null });
}

/**
 * 해시 체인 감사로그. 각 행의 hash = sha256(prev_hash | 행 내용).
 * 테이블은 DB 트리거로 UPDATE/DELETE가 금지되어 있고, 중간 행을 바꾸면 verify()에서 끊긴 위치가 드러난다.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async log(actor: AuditActor | null, action: string, targetType: string | null, targetId: string | null, detail: any = {}, q?: Q) {
    const run = async (qq: Q) => {
      await qq('SELECT pg_advisory_xact_lock(7243001)');
      const last = await qq<{ hash: string }>('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
      const prev = last[0]?.hash ?? 'GENESIS';
      const ts = new Date().toISOString();
      const row = { ts, org_id: actor?.org_id ?? null, user_id: actor?.id ?? null, username: actor?.username ?? null, action, target_type: targetType, target_id: targetId, detail, ip: actor?.ip ?? null };
      const hash = sha256Hex(prev + '|' + rowDigest(row));
      await qq(`INSERT INTO audit_logs(ts, org_id, user_id, username, action, target_type, target_id, detail, ip, prev_hash, hash)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ts, row.org_id, row.user_id, row.username, action, targetType, targetId, JSON.stringify(detail ?? {}), row.ip, prev, hash]);
    };
    if (q) return run(q);
    return this.db.tx(qq => run(qq));
  }

  async verify(): Promise<{ ok: boolean; checked: number; broken_at_id: number | null }> {
    let prev = 'GENESIS', checked = 0, lastId = 0;
    for (;;) {
      const rows = await this.db.query(`SELECT * FROM audit_logs WHERE id > $1 ORDER BY id LIMIT 5000`, [lastId]);
      if (!rows.length) break;
      for (const r of rows) {
        const digest = rowDigest({ ...r, ts: new Date(r.ts).toISOString() });
        const expect = sha256Hex(prev + '|' + digest);
        if (r.prev_hash !== prev || r.hash !== expect) return { ok: false, checked, broken_at_id: Number(r.id) };
        prev = r.hash; checked++; lastId = Number(r.id);
      }
    }
    return { ok: true, checked, broken_at_id: null };
  }
}
