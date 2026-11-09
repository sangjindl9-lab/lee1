import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { config } from '../common/config';
import { PkiService } from '../common/pki.service';

type Handler = (topic: string, payload: Buffer) => void;

/** 관제서버 ↔ MQTT 브로커 연결 (mTLS) */
@Injectable()
export class MqttService implements OnModuleDestroy {
  private readonly log = new Logger('MQTT');
  private client: mqtt.MqttClient | null = null;
  private handlers: Handler[] = [];
  private connectHandlers: (() => void)[] = [];
  connected = false;

  constructor(private readonly pki: PkiService) {}

  start() {
    const { cert, key } = this.pki.serverClientCert();
    this.client = mqtt.connect(config.mqtt.url, {
      clientId: `eum-server-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
      ca: this.pki.caPem, cert, key,
      rejectUnauthorized: config.mqtt.rejectUnauthorized,
      protocolVersion: 4, clean: true, reconnectPeriod: 3000, connectTimeout: 10000, keepalive: 30,
    });
    this.client.on('connect', () => {
      this.connected = true;
      this.log.log(`브로커 연결됨: ${config.mqtt.url}`);
      this.client!.subscribe(['eum/v1/+/status', 'eum/v1/+/hello', 'eum/v1/+/telemetry', 'eum/v1/+/event', 'eum/v1/+/ack'], { qos: 1 });
      this.connectHandlers.forEach(h => h());
    });
    this.client.on('close', () => { if (this.connected) this.log.warn('브로커 연결 끊김 — 재접속 시도'); this.connected = false; });
    this.client.on('error', e => this.log.warn(`MQTT 오류: ${e.message}`));
    this.client.on('message', (t, p) => { for (const h of this.handlers) { try { h(t, p); } catch (e: any) { this.log.error(e.message); } } });
  }

  onMessage(h: Handler) { this.handlers.push(h); }
  onConnect(h: () => void) { this.connectHandlers.push(h); }

  publish(topic: string, payload: any, qos: 0 | 1 = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) return reject(new Error('MQTT 브로커에 연결되어 있지 않습니다'));
      this.client.publish(topic, JSON.stringify(payload), { qos }, err => (err ? reject(err) : resolve()));
    });
  }

  async onModuleDestroy() { await this.client?.endAsync().catch(() => undefined); }
}
