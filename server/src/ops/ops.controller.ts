import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../common/db.service';
import { AuditService } from '../common/audit.service';
import { MqttService } from '../device/mqtt.service';
import { CommandsService } from '../device/commands.service';
import { config } from '../common/config';
import { parse, uuid } from '../common/validate';
import { AuthUser, CurrentUser, Perm, Public, orgFilter } from '../auth/auth.types';
import { AlarmsService } from './alarms.service';

@Controller()
export class OpsController {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly mqtt: MqttService,
              private readonly alarms: AlarmsService, private readonly cmds: CommandsService) {}

  @Public() @Get('health')
  async health() {
    const db = await this.db.ping();
    return { ok: db && this.mqtt.connected, db, mqtt: this.mqtt.connected, version: config.version };
  }

  @Public() @Get('branding')
  async branding() {
    return (await this.db.one(`SELECT value FROM system_settings WHERE key='branding'`))?.value ?? {};
  }

  // ── 알람 ──
  @Get('alarms') @Perm('alarm.read')
  listAlarms(@CurrentUser() u: AuthUser, @Query() q: any) {
    const d = parse(z.object({ state: z.string().max(20).optional(), severity: z.enum(['critical', 'major', 'warning', 'info']).optional(), smartbox_id: uuid.optional(), limit: z.coerce.number().int().optional() }), q);
    return this.alarms.list(u, d);
  }
  @Post('alarms/:id/ack') @Perm('alarm.ack') @HttpCode(200)
  ack(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    return this.alarms.ack(u, parse(uuid, id), parse(z.object({ note: z.string().max(500).optional() }), b).note);
  }
  @Post('alarms/:id/assign') @Perm('alarm.manage') @HttpCode(200)
  assign(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    return this.alarms.assign(u, parse(uuid, id), parse(z.object({ user_id: uuid }), b).user_id);
  }
  @Post('alarms/:id/resolve') @Perm('alarm.manage') @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    return this.alarms.resolve(u, parse(uuid, id), parse(z.object({ note: z.string().min(1).max(1000) }), b).note);
  }

  // ── 명령 ──
  @Get('commands') @Perm('device.read')
  listCommands(@CurrentUser() u: AuthUser, @Query() q: any) {
    const d = parse(z.object({ smartbox_id: uuid.optional(), status: z.string().max(30).optional(), limit: z.coerce.number().int().optional() }), q);
    return this.cmds.list(u, d);
  }
  @Post('commands/:id/approve') @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Headers('x-step-up-token') stepUp?: string) {
    return this.cmds.approve(u, parse(z.string().max(64), id), stepUp);
  }
  @Post('commands/:id/reject') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    return this.cmds.reject(u, parse(z.string().max(64), id), parse(z.object({ reason: z.string().min(1).max(500) }), b).reason);
  }

  // ── 감사로그 ──
  @Get('audit-logs') @Perm('audit.read')
  auditLogs(@CurrentUser() u: AuthUser, @Query() q: any) {
    const d = parse(z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), before_id: z.coerce.number().int().optional(), action: z.string().max(60).optional() }), q);
    const p: any[] = []; const w = [orgFilter(u, 'org_id', p)];
    if (d.before_id) { p.push(d.before_id); w.push(`id < $${p.length}`); }
    if (d.action) { p.push(d.action + '%'); w.push(`action LIKE $${p.length}`); }
    p.push(d.limit);
    return this.db.query(`SELECT id, ts, org_id, user_id, username, action, target_type, target_id, detail, ip, prev_hash, hash FROM audit_logs WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT $${p.length}`, p);
  }
  @Get('audit-logs/verify') @Perm('audit.read')
  async verify(@CurrentUser() u: AuthUser) {
    const r = await this.audit.verify();
    await this.audit.log(u, 'audit.verify', null, null, r);
    return r;
  }
}
