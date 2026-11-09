import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { DbService } from '../common/db.service';
import { CryptoService, commandCanonical, hmacHex } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { Bus } from '../common/bus';
import { config } from '../common/config';
import { parse } from '../common/validate';
import { ApiError, AuthUser, canSeeOrg, orgFilter } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { AlarmsService } from '../ops/alarms.service';
import { MqttService } from './mqtt.service';
import { SHARED_ROLES } from './defaults';

const POWER = ['power_off', 'power_on', 'power_cycle'];
const ACTIVE = ['pending_approval', 'queued', 'sent', 'received'];
const ch = z.number().int().min(1).max(6);
const PARAMS: Record<string, z.ZodTypeAny> = {
  power_off: z.object({ ch }).strict(),
  power_on: z.object({ ch }).strict(),
  power_cycle: z.object({ ch, off_sec: z.number().int().min(1).max(120) }).strict(),
  alarm_out: z.object({ output: z.enum(['siren', 'strobe']), on: z.boolean(), duration_s: z.number().int().min(0).max(3600).default(0) }).strict(),
  telemetry_now: z.object({}).strict(),
  reboot_device: z.object({}).strict(),
  config_set: z.object({}).passthrough(),
};
const TYPE_KO: Record<string, string> = { power_off: '전원 차단', power_on: '전원 공급', power_cycle: '전원 재투입', alarm_out: '경보 출력', telemetry_now: '즉시 계측', reboot_device: '컨트롤러 재시작', config_set: '설정 전송' };

function newCmdId() { return 'c-' + Date.now().toString(16) + randomBytes(6).toString('hex'); }

const SELECT = `SELECT c.*, ur.display_name AS requested_by_name, ua.display_name AS approved_by_name, b.device_id
  FROM commands c JOIN smartboxes b ON b.id=c.smartbox_id
  LEFT JOIN users ur ON ur.id=c.requested_by LEFT JOIN users ua ON ua.id=c.approved_by`;

@Injectable()
export class CommandsService implements OnModuleInit {
  private readonly log = new Logger('Commands');
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly db: DbService, private readonly crypto: CryptoService, private readonly audit: AuditService,
              private readonly bus: Bus, private readonly mqtt: MqttService, private readonly auth: AuthService,
              private readonly alarms: AlarmsService) {}

  async onModuleInit() {
    // 승인 대기 만료 처리
    setInterval(() => this.expireApprovals().catch(e => this.log.error(e.message)), 15_000).unref();
  }

  /** 서버 재시작 시 진행 중이던 명령의 타이머 복원 (MQTT 연결 후 호출) */
  async recoverInflight() {
    const rows = await this.db.query(`SELECT id, status FROM commands WHERE status IN ('queued','sent','received')`);
    for (const r of rows) {
      if (r.status === 'received') this.armDone(r.id);
      else await this.dispatch(r.id).catch(e => this.log.warn(`복원 재전송 실패 ${r.id}: ${e.message}`));
    }
    if (rows.length) this.log.log(`진행 중 명령 ${rows.length}건 복원`);
  }

  async get(id: string) { return this.db.one(`${SELECT} WHERE c.id=$1`, [id]); }
  private async publish(id: string) { const c = await this.get(id); if (c) this.bus.emit(c.org_id, 'command', c); return c; }

  async list(u: AuthUser, q: { smartbox_id?: string; status?: string; limit?: number }) {
    const p: any[] = []; const w = [orgFilter(u, 'c.org_id', p)];
    if (q.smartbox_id) { p.push(q.smartbox_id); w.push(`c.smartbox_id=$${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`c.status=$${p.length}`); }
    p.push(Math.min(q.limit ?? 200, 1000));
    return this.db.query(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY c.created_at DESC LIMIT $${p.length}`, p);
  }

  /** 사용자 명령 생성 */
  async create(u: AuthUser, smartboxId: string, body: any, stepUp: string | undefined) {
    const d = parse(z.object({ type: z.enum(['power_off', 'power_on', 'power_cycle', 'alarm_out', 'telemetry_now', 'reboot_device']), params: z.any().default({}), reason: z.string().max(500).optional() }), body);
    const params: any = parse(PARAMS[d.type], d.params ?? {});
    const box = await this.db.one('SELECT id, org_id, online, device_id, decommissioned FROM smartboxes WHERE id=$1', [smartboxId]);
    if (!box || !canSeeOrg(u, box.org_id)) throw new ApiError(404, 'NOT_FOUND', '스마트박스를 찾을 수 없습니다');
    if (box.decommissioned) throw new ApiError(409, 'DECOMMISSIONED', '사용 중지된 장치입니다');

    let requiresApproval = false;
    let channel: any = null;
    if (POWER.includes(d.type)) {
      if (!u.permissions.includes('device.control.power')) throw new ApiError(403, 'FORBIDDEN', '전원 제어 권한이 없습니다');
      await this.auth.requireStepUp(u, stepUp);
      if (!d.reason || d.reason.trim().length < 2) throw new ApiError(400, 'VALIDATION', '전원 제어 사유를 입력하세요');
      channel = await this.db.one('SELECT * FROM smartbox_channels WHERE smartbox_id=$1 AND ch=$2', [box.id, params.ch]);
      if (!channel) throw new ApiError(400, 'VALIDATION', '채널 정보가 없습니다');
      requiresApproval = channel.shared && d.type !== 'power_on';
      const busy = await this.db.one(`SELECT id FROM commands WHERE smartbox_id=$1 AND type = ANY($2) AND (params->>'ch')::int=$3 AND status = ANY($4) LIMIT 1`,
        [box.id, POWER, params.ch, ACTIVE]);
      if (busy) throw new ApiError(409, 'BUSY', `같은 채널에 처리 중인 명령이 있습니다 (${busy.id})`);
    } else if (d.type === 'alarm_out' || d.type === 'reboot_device') {
      if (!u.permissions.includes('device.control.alarm') && d.type === 'alarm_out') throw new ApiError(403, 'FORBIDDEN', '경보 출력 권한이 없습니다');
      if (d.type === 'reboot_device') {
        if (!u.permissions.includes('device.write')) throw new ApiError(403, 'FORBIDDEN', '장치 설정 권한이 없습니다');
        await this.auth.requireStepUp(u, stepUp);
      }
    } else if (!u.permissions.includes('device.read')) throw new ApiError(403, 'FORBIDDEN', '권한이 없습니다');
    if (!requiresApproval && !box.online) throw new ApiError(409, 'DEVICE_OFFLINE', '장치가 오프라인이라 명령을 보낼 수 없습니다');

    const id = newCmdId();
    await this.db.tx(async q => {
      await q(`INSERT INTO commands(id, org_id, smartbox_id, type, params, reason, status, requires_approval, requested_by, approval_expires_at, source)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'user')`,
        [id, box.org_id, box.id, d.type, JSON.stringify(params), d.reason ?? null, requiresApproval ? 'pending_approval' : 'queued', requiresApproval, u.id,
         requiresApproval ? new Date(Date.now() + config.command.approvalTtlMs) : null]);
      await this.audit.log(u, requiresApproval ? 'command.request_approval' : 'command.create', 'command', id,
        { smartbox_id: box.id, device_id: box.device_id, type: d.type, params, reason: d.reason, channel_role: channel?.role, shared: channel?.shared ?? false }, q);
    });
    if (!requiresApproval) await this.dispatch(id);
    return this.publish(id);
  }

  /** 서버 내부 명령(설정 전송 등). 재인증·승인 없음, 감사로그 남김 */
  async createSystem(smartboxId: string, type: string, params: any, reason: string, actor: AuthUser | null) {
    const box = await this.db.one('SELECT id, org_id, online FROM smartboxes WHERE id=$1', [smartboxId]);
    if (!box) return null;
    const id = newCmdId();
    await this.db.query(`INSERT INTO commands(id, org_id, smartbox_id, type, params, reason, status, requested_by, source) VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,'system')`,
      [id, box.org_id, box.id, type, JSON.stringify(params), reason, actor?.id ?? null]);
    await this.audit.log(actor ?? { org_id: box.org_id, username: 'system' }, 'command.create_system', 'command', id, { smartbox_id: box.id, type, reason });
    if (box.online) await this.dispatch(id).catch(e => this.log.warn(e.message));
    return this.publish(id);
  }

  async approve(u: AuthUser, id: string, stepUp: string | undefined) {
    const c = await this.db.one('SELECT * FROM commands WHERE id=$1', [id]);
    if (!c || !canSeeOrg(u, c.org_id)) throw new ApiError(404, 'NOT_FOUND', '명령을 찾을 수 없습니다');
    if (!u.permissions.includes('command.approve')) throw new ApiError(403, 'FORBIDDEN', '승인 권한이 없습니다');
    await this.auth.requireStepUp(u, stepUp);
    if (c.status !== 'pending_approval') throw new ApiError(409, 'INVALID_STATE', '승인 대기 상태가 아닙니다');
    if (c.requested_by === u.id) throw new ApiError(403, 'SAME_USER', '요청자 본인은 승인할 수 없습니다(이중 승인)');
    if (c.approval_expires_at && new Date(c.approval_expires_at) < new Date()) throw new ApiError(409, 'EXPIRED', '승인 유효시간이 지났습니다');
    const box = await this.db.one('SELECT online FROM smartboxes WHERE id=$1', [c.smartbox_id]);
    if (!box?.online) throw new ApiError(409, 'DEVICE_OFFLINE', '장치가 오프라인이라 실행할 수 없습니다');
    const upd = await this.db.tx(async q => {
      const r = await q(`UPDATE commands SET status='queued', approved_by=$2 WHERE id=$1 AND status='pending_approval' RETURNING id`, [id, u.id]);
      if (r.length) await this.audit.log(u, 'command.approve', 'command', id, { type: c.type, params: c.params }, q);
      return r.length;
    });
    if (!upd) throw new ApiError(409, 'INVALID_STATE', '이미 처리된 명령입니다');
    await this.dispatch(id);
    return this.publish(id);
  }

  async reject(u: AuthUser, id: string, reason: string) {
    const c = await this.db.one('SELECT * FROM commands WHERE id=$1', [id]);
    if (!c || !canSeeOrg(u, c.org_id)) throw new ApiError(404, 'NOT_FOUND', '명령을 찾을 수 없습니다');
    if (c.status !== 'pending_approval') throw new ApiError(409, 'INVALID_STATE', '승인 대기 상태가 아닙니다');
    if (!u.permissions.includes('command.approve') && c.requested_by !== u.id) throw new ApiError(403, 'FORBIDDEN', '권한이 없습니다');
    await this.db.tx(async q => {
      await q(`UPDATE commands SET status='cancelled', rejected_reason=$2, finished_at=now() WHERE id=$1`, [id, reason]);
      await this.audit.log(u, 'command.reject', 'command', id, { reason }, q);
    });
    return this.publish(id);
  }

  private async expireApprovals() {
    const rows = await this.db.query(`UPDATE commands SET status='expired', finished_at=now() WHERE status='pending_approval' AND approval_expires_at < now() RETURNING id, org_id`);
    for (const r of rows) { await this.audit.log({ org_id: r.org_id, username: 'system' }, 'command.approval_expired', 'command', r.id, {}); await this.publish(r.id); }
  }

  /** 장치로 송신 (같은 cmd_id·서명으로 재전송 → 장치가 중복 실행하지 않음) */
  async dispatch(id: string) {
    const c = await this.db.one(`SELECT c.*, b.device_id, b.cmd_secret_enc FROM commands c JOIN smartboxes b ON b.id=c.smartbox_id WHERE c.id=$1`, [id]);
    if (!c || !['queued', 'sent'].includes(c.status)) return;
    let ts = Number(c.ts), exp = Number(c.exp);
    if (!c.ts) { ts = Date.now(); exp = ts + config.command.expiryMs; }
    const msg = { cmd_id: c.id, ts, exp, type: c.type, params: c.params };
    const sig = hmacHex(this.crypto.decrypt(c.cmd_secret_enc), commandCanonical(msg));
    if (c.attempts >= config.command.maxAttempts) return this.finish(id, 'timeout', '장치 응답 없음 (재전송 한도 초과)', null);
    const upd = await this.db.query(`UPDATE commands SET status='sent', ts=$2, exp=$3, attempts=attempts+1, sent_at=COALESCE(sent_at, now()) WHERE id=$1 AND status IN ('queued','sent') RETURNING id`, [id, ts, exp]);
    if (!upd.length) return; // 그 사이 응답을 받아 상태가 바뀜
    try {
      await this.mqtt.publish(`eum/v1/${c.device_id}/cmd`, { ...msg, sig }, 1);
    } catch (e: any) {
      this.log.warn(`명령 송신 실패 ${id}: ${e.message}`);
    }
    await this.publish(id);
    this.setTimer(id, config.command.receivedTimeoutMs, () => this.dispatch(id));
  }

  private setTimer(id: string, ms: number, fn: () => any) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); Promise.resolve(fn()).catch(e => this.log.error(e.message)); }, ms));
  }

  private async armDone(id: string) {
    const c = await this.db.one('SELECT type, params, acked_at FROM commands WHERE id=$1', [id]);
    if (!c) return;
    const total = c.type === 'power_cycle' ? (Number(c.params.off_sec) + 30) * 1000 : config.command.defaultDoneTimeoutMs;
    const elapsed = c.acked_at ? Date.now() - new Date(c.acked_at).getTime() : 0;
    this.setTimer(id, Math.max(1000, total - elapsed), () => this.finish(id, 'timeout', '실행 결과 응답 없음', null));
  }

  async onAck(deviceId: string, ack: any) {
    if (!ack || typeof ack.cmd_id !== 'string') return;
    const c = await this.db.one(`SELECT c.id, c.status, c.type, c.params, c.smartbox_id FROM commands c JOIN smartboxes b ON b.id=c.smartbox_id WHERE c.id=$1 AND b.device_id=$2`, [ack.cmd_id, deviceId]);
    if (!c) { this.log.warn(`알 수 없는 ack ${deviceId} ${ack.cmd_id}`); return; }
    if (['done', 'failed', 'rejected', 'timeout', 'cancelled', 'expired'].includes(c.status)) return; // 이미 종결
    if (ack.stage === 'received') {
      const r = await this.db.query(`UPDATE commands SET status='received', acked_at=now() WHERE id=$1 AND status IN ('queued','sent') RETURNING id`, [c.id]);
      if (!r.length) return;
      clearTimeout(this.timers.get(c.id));
      await this.armDone(c.id);
      await this.publish(c.id);
    } else if (ack.stage === 'done') {
      await this.finish(c.id, 'done', null, ack.result ?? null);
    } else if (ack.stage === 'rejected' || ack.stage === 'failed') {
      await this.finish(c.id, ack.stage, String(ack.error ?? 'unknown'), ack.result ?? null);
    }
  }

  private async finish(id: string, status: 'done' | 'failed' | 'rejected' | 'timeout', error: string | null, result: any) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const r = await this.db.one(`UPDATE commands SET status=$2, error=$3, result=$4, finished_at=now() WHERE id=$1 AND status NOT IN ('done','failed','rejected','timeout','cancelled','expired') RETURNING *`,
      [id, status, error, result ? JSON.stringify(result) : null]);
    if (!r) return;
    await this.audit.log({ org_id: r.org_id, username: 'system' }, `command.${status}`, 'command', id, { type: r.type, params: r.params, error, result });
    if (status !== 'done' && r.source === 'user') {
      await this.alarms.raise({ orgId: r.org_id, smartboxId: r.smartbox_id, ruleKey: 'command_failed', dedupKey: `cmd:${id}`, source: 'system',
        title: `원격 명령 실패 — ${TYPE_KO[r.type] ?? r.type}${r.params?.ch ? ` CH${r.params.ch}` : ''}`, detail: { command_id: id, status, error } });
    }
    await this.publish(id);
  }

  /** 장치 오프라인 전환 시 미완료 명령은 결과 미확인으로 종료 */
  async failInflightForDevice(smartboxId: string) {
    const rows = await this.db.query(`SELECT id FROM commands WHERE smartbox_id=$1 AND status IN ('queued','sent')`, [smartboxId]);
    for (const r of rows) await this.finish(r.id, 'timeout', '장치 오프라인', null);
  }
}

export const COMMAND_TYPE_KO = TYPE_KO;
export { SHARED_ROLES };
