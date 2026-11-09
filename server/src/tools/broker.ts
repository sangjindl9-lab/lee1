/**
 * 내장 MQTT 브로커 (aedes). 소규모 설치·시험용. 대규모 운영은 deploy/mosquitto 설정을 사용한다.
 * - TLS 필수, 클라이언트 인증서 필수(mTLS). 인증서 CN이 곧 장치 ID.
 * - ACL: 장치는 eum/v1/<자기ID>/... 만 발행, eum/v1/<자기ID>/cmd 만 구독. 'eum-server'만 전체 구독·명령 발행.
 */
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Aedes = require('aedes');
import { PkiService } from '../common/pki.service';

const port = parseInt(process.env.MQTT_PORT || '8883', 10);
const hosts = (process.env.BROKER_HOSTS || 'localhost,127.0.0.1').split(',').map(s => s.trim()).filter(Boolean);
const pki = new PkiService();
const files = pki.ensureBrokerCert(hosts);
const SERVER_CN = 'eum-server';
const DEVICE_RE = /^SB-[0-9a-f]{12}$/;

const aedes = Aedes({ id: 'eum-broker' });

/** 인증 시점의 인증서 CN을 클라이언트에 고정해 둔다(연결이 끊긴 뒤 LWT 권한 확인 시에도 사용) */
function cn(client: any): string | null {
  if (client?._eumCn) return client._eumCn;
  const c = client?.conn?.getPeerCertificate?.();
  return c?.subject?.CN ?? null;
}

aedes.authenticate = (client: any, _u: any, _p: any, cb: any) => {
  const id = cn(client);
  if (!id || !(client.conn as tls.TLSSocket).authorized) return cb(Object.assign(new Error('인증서 없음'), { returnCode: 5 }), false);
  if (id === SERVER_CN || (DEVICE_RE.test(id) && client.id === id)) { client._eumCn = id; return cb(null, true); }
  return cb(Object.assign(new Error('클라이언트 ID와 인증서 불일치'), { returnCode: 5 }), false);
};

aedes.authorizePublish = (client: any, packet: any, cb: any) => {
  const id = cn(client);
  if (id === SERVER_CN) return /^eum\/v1\/SB-[0-9a-f]{12}\/cmd$/.test(packet.topic) ? cb(null) : cb(new Error('서버 발행 불가 토픽'));
  const m = /^eum\/v1\/(SB-[0-9a-f]{12})\/(status|hello|telemetry|event|ack)$/.exec(packet.topic);
  if (m && m[1] === id) return cb(null);
  return cb(new Error('발행 권한 없음'));
};

aedes.authorizeSubscribe = (client: any, sub: any, cb: any) => {
  const id = cn(client);
  if (id === SERVER_CN) return /^eum\/v1\/\+\/(status|hello|telemetry|event|ack)$/.test(sub.topic) ? cb(null, sub) : cb(new Error('구독 불가'));
  if (sub.topic === `eum/v1/${id}/cmd`) return cb(null, sub);
  return cb(new Error('구독 권한 없음'));
};

const server = tls.createServer({
  key: fs.readFileSync(files.keyFile), cert: fs.readFileSync(files.certFile), ca: fs.readFileSync(files.caFile),
  requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2',
}, aedes.handle);

server.listen(port, () => console.log(`[broker] mqtts://0.0.0.0:${port} (CA: ${path.relative(process.cwd(), files.caFile)})`));
aedes.on('clientError', (c: any, e: Error) => console.warn(`[broker] ${c?.id}: ${e.message}`));
process.on('SIGTERM', () => { server.close(); aedes.close(() => process.exit(0)); });
