import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 이 필요합니다'),
  /** 64자리 16진수 (32바이트). 계좌번호·MFA 비밀키 등 필드 암호화용 */
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY 는 64자리 16진수여야 합니다'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  LOGIN_MAX_FAILS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  FILE_STORAGE: z.enum(['local']).default('local'),
  FILE_STORAGE_PATH: z.string().default('./storage'),
  FILE_MAX_MB: z.coerce.number().positive().default(20),
  /** 판매자 라이선스 검증용 Ed25519 공개키(PEM, base64). 비어 있으면 평가판 모드 */
  LICENSE_PUBLIC_KEY: z.string().optional(),
  /** 공급사 라이선스 발급 서버 주소. 비워 두면 온라인 갱신을 쓰지 않는다(오프라인 설치형) */
  LICENSE_SERVER_URL: z.string().default('https://ss-license-production.up.railway.app'),
  /** 발급 서버 연결용 설치 코드 (화면 '관리 > 라이선스'에서 넣어도 됨) */
  LICENSE_ACTIVATION_CODE: z.string().optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // 시작 시점에 설정 오류를 명확히 보여주고 종료한다
  console.error('환경설정 오류:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
  console.error('운영 환경에서는 COOKIE_SECURE=true 여야 합니다 (HTTPS 필수).');
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;
