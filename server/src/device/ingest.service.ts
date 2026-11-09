import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '../common/db.service';
import { Bus } from '../common/bus';
import { AuditService } from '../common/audit.service';
import { AlarmsService } from '../ops/alarms.service';
import { CommandsService } from './commands.service';
import { MqttService } from './mqtt.service';
import { INPUTS } from './defaults';

interface BoxRef { id: string; org_id: string; device_id: string; interval: number }
const TOPIC = /^eum\/v1\/(SB-[0-9a-f]{12})\/(status|hello|telemetry|event|ack)$/;
const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : null);

/** 장치 → 서버 메시지 처리 (상태·계측·이벤트·명령 응답) */
@Injectable()
export class IngestService implements OnModuleInit {
  private readonly log = new Logger('Ingest');
  private cache = new Map<string, BoxRef>();
  private envState = new Map<string, boolean>(); // `${box}|${key}` → 경보 중
  // 부하를 줄이기 위한 최근 상태 캐시 — 바뀐 값만 DB에 반영
  private onlineCache = new Map<string, boolean>();
  private chanCache = new Map<string, string>();
  private inputCache = new Map<string, Record<string, boolean>>();

  constructor(private readonly db: DbService, private readonly bus: Bus, private readonly audit: AuditService,
              private readonly alarms: AlarmsService, private readonly cmds: CommandsService, private readonly mqtt: MqttService) {}

  onModuleInit() {
    this.mqtt.onMessage((t, p) => this.handle(t, p).catch(e => this.log.error(`${t}: ${e.message}`)));
    setInterval(() => this.offlineSweep().catch(e => this.log.error(e.message)), 5000).unref();
  }

  invalidate(deviceId: string) { this.cache.delete(deviceId); }

  private async box(deviceId: string): Promise<BoxRef | null> {
    const c = this.cache.get(deviceId);
    if (c) return c;
    const r = await this.db.one(`SELECT id, org_id, device_id, COALESCE((config->>'telemetry_interval_s')::int, 10) AS interval FROM smartboxes WHERE device_id=$1 AND NOT decommissioned`, [deviceId]);
    if (r) this.cache.set(deviceId, r);
    return r;
  }

  async handle(topic: string, payload: Buffer) {
    const m = TOPIC.exec(topic);
    if (!m || payload.length > 65536) return;
    const [, deviceId, kind] = m;
    const b = await this.box(deviceId);
    if (!b) { this.log.warn(`등록되지 않은 장치 메시지: ${topic}`); return; }
    let msg: any;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { this.log.warn(`JSON 오류: ${topic}`); return; }
    if (!msg || typeof msg !== 'object') return;
    switch (kind) {
      case 'status': return this.setOnline(b, msg.online === true, msg.online === true ? 'status' : 'lwt');
      case 'hello': return this.onHello(b, msg);
      case 'telemetry': return this.onTelemetry(b, msg);
      case 'event': return this.onEvent(b, msg);
      case 'ack': return this.cmds.onAck(deviceId, msg);
    }
  }

  private deviceTime(msg: any): Date {
    const ts = Number(msg.ts);
    if (ts > 0 && Math.abs(ts - Date.now()) < 86_400_000) return new Date(ts);
    return new Date();
  }

  async setOnline(b: BoxRef, online: boolean, reason: string) {
    if (online && this.onlineCache.get(b.id) === true) return;
    this.onlineCache.set(b.id, online);
    const r = await this.db.one(`UPDATE smartboxes SET online=$2, last_seen_at = CASE WHEN $2 THEN now() ELSE last_seen_at END
      WHERE id=$1 AND online IS DISTINCT FROM $2 RETURNING id`, [b.id, online]);
    if (!r) return;
    await this.audit.log({ org_id: b.org_id, username: `device:${b.device_id}` }, online ? 'device.online' : 'device.offline', 'smartbox', b.id, { device_id: b.device_id, reason });
    this.bus.emit(b.org_id, 'device_status', { smartbox_id: b.id, online, ts: Date.now() });
    if (online) await this.alarms.clear(b.org_id, `offline:${b.id}`);
    else {
      await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: 'device_offline', dedupKey: `offline:${b.id}`, source: 'system', detail: { reason } });
      await this.cmds.failInflightForDevice(b.id);
    }
  }

  private async offlineSweep() {
    const rows = await this.db.query(`SELECT id, org_id, device_id, COALESCE((config->>'telemetry_interval_s')::int,10) AS interval FROM smartboxes
      WHERE online AND last_seen_at < now() - make_interval(secs => COALESCE((config->>'telemetry_interval_s')::int,10) * 3 + 10)`);
    for (const r of rows) await this.setOnline(r, false, 'telemetry_timeout');
  }

  private async onHello(b: BoxRef, msg: any) {
    const box = await this.db.one(`UPDATE smartboxes SET last_hello=$2, fw_version=$3, hw_rev=$4, last_seen_at=now() WHERE id=$1 RETURNING config, config_version`,
      [b.id, JSON.stringify(msg), String(msg.fw ?? ''), String(msg.hw_rev ?? '')]);
    await this.setOnline(b, true, 'hello');
    await this.audit.log({ org_id: b.org_id, username: `device:${b.device_id}` }, 'device.hello', 'smartbox', b.id, { device_id: b.device_id, fw: msg.fw, boot_reason: msg.boot_reason, ip: msg.ip });
    if (box && Number(msg.config_version) !== Number(box.config_version)) {
      await this.cmds.createSystem(b.id, 'config_set', { ...box.config, config_version: box.config_version }, '장치 설정 버전 불일치 — 서버 설정 전송', null);
    }
  }

  private async onTelemetry(b: BoxRef, msg: any) {
    const at = this.deviceTime(msg);
    const ac = msg.ac && typeof msg.ac === 'object' ? msg.ac : null;
    const dc = msg.dc && typeof msg.dc === 'object' ? msg.dc : null;
    const env = msg.env && typeof msg.env === 'object' ? msg.env : null;
    await this.db.query(`INSERT INTO telemetry(smartbox_id, ts, org_id, t, rh, ac_v, ac_a, ac_w, ac_kwh, dc_in_v, dc_in_a, batt_v, data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (smartbox_id, ts) DO NOTHING`,
      [b.id, at, b.org_id, num(env?.t), num(env?.rh), num(ac?.v), num(ac?.a), num(ac?.w), num(ac?.kwh), num(dc?.in_v), num(dc?.in_a), num(dc?.batt_v), JSON.stringify(msg)]);
    const data = { ...msg, received_at: new Date().toISOString() };
    await this.db.query(`UPDATE smartboxes SET last_telemetry=$2, last_seen_at=now() WHERE id=$1`, [b.id, JSON.stringify(data)]);
    await this.setOnline(b, true, 'telemetry');

    if (Array.isArray(msg.relays) && Array.isArray(msg.loads)) {
      const coil = [0, 1, 2, 3, 4, 5].map(i => (typeof msg.relays[i] === 'boolean' ? msg.relays[i] : null));
      const load = [0, 1, 2, 3, 4, 5].map(i => (typeof msg.loads[i] === 'boolean' ? msg.loads[i] : null));
      const key = JSON.stringify([coil, load]);
      if (this.chanCache.get(b.id) !== key) {
        this.chanCache.set(b.id, key);
        await this.db.query(`UPDATE smartbox_channels c SET coil_on=v.coil, load_on=v.load, updated_at=now()
          FROM unnest($2::int[], $3::boolean[], $4::boolean[]) AS v(ch, coil, load)
          WHERE c.smartbox_id=$1 AND c.ch=v.ch AND (c.coil_on IS DISTINCT FROM v.coil OR c.load_on IS DISTINCT FROM v.load)`, [b.id, [1, 2, 3, 4, 5, 6], coil, load]);
      }
    }
    if (msg.inputs && typeof msg.inputs === 'object') {
      const prev = this.inputCache.get(b.id) ?? {};
      for (const inp of INPUTS) {
        const v = msg.inputs[inp.key];
        if (typeof v === 'boolean' && prev[inp.key] !== v) { await this.setInput(b, inp.key, v, at, 'telemetry'); prev[inp.key] = v; }
      }
      this.inputCache.set(b.id, prev);
    }
    if (env) await this.checkEnv(b, env);
    this.bus.emit(b.org_id, 'telemetry', { smartbox_id: b.id, data });
  }

  /** 입력 상태 변화를 감지해 장애 발생/복귀 처리 (이벤트·계측 어느 쪽으로 와도 한 번만) */
  private async setInput(b: BoxRef, key: string, value: boolean, at: Date, via: string) {
    const r = await this.db.one(`UPDATE smartbox_inputs SET active=$3, changed_at=$4 WHERE smartbox_id=$1 AND key=$2 AND active IS DISTINCT FROM $3 RETURNING name, severity`, [b.id, key, value, at]);
    if (!r) return;
    const dk = `input:${b.id}:${key}`;
    if (value) await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: `input.${key}`, dedupKey: dk, title: r.name, severity: r.severity, detail: { input: key, via }, at });
    else await this.alarms.clear(b.org_id, dk, at);
  }

  private async checkEnv(b: BoxRef, env: any) {
    const checks: [string, number | null, (v: number) => boolean, (v: number) => boolean][] = [
      ['env.overtemp', num(env.t), v => v >= 55, v => v <= 52],
      ['env.undertemp', num(env.t), v => v <= -15, v => v >= -12],
      ['env.humidity', num(env.rh), v => v >= 90, v => v <= 85],
    ];
    for (const [key, v, on, off] of checks) {
      if (v === null) continue;
      const k = `${b.id}|${key}`; const active = this.envState.get(k) ?? false;
      if (!active && on(v)) { this.envState.set(k, true); await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: key, dedupKey: `${key}:${b.id}`, detail: { value: v } }); }
      else if (active && off(v)) { this.envState.set(k, false); await this.alarms.clear(b.org_id, `${key}:${b.id}`); }
    }
  }

  private async onEvent(b: BoxRef, ev: any) {
    if (typeof ev.id !== 'string' || typeof ev.type !== 'string') return;
    const at = this.deviceTime(ev);
    const sev = ['critical', 'major', 'warning', 'info'].includes(ev.severity) ? ev.severity : 'info';
    const row = await this.db.one(`INSERT INTO device_events(org_id, smartbox_id, device_event_id, ts, type, severity, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (smartbox_id, device_event_id) DO NOTHING RETURNING *`, [b.org_id, b.id, ev.id.slice(0, 64), at, ev.type.slice(0, 40), sev, JSON.stringify(ev.data ?? {})]);
    if (!row) return; // 중복 수신
    this.bus.emit(b.org_id, 'device_event', { smartbox_id: b.id, event: row });
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'input_change':
        if (INPUTS.some(i => i.key === d.input) && typeof d.value === 'boolean') {
          await this.setInput(b, d.input, d.value, at, 'event');
          const prev = this.inputCache.get(b.id) ?? {}; prev[d.input] = d.value; this.inputCache.set(b.id, prev);
        }
        break;
      case 'shock': case 'tilt':
        await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: ev.type, dedupKey: `${ev.type}:${b.id}`, detail: d, at });
        break;
      case 'sensor_fault':
        await this.db.query(`INSERT INTO sensors(smartbox_id, kind, status, fault_since) VALUES ($1,$2,'fault',$3)
          ON CONFLICT (smartbox_id, kind) DO UPDATE SET status='fault', fault_since=COALESCE(sensors.fault_since, EXCLUDED.fault_since)`, [b.id, String(d.sensor ?? 'unknown'), at]);
        await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: 'sensor_fault', dedupKey: `sensor:${b.id}:${d.sensor}`, title: `센서 이상 — ${d.sensor}`, detail: d, at });
        break;
      case 'recovery':
        await this.db.query(`INSERT INTO recovery_actions(org_id, smartbox_id, step, result, detail, source) VALUES ($1,$2,$3,$4,$5,'device')`,
          [b.org_id, b.id, String(d.step ?? 'unknown'), String(d.result ?? 'unknown'), JSON.stringify(d)]);
        await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: 'recovery', dedupKey: `recovery:${b.id}:${d.target_ip ?? d.ch ?? ''}`,
          title: d.step === 'gave_up' ? `자동복구 한도 초과 — 현장 확인 필요 (${d.target_ip ?? ''})` : `현장 자동복구 실행 (${d.target_ip ?? ''})`,
          severity: d.step === 'gave_up' ? 'major' : 'warning', detail: d, at });
        break;
      case 'env_alarm':
        await this.alarms.raise({ orgId: b.org_id, smartboxId: b.id, ruleKey: d.kind === 'humidity' ? 'env.humidity' : d.kind === 'undertemp' ? 'env.undertemp' : 'env.overtemp',
          dedupKey: `${d.kind === 'humidity' ? 'env.humidity' : d.kind === 'undertemp' ? 'env.undertemp' : 'env.overtemp'}:${b.id}`, detail: d, at });
        break;
    }
  }
}
