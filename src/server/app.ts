import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { apiNotFoundHandler, errorHandler } from './errors';
import { createProgressRouter } from './routes/progress';
import { createProjectsRouter } from './routes/projects';
import { createScheduleRouter } from './routes/schedule';
import { createTasksRouter } from './routes/tasks';
import type { Store } from './store';

export interface AppOptions {
  /**
   * 빌드한 화면(index.html과 assets)이 들어 있는 폴더.
   * 생략하면 dist/client를 찾아 쓰고, null이면 화면을 제공하지 않습니다.
   */
  clientDir?: string | null;
}

/**
 * 빌드한 화면 폴더(dist/client)를 찾습니다. index.html이 없으면 null입니다.
 * 빌드 결과(dist/server/server/app.js)와 소스(src/server/app.ts) 어느 쪽에서 실행해도 같은 폴더를 가리킵니다.
 */
export function findClientDir(): string | null {
  const candidates = [path.resolve(__dirname, '../../client'), path.resolve(__dirname, '../../dist/client')];
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null;
}

/**
 * Express 앱을 조립합니다. 서버를 띄우지 않으므로 테스트에서 그대로 쓸 수 있습니다.
 * @param store 데이터를 읽고 쓸 저장소(테스트에서는 임시 폴더 저장소를 넣습니다)
 * @param options 화면 정적 파일 폴더 지정
 */
export function createApp(store: Store, options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/projects', createProjectsRouter(store));
  app.use('/api/projects', createTasksRouter(store));
  app.use('/api/projects', createProgressRouter(store));
  app.use('/api/projects', createScheduleRouter(store));

  app.use('/api', apiNotFoundHandler);

  // 빌드한 화면이 있으면 같은 포트에서 함께 제공합니다. /api가 아닌 나머지 주소는 index.html로 응답합니다.
  const clientDir = options.clientDir === undefined ? findClientDir() : options.clientDir;
  if (clientDir !== null && existsSync(path.join(clientDir, 'index.html'))) {
    const root = path.resolve(clientDir);
    app.use(express.static(root));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      // index.html은 빌드할 때마다 가리키는 파일 이름이 바뀌므로 브라우저가 오래 보관하지 않게 합니다.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(errorHandler);

  return app;
}
