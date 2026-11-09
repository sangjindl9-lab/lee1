import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { DbService } from '../common/db.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { PkiService } from '../common/pki.service';
import { config } from '../common/config';
import { parse, uuid } from '../common/validate';
import { ApiError, AuthUser, CurrentUser, Perm, canSeeOrg, orgFilter } from '../auth/auth.types';
import { CommandsService } from './commands.service';
import { IngestService } from './ingest.service';
import { CHANNELS, INPUTS, SHARED_ROLES, defaultConfig } from './defaults';

const BOX_SELECT = `
  SELECT b.id, b.org_id, b.cabinet_id, b.device_id, b.serial_no, b.model, b.hw_rev, b.fw_version, b.online, b.last_seen_at,
         b.config_version, b.last_telemetry AS latest, b.created_at,
         c.code AS cabinet_code, c.name AS cabinet_name, s.id AS site_id, s.name AS site_name, c.lat, c.lng,
         (SELECT count(*)::int FROM alarms a WHERE a.smartbox_id=b.id AND a.state IN ('open','acknowledged','assigned')) AS open_alarm_count
  FROM smartboxes b JOIN cabinets c ON c.id=b.cabinet_id JOIN sites s ON s.id=c.site_id`;

@Controller()
export class SmartboxesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly crypto: CryptoService,
              private readonly pki: PkiService, private readonly cmds: CommandsService, private readonly ingest: IngestService) {}

  private async withDetails(rows: any[]) {
    if (!rows.length) return rows;
    const ids = rows.map(r => r.id);
    const ch = await this.db.query(`SELECT smartbox_id, ch, name, role, contact, shared, coil_on, load_on FROM smartbox_channels WHERE smartbox_id = ANY($1) ORDER BY ch`, [ids]);
    const ins = await this.db.query(`SELECT smartbox_id, key, name, polarity, severity, active, changed_at FROM smartbox_inputs WHERE smartbox_id = ANY($1)`, [ids]);
    const order = INPUTS.map(i => i.key);
    for (const r of rows) {
      r.channels = ch.filter(c => c.smartbox_id === r.id).map(({ smartbox_id, ...c }) => c);
      r.inputs = ins.filter(c => c.smartbox_id === r.id).map(({ smartbox_id, ...c }) => c).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    }
    return rows;
  }

  private async owned(u: AuthUser, id: string) {
    parse(uuid, id);
    const r = await this.db.one('SELECT id, org_id, device_id FROM smartboxes WHERE id=$1', [id]);
    if (!r || !canSeeOrg(u, r.org_id)) throw new ApiError(404, 'NOT_FOUND', '스마트박스를 찾을 수 없습니다');
    return r;
  }

  @Get('smartboxes') @Perm('device.read')
  async list(@CurrentUser() u: AuthUser) {
    const p: any[] = [];
    return this.withDetails(await this.db.query(`${BOX_SELECT} WHERE ${orgFilter(u, 'b.org_id', p)} AND NOT b.decommissioned ORDER BY s.name, c.code`, p));
  }

  @Get('smartboxes/:id') @Perm('device.read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.owned(u, id);
    const [r] = await this.withDetails(await this.db.query(`${BOX_SELECT} WHERE b.id=$1`, [id]));
    return r;
  }

  /** 장치 등록 + 프로비저닝 묶음(인증서·명령 비밀키)은 이 응답에서 1회만 제공 */
  @Post('smartboxes') @Perm('device.write')
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const d = parse(z.object({ cabinet_id: uuid, serial_no: z.string().max(60).nullish(), model: z.string().max(40).nullish() }), b);
    const cab = await this.db.one('SELECT id, org_id FROM cabinets WHERE id=$1', [d.cabinet_id]);
    if (!cab || !canSeeOrg(u, cab.org_id)) throw new ApiError(404, 'NOT_FOUND', '함체를 찾을 수 없습니다');
    const deviceId = 'SB-' + randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('hex');
    const cert = this.pki.issue(deviceId, 'client');
    const cfg = defaultConfig();
    const row = await this.db.tx(async q => {
      const [box] = await q(`INSERT INTO smartboxes(org_id, cabinet_id, device_id, serial_no, model, cmd_secret_enc, cert_serial, cert_fingerprint, config, config_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1) RETURNING id`,
        [cab.org_id, cab.id, deviceId, d.serial_no ?? null, d.model ?? 'SB-MB01', this.crypto.encrypt(secret), cert.serial, cert.fingerprint, JSON.stringify(cfg)]);
      for (const c of CHANNELS) await q(`INSERT INTO smartbox_channels(smartbox_id, ch, name, role, contact, shared) VALUES ($1,$2,$3,$4,$5,$6)`, [box.id, c.ch, c.name, c.role, c.contact, SHARED_ROLES.includes(c.role)]);
      for (const i of INPUTS) await q(`INSERT INTO smartbox_inputs(smartbox_id, key, name, severity) VALUES ($1,$2,$3,$4)`, [box.id, i.key, i.name, i.severity]);
      await this.audit.log(u, 'smartbox.create', 'smartbox', box.id, { device_id: deviceId, cabinet_id: cab.id, cert_fingerprint: cert.fingerprint }, q);
      return box;
    });
    const out = await this.get(u, row.id);
    return {
      ...out,
      provisioning: {
        device_id: deviceId, cmd_secret: secret, mqtt_host: config.mqtt.publicHost, mqtt_port: config.mqtt.publicPort,
        ca_cert_pem: this.pki.caPem, client_cert_pem: cert.certPem, client_key_pem: cert.keyPem,
      },
    };
  }

  @Patch('smartboxes/:id/channels/:ch') @Perm('device.write')
  async patchChannel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('ch') chStr: string, @Body() b: any) {
    const box = await this.owned(u, id);
    const ch = parse(z.coerce.number().int().min(1).max(6), chStr);
    const d = parse(z.object({ name: z.string().min(1).max(40).optional(), role: z.enum(['poe_switch', 'optic_converter', 'fan', 'heater', 'camera', 'spare', 'other']).optional(), contact: z.enum(['NC', 'NO']).optional() }), b);
    const row = await this.db.tx(async q => {
      const [cur] = await q('SELECT * FROM smartbox_channels WHERE smartbox_id=$1 AND ch=$2 FOR UPDATE', [id, ch]);
      const m = { ...cur, ...d };
      const [r] = await q(`UPDATE smartbox_channels SET name=$3, role=$4, contact=$5, shared=$6, updated_at=now() WHERE smartbox_id=$1 AND ch=$2
        RETURNING ch, name, role, contact, shared, coil_on, load_on`, [id, ch, m.name, m.role, m.contact, SHARED_ROLES.includes(m.role)]);
      if (d.role !== undefined || d.contact !== undefined) {
        const chans = await q('SELECT ch, contact, role FROM smartbox_channels WHERE smartbox_id=$1 ORDER BY ch', [id]);
        await q(`UPDATE smartboxes SET config = jsonb_set(config, '{channels}', $2::jsonb) || jsonb_build_object('config_version', config_version+1), config_version=config_version+1 WHERE id=$1`,
          [id, JSON.stringify(chans)]);
      }
      await this.audit.log(u, 'smartbox.channel_update', 'smartbox', id, { ch, ...d }, q);
      return r;
    });
    if (d.role !== undefined || d.contact !== undefined) {
      const box2 = await this.db.one('SELECT config, config_version FROM smartboxes WHERE id=$1', [id]);
      await this.cmds.createSystem(id, 'config_set', { ...box2.config, config_version: box2.config_version }, `CH${ch} 설정 변경`, u);
    }
    this.ingest.invalidate(box.device_id);
    return row;
  }

  @Get('smartboxes/:id/telemetry') @Perm('device.read')
  async telemetry(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    await this.owned(u, id);
    const f = from ? new Date(from) : new Date(Date.now() - 86400_000);
    const t = to ? new Date(to) : new Date();
    if (isNaN(+f) || isNaN(+t)) throw new ApiError(400, 'VALIDATION', '시각 형식이 올바르지 않습니다');
    const n = Math.min(parseInt(limit || '2000', 10) || 2000, 20000);
    return this.db.query(`SELECT ts, received_at, data FROM telemetry WHERE smartbox_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts DESC LIMIT $4`, [id, f, t, n]);
  }

  @Get('smartboxes/:id/events') @Perm('device.read')
  async events(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    await this.owned(u, id);
    return this.db.query(`SELECT id, device_event_id, ts, type, severity, data, received_at FROM device_events WHERE smartbox_id=$1 ORDER BY ts DESC LIMIT $2`,
      [id, Math.min(parseInt(limit || '100', 10) || 100, 1000)]);
  }

  @Post('smartboxes/:id/commands')
  async command(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any, @Headers('x-step-up-token') stepUp?: string) {
    parse(uuid, id);
    return this.cmds.create(u, id, b, stepUp);
  }
}
