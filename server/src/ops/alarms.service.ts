import { Injectable } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { Bus } from '../common/bus';
import { AuditService } from '../common/audit.service';
import { ApiError, AuthUser, canSeeOrg, orgFilter } from '../auth/auth.types';

const ACTIVE = `('open','acknowledged','assigned')`;
const SELECT = `
  SELECT a.id, a.org_id, a.smartbox_id, a.camera_id, a.type, a.severity, a.title, a.detail, a.cause, a.state, a.source,
         a.first_at, a.last_at, a.count, a.cleared_at, a.auto_recovered, a.ack_at, a.resolved_at, a.resolve_note,
         s.name AS site_name, c.code AS cabinet_code, c.name AS cabinet_name, b.device_id,
         ua.display_name AS ack_by_name, us.display_name AS assignee_name, a.assignee_id, ur.display_name AS resolved_by_name
  FROM alarms a
  LEFT JOIN smartboxes b ON b.id=a.smartbox_id
  LEFT JOIN cabinets c ON c.id=b.cabinet_id
  LEFT JOIN sites s ON s.id=c.site_id
  LEFT JOIN users ua ON ua.id=a.ack_by
  LEFT JOIN users us ON us.id=a.assignee_id
  LEFT JOIN users ur ON ur.id=a.resolved_by`;

@Injectable()
export class AlarmsService {
  private rules = new Map<string, { severity: string; enabled: boolean; name: string }>();
  private rulesAt = 0;
  constructor(private readonly db: DbService, private readonly bus: Bus, private readonly audit: AuditService) {}

  private async rule(orgId: string, key: string) {
    if (Date.now() - this.rulesAt > 60_000) {
      this.rules.clear();
      for (const r of await this.db.query('SELECT org_id, key, name, severity, enabled FROM alarm_rules ORDER BY org_id NULLS FIRST')) {
        this.rules.set(`${r.org_id ?? '*'}|${r.key}`, r);
      }
      this.rulesAt = Date.now();
    }
    return this.rules.get(`${orgId}|${key}`) ?? this.rules.get(`*|${key}`) ?? null;
  }

  async get(id: string) { return this.db.one(`${SELECT} WHERE a.id=$1`, [id]); }

  private async publish(id: string) {
    const a = await this.get(id);
    if (a) this.bus.emit(a.org_id, 'alarm', a);
    return a;
  }

  /** 장애 발생(같은 dedup_key의 미종결 장애가 있으면 횟수만 증가) */
  async raise(p: { orgId: string; smartboxId?: string | null; ruleKey: string; dedupKey: string; title?: string; detail?: any; source?: 'device' | 'system' | 'vms'; severity?: string; at?: Date; cause?: string }) {
    const r = await this.rule(p.orgId, p.ruleKey);
    if (r && !r.enabled) return null;
    const severity = p.severity ?? r?.severity ?? 'warning';
    const title = p.title ?? r?.name ?? p.ruleKey;
    const at = p.at ?? new Date();
    const row = await this.db.one(`
      INSERT INTO alarms(org_id, smartbox_id, dedup_key, type, severity, title, detail, cause, state, source, first_at, last_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$10)
      ON CONFLICT (org_id, dedup_key) WHERE state IN ('open','acknowledged','assigned')
      DO UPDATE SET last_at=EXCLUDED.last_at, count=alarms.count+1, cleared_at=NULL, detail=EXCLUDED.detail,
                    severity=CASE WHEN array_position(ARRAY['info','warning','major','critical'], EXCLUDED.severity) > array_position(ARRAY['info','warning','major','critical'], alarms.severity) THEN EXCLUDED.severity ELSE alarms.severity END
      RETURNING id`,
      [p.orgId, p.smartboxId ?? null, p.dedupKey, p.ruleKey, severity, title, JSON.stringify(p.detail ?? {}), p.cause ?? null, p.source ?? 'device', at]);
    return this.publish(row!.id);
  }

  /** 장치가 정상 복귀를 알림 — 장애는 관제요원이 종결할 때까지 남기되 복귀 시각을 기록 */
  async clear(orgId: string, dedupKey: string, at = new Date()) {
    const rows = await this.db.query(`UPDATE alarms SET cleared_at=$3 WHERE org_id=$1 AND dedup_key=$2 AND state IN ${ACTIVE} AND cleared_at IS NULL RETURNING id`, [orgId, dedupKey, at]);
    for (const r of rows) await this.publish(r.id);
  }

  async list(u: AuthUser, q: { state?: string; severity?: string; smartbox_id?: string; limit?: number }) {
    const p: any[] = [];
    const w = [orgFilter(u, 'a.org_id', p)];
    if (q.state === 'active') w.push(`a.state IN ${ACTIVE}`);
    else if (q.state) { p.push(q.state); w.push(`a.state=$${p.length}`); }
    if (q.severity) { p.push(q.severity); w.push(`a.severity=$${p.length}`); }
    if (q.smartbox_id) { p.push(q.smartbox_id); w.push(`a.smartbox_id=$${p.length}`); }
    p.push(Math.min(q.limit ?? 500, 2000));
    return this.db.query(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY a.last_at DESC LIMIT $${p.length}`, p);
  }

  private async owned(u: AuthUser, id: string) {
    const a = await this.db.one('SELECT id, org_id, state FROM alarms WHERE id=$1', [id]);
    if (!a || !canSeeOrg(u, a.org_id)) throw new ApiError(404, 'NOT_FOUND', '장애를 찾을 수 없습니다');
    return a;
  }

  async ack(u: AuthUser, id: string, note?: string) {
    const a = await this.owned(u, id);
    if (a.state !== 'open') throw new ApiError(409, 'INVALID_STATE', '접수 대기 상태의 장애만 확인할 수 있습니다');
    await this.db.tx(async q => {
      await q(`UPDATE alarms SET state='acknowledged', ack_by=$2, ack_at=now() WHERE id=$1`, [id, u.id]);
      await this.audit.log(u, 'alarm.ack', 'alarm', id, { note }, q);
    });
    return this.publish(id);
  }

  async assign(u: AuthUser, id: string, userId: string) {
    const a = await this.owned(u, id);
    if (!['open', 'acknowledged', 'assigned'].includes(a.state)) throw new ApiError(409, 'INVALID_STATE', '종결된 장애입니다');
    const target = await this.db.one('SELECT id, org_id FROM users WHERE id=$1 AND active', [userId]);
    if (!target || target.org_id !== a.org_id) throw new ApiError(400, 'VALIDATION', '같은 기관의 활성 사용자에게만 배정할 수 있습니다');
    await this.db.tx(async q => {
      await q(`UPDATE alarms SET state='assigned', assignee_id=$2, assigned_at=now(), ack_by=COALESCE(ack_by,$3), ack_at=COALESCE(ack_at,now()) WHERE id=$1`, [id, userId, u.id]);
      await this.audit.log(u, 'alarm.assign', 'alarm', id, { assignee_id: userId }, q);
    });
    return this.publish(id);
  }

  async resolve(u: AuthUser, id: string, note: string) {
    const a = await this.owned(u, id);
    if (!['open', 'acknowledged', 'assigned'].includes(a.state)) throw new ApiError(409, 'INVALID_STATE', '이미 종결된 장애입니다');
    await this.db.tx(async q => {
      await q(`UPDATE alarms SET state='resolved', resolved_by=$2, resolved_at=now(), resolve_note=$3 WHERE id=$1`, [id, u.id, note]);
      await this.audit.log(u, 'alarm.resolve', 'alarm', id, { note }, q);
    });
    return this.publish(id);
  }
}
