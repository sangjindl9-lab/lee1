// 테스트 전용 환경 — 운영/개발 DB 와 분리된 erp_test 사용
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:devpass@localhost:5432/erp_test';
process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.COOKIE_SECURE = 'false';
process.env.FILE_STORAGE_PATH = require('path').join(require('os').tmpdir(), 'ss-erp-test-storage');
process.env.WEB_ORIGIN = 'http://localhost:3000';
