const path = require('path');
const fs = require('fs');

// .env 파일 간단 로더 (외부 의존성 없이)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

if (!process.env.SESSION_SECRET) {
  console.warn('[경고] SESSION_SECRET 이 설정되지 않았습니다. 운영 환경에서는 반드시 .env 에 설정하세요.');
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'app.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(dataDir, 'uploads'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  chromiumPath: process.env.CHROMIUM_PATH || '',
};
