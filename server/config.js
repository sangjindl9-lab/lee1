const env = process.env;
export const isProd = env.NODE_ENV === 'production';

export const config = {
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || (isProd ? null : 'dev-only-secret-change-me'),
  sessionDays: 14,
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  demoLogin: env.DEMO_LOGIN === 'true',
  seedDemo: env.SEED_DEMO === 'true',
  serviceFeeRate: Number(env.SERVICE_FEE_RATE || 0.10), // 게스트 서비스 수수료
  hostFeeRate: Number(env.HOST_FEE_RATE || 0.03),       // 호스트 수수료
  requestHoldHours: 24,                                  // 예약 요청 응답 기한
  business: {                                           // 전자상거래법 사업자 정보 고지 (푸터)
    name: env.BIZ_NAME || '',
    ceo: env.BIZ_CEO || '',
    regNo: env.BIZ_REG_NO || '',
    salesNo: env.BIZ_SALES_NO || '',
    address: env.BIZ_ADDRESS || '',
    phone: env.BIZ_PHONE || '',
    email: env.BIZ_EMAIL || '',
  },
  oauth: {
    google: { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET },
    kakao: { id: env.KAKAO_REST_KEY, secret: env.KAKAO_CLIENT_SECRET },
    naver: { id: env.NAVER_CLIENT_ID, secret: env.NAVER_CLIENT_SECRET },
  },
};

if (!config.sessionSecret || config.sessionSecret.length < 32) {
  if (isProd) { console.error('SESSION_SECRET(32자 이상)이 필요합니다.'); process.exit(1); }
}

export const enabledProviders = () =>
  Object.entries(config.oauth).filter(([k, v]) => v.id && (k === 'kakao' || v.secret)).map(([k]) => k);

export const REGIONS = ['서울','제주','부산','강릉','속초','양양','가평','경주','전주','여수','남해','통영','인천','대구','광주','대전','울산','춘천','포항','거제','태안','안동'];
export const CATEGORIES = ['hanok','ocean','forest','city','pool','camp','cabin'];
export const AMENITIES = ['wifi','parking','kitchen','washer','heat','ac','tea','view','bbq','fire','work','pool','shower','sauna','tv','pet','ev','elevator'];
export const REGION_COORDS = {
  서울:[37.57,126.98],제주:[33.45,126.56],부산:[35.16,129.07],강릉:[37.75,128.88],속초:[38.2,128.59],양양:[38.07,128.62],
  가평:[37.83,127.51],경주:[35.84,129.21],전주:[35.82,127.15],여수:[34.76,127.66],남해:[34.84,127.89],통영:[34.85,128.43],
  인천:[37.46,126.7],대구:[35.87,128.6],광주:[35.16,126.85],대전:[36.35,127.38],울산:[35.54,129.31],춘천:[37.88,127.73],
  포항:[36.02,129.34],거제:[34.88,128.62],태안:[36.75,126.3],안동:[36.57,128.73],
};
