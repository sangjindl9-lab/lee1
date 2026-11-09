import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from '../common/db.service';

/** 데이터 보존정책: system_settings.retention 값에 따라 매일 오래된 계측·이벤트 정리 (감사로그는 삭제하지 않음) */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly log = new Logger('Retention');
  constructor(private readonly db: DbService) {}

  onModuleInit() {
    setInterval(() => this.run().catch(e => this.log.error(e.message)), 6 * 3600_000).unref();
  }

  async run() {
    const r = (await this.db.one(`SELECT value FROM system_settings WHERE key='retention'`))?.value ?? {};
    const tDays = Number(r.telemetry_days) || 400, eDays = Number(r.device_events_days) || 1095;
    const t = await this.db.query(`DELETE FROM telemetry WHERE ts < now() - make_interval(days => $1) RETURNING 1`, [tDays]);
    const e = await this.db.query(`DELETE FROM device_events WHERE ts < now() - make_interval(days => $1) RETURNING 1`, [eDays]);
    await this.db.query(`DELETE FROM sessions WHERE expires_at < now() - interval '30 days'`);
    if (t.length || e.length) this.log.log(`보존기간 정리: 계측 ${t.length}건, 이벤트 ${e.length}건`);
  }
}
