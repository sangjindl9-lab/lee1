import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type RtEvent = 'telemetry' | 'device_status' | 'device_event' | 'alarm' | 'command';

/** 서비스 → 실시간 게이트웨이 전달용. org_id 단위로 방송한다. */
@Injectable()
export class Bus {
  private readonly ee = new EventEmitter();
  constructor() { this.ee.setMaxListeners(50); }
  emit(orgId: string, event: RtEvent, payload: any) { this.ee.emit('rt', { orgId, event, payload }); }
  on(fn: (m: { orgId: string; event: RtEvent; payload: any }) => void) { this.ee.on('rt', fn); }
}
