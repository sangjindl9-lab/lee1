import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbService } from './common/db.service';
import { CryptoService } from './common/crypto.service';
import { PkiService } from './common/pki.service';
import { AuditService } from './common/audit.service';
import { Bus } from './common/bus';
import { RealtimeGateway } from './common/realtime.gateway';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { AdminController } from './core/admin.controller';
import { SitesController } from './core/sites.controller';
import { MqttService } from './device/mqtt.service';
import { CommandsService } from './device/commands.service';
import { IngestService } from './device/ingest.service';
import { SmartboxesController } from './device/smartboxes.controller';
import { AlarmsService } from './ops/alarms.service';
import { OpsController } from './ops/ops.controller';
import { RetentionService } from './ops/retention.service';

@Module({
  controllers: [AuthController, AdminController, SitesController, SmartboxesController, OpsController],
  providers: [
    DbService, CryptoService, PkiService, AuditService, Bus, RealtimeGateway,
    AuthService, MqttService, AlarmsService, CommandsService, IngestService, RetentionService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
