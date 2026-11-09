import * as path from 'path';

function env(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (def === undefined) throw new Error(`환경변수 ${name}이(가) 필요합니다`);
    return def;
  }
  return v;
}

export const config = {
  version: '0.1.0',
  port: parseInt(env('PORT', '3000'), 10),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres@localhost:5432/eum'),
  dataDir: path.resolve(env('DATA_DIR', './data')),
  // 32바이트 hex. 없으면 DATA_DIR/master.key를 생성해서 사용
  masterKeyHex: process.env.MASTER_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',
  accessTtlSec: parseInt(env('ACCESS_TTL_SEC', String(8 * 3600)), 10),
  mqtt: {
    url: env('MQTT_URL', 'mqtts://localhost:8883'),
    // 장치에 내려줄 접속 주소(현장에서 보이는 주소)
    publicHost: env('MQTT_PUBLIC_HOST', 'localhost'),
    publicPort: parseInt(env('MQTT_PUBLIC_PORT', '8883'), 10),
    rejectUnauthorized: env('MQTT_TLS_VERIFY', 'true') === 'true',
  },
  webDist: path.resolve(env('WEB_DIST', path.join(__dirname, '..', '..', '..', 'web', 'dist'))),
  bootstrapAdmin: {
    username: process.env.BOOTSTRAP_ADMIN_USER || '',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
    orgName: process.env.BOOTSTRAP_ORG_NAME || '플랫폼 운영',
  },
  loginMaxFailures: 5,
  loginLockMinutes: 15,
  command: {
    receivedTimeoutMs: parseInt(env('CMD_RECEIVED_TIMEOUT_MS', '10000'), 10),
    maxAttempts: 3,
    defaultDoneTimeoutMs: 30000,
    approvalTtlMs: 10 * 60 * 1000,
    expiryMs: 120000,
  },
  offlineGraceSec: 10,
};
