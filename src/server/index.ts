import { createApp, findClientDir } from './app';
import { createStore, type Store } from './store';

const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = './data';

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT 환경 변수가 올바르지 않습니다: ${value}`);
  }
  return port;
}

function readDataDir(value: string | undefined): string {
  return value === undefined || value.trim() === '' ? DEFAULT_DATA_DIR : value.trim();
}

/** DATA_DIR 폴더의 db.json으로 저장소를 만듭니다. 파일이 깨져 있으면 덮어쓰지 않고 멈춥니다. */
function openStore(dataDir: string): Store {
  try {
    return createStore(dataDir);
  } catch (error) {
    console.error(`데이터 폴더(${dataDir})를 열지 못했습니다.`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const port = readPort(process.env.PORT);
const store = openStore(readDataDir(process.env.DATA_DIR));
const clientDir = findClientDir();
const app = createApp(store, { clientDir });

const server = app.listen(port, () => {
  // PORT=0이면 운영체제가 빈 포트를 고르므로 실제로 열린 포트를 표시합니다.
  const address = server.address();
  const actualPort = address !== null && typeof address === 'object' ? address.port : port;
  console.log(`프로젝트일정표 서버가 시작되었습니다: http://localhost:${actualPort}`);
  console.log(`데이터 파일: ${store.filePath}`);
  if (clientDir === null) {
    console.log('빌드한 화면(dist/client)이 없어 API만 제공합니다. 화면을 함께 쓰려면 npm run build 후 다시 시작하세요.');
  }
});

// 종료 신호를 받으면 처리 중인 요청을 마치고 끝냅니다.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // 열려 있는 연결 때문에 닫히지 않는 경우를 대비합니다.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`포트 ${port}을(를) 이미 다른 프로그램이 사용 중입니다. PORT 환경 변수로 다른 포트를 지정하세요.`);
  } else {
    console.error('서버를 시작하지 못했습니다.', error);
  }
  process.exit(1);
});
