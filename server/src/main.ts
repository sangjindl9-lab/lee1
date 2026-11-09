import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';
import { AppModule } from './app.module';
import { config } from './common/config';
import { DbService } from './common/db.service';
import { MqttService } from './device/mqtt.service';
import { CommandsService } from './device/commands.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api', { exclude: [] });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableShutdownHooks();
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  http.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'");
    next();
  });
  if (process.env.TRUST_PROXY === 'true') http.set('trust proxy', 1);
  // 웹 관제화면(web/dist) 정적 제공 + SPA 경로는 index.html
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    http.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    http.use((req: any, res: any, next: any) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  } else Logger.warn(`웹 화면 파일이 없습니다: ${config.webDist}`, 'Main');

  await app.get(DbService).migrate();
  await app.init();
  const mqtt = app.get(MqttService);
  const cmds = app.get(CommandsService);
  let recovered = false;
  mqtt.onConnect(() => { if (!recovered) { recovered = true; cmds.recoverInflight().catch(e => Logger.error(e.message)); } });
  mqtt.start();
  await app.listen(config.port);
  Logger.log(`EUM SMART VMS 서버 시작: http://0.0.0.0:${config.port}`, 'Main');
}
bootstrap().catch(e => { console.error(e); process.exit(1); });
