import crypto from 'node:crypto';

const prod = process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build';

function secret(name: string) {
  const v = process.env[name];
  if (v) return v;
  if (prod && !process.env.ALLOW_DEV_SECRETS) throw new Error(`환경변수 ${name} 가 필요합니다 (.env.example 참고)`);
  return crypto.createHash('sha256').update('dev-only:' + name).digest('hex'); // 개발·테스트 전용
}

export const config = {
  get databaseUrl() { return process.env.DATABASE_URL || ''; },
  get dataDir() { return process.env.DATA_DIR || './data'; },
  get sessionSecret() { return secret('SESSION_SECRET'); },
  get fileMasterKey() { return secret('FILE_MASTER_KEY'); },
  get webhookSecret() { return secret('SIMPG_WEBHOOK_SECRET'); },
  get paymentProvider() { return process.env.PAYMENT_PROVIDER || 'test'; },
  get storage() { return process.env.STORAGE || 'local'; },
  get retentionDays() { return Number(process.env.RETENTION_DAYS || 365); },
  get maxUploadBytes() { return Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024; },
  get adminEmail() { return process.env.ADMIN_EMAIL || ''; },
  get adminPassword() { return process.env.ADMIN_PASSWORD || ''; },
};
