import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  // 리버스 프록시 뒤에서 실제 접속 IP를 쓰기 위해 (Caddy 1단계)
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const common = {
    crossOriginResourcePolicy: { policy: 'same-origin' as const },
    hsts: config.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' as const },
  };
  // API 응답은 스크립트를 실행할 일이 없으므로 가장 엄격한 CSP. API 문서 화면만 별도 허용
  const strict = helmet({ ...common, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  const docs = helmet({ ...common, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } } });
  app.use((req: any, res: any, next: any) => (req.path.startsWith('/api/docs') ? docs : strict)(req, res, next));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api/v1', { exclude: [] });
  // 화면(web)과 같은 출처로만 접근. 다른 출처의 쿠키 요청은 브라우저가 차단
  app.enableCors({ origin: [config.WEB_ORIGIN], credentials: true });

  if (config.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const doc = new DocumentBuilder()
      .setTitle('SS-ERP API')
      .setDescription('전기·정보통신·건축공사 통합 회계 ERP — API v1.\n\n**외부 프로그램**: 관리 › API 키에서 발급한 키를 `Authorization: Bearer ssk_…` 로 보냅니다. 회사는 키에 정해져 있고, 권한은 발급자 권한 ∩ 키 범위입니다. POST 요청에는 `Idempotency-Key` 헤더(요청마다 고유값)가 필수이며, 같은 키로 다시 보내면 처음 응답을 그대로 돌려줍니다.\n\n**화면(세션)**: 상태 변경 요청은 X-CSRF-Token, 회사 범위 요청은 X-Company-Id 헤더가 필요합니다.\n\n금액은 문자열(원 단위, 소수 2자리)로 주고받습니다.')
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'ssk_…', description: 'API 키' }, 'apikey')
      .addCookieAuth('erp_sid')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Company-Id' }, 'company')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
      .build();
    const document = SwaggerModule.createDocument(app, doc);
    document.security = [{ apikey: [] }];
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
  app.enableShutdownHooks();
  return app;
}

export async function start() {
  const app = await createApp();
  // HOST: Render 처럼 한 컨테이너에 화면과 API 를 같이 띄울 때 API 는 127.0.0.1 로만 연다
  await app.listen(config.PORT, process.env.HOST ?? '0.0.0.0');
  new Logger('SS-ERP').log(`API 서버 시작: http://localhost:${config.PORT}/api/v1 (문서: /api/docs)`);
}
