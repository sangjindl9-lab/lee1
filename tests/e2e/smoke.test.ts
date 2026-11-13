import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, Schedule, Task } from '../../src/shared/types';

// 빌드 결과물(dist)로 실제 서버를 자식 프로세스로 띄워 npm start와 같은 방식으로 전체 흐름을 확인합니다.
// 데이터는 운영체제 임시 폴더에 두므로 실제 data 폴더는 건드리지 않습니다.

const ROOT = path.resolve(__dirname, '../..');
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'server', 'index.js');
const CLIENT_INDEX = path.join(ROOT, 'dist', 'client', 'index.html');

const BUILD_TIMEOUT = 300_000;
const START_TIMEOUT = 20_000;

/** 폴더 안에서 가장 최근에 고친 파일의 시각 */
function newestMtime(target: string): number {
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(target).reduce((latest, name) => Math.max(latest, newestMtime(path.join(target, name))), 0);
}

/** dist가 없거나 소스보다 오래됐으면 빌드가 필요합니다. */
function needsBuild(): boolean {
  if (!existsSync(SERVER_ENTRY) || !existsSync(CLIENT_INDEX)) return true;
  const built = Math.min(statSync(SERVER_ENTRY).mtimeMs, statSync(CLIENT_INDEX).mtimeMs);
  const sources = Math.max(newestMtime(path.join(ROOT, 'src')), newestMtime(path.join(ROOT, 'index.html')));
  return sources > built;
}

/** 운영체제에 빈 포트를 물어봅니다. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address !== null && typeof address === 'object' ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

interface RunningServer {
  child: ChildProcess;
  baseUrl: string;
  output(): string;
}

async function startServer(dataDir: string): Promise<RunningServer> {
  const port = await findFreePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString('utf8')));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`서버가 시작 중에 종료되었습니다(코드 ${child.exitCode}).\n${log}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl, output: () => log };
    } catch {
      // 아직 포트가 열리지 않았습니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`서버가 ${START_TIMEOUT}ms 안에 시작되지 않았습니다.\n${log}`);
}

function stopServer(server: RunningServer | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!server || server.child.exitCode !== null || server.child.signalCode !== null) {
      resolve();
      return;
    }
    server.child.once('exit', () => resolve());
    server.child.kill();
  });
}

async function sendJson<T>(server: RunningServer, method: string, pathname: string, body: unknown, expected: number) {
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status !== expected) throw new Error(`${method} ${pathname} → ${response.status} ${text}`);
  return JSON.parse(text) as T;
}

async function getJson<T>(server: RunningServer, pathname: string): Promise<T> {
  const response = await fetch(`${server.baseUrl}${pathname}`);
  const text = await response.text();
  if (response.status !== 200) throw new Error(`GET ${pathname} → ${response.status} ${text}`);
  return JSON.parse(text) as T;
}

interface ProjectDetail {
  project: Project;
  tasks: Task[];
  progress: { taskId: string; date: string; percent: number }[];
}

describe('빌드 결과물 서버 스모크 테스트', () => {
  let tmpRoot: string;
  let dataDir: string;
  let server: RunningServer | undefined;
  let projectId = '';
  let detailBeforeRestart: ProjectDetail;
  let scheduleBeforeRestart: Schedule;

  beforeAll(async () => {
    if (needsBuild()) {
      execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
    }
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'bohal-e2e-'));
    dataDir = path.join(tmpRoot, 'data');
    server = await startServer(dataDir);
  }, BUILD_TIMEOUT);

  afterAll(async () => {
    await stopServer(server);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('AC-F9-5: 빌드 결과물 dist/server와 dist/client/index.html이 있다', () => {
    expect(existsSync(SERVER_ENTRY)).toBe(true);
    expect(existsSync(CLIENT_INDEX)).toBe(true);
  });

  it('npm start가 빌드 결과물 서버를 실행한다', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toBe('node dist/server/server/index.js');
    expect(pkg.scripts.build).toContain('vite build');
  });

  it('AC-F9-6: GET /api/health가 200 { ok: true }를 응답한다', async () => {
    const response = await fetch(`${server!.baseUrl}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('AC-F9-6: GET / 가 root 요소가 있는 화면 HTML을 응답하고 화면 스크립트도 같은 포트에서 내려받아진다', async () => {
    const response = await fetch(`${server!.baseUrl}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<html lang="ko">');

    const scriptSrc = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    expect(scriptSrc).toBeDefined();
    const script = await fetch(new URL(scriptSrc!, `${server!.baseUrl}/`));
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toMatch(/javascript/);
    expect((await script.text()).length).toBeGreaterThan(1000);
  });

  it('/api가 아닌 없는 경로는 화면 HTML을, 없는 API 경로는 404 JSON을 응답한다', async () => {
    const page = await fetch(`${server!.baseUrl}/projects/anything`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');

    const api = await fetch(`${server!.baseUrl}/api/unknown`);
    expect(api.status).toBe(404);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('AC-F9-2, AC-F9-3: 처음 시작하면 DATA_DIR에 db.json이 만들어지고 프로젝트 목록이 빈 배열이다', async () => {
    expect(existsSync(path.join(dataDir, 'db.json'))).toBe(true);
    expect(await getJson<unknown[]>(server!, '/api/projects')).toEqual([]);
  });

  it('기준 예제 데이터를 등록하면 공정표의 누계 계획이 100으로 끝나고 실적이 반영된다', async () => {
    const project = await sendJson<Project>(
      server!,
      'POST',
      '/api/projects',
      {
        name: '예제 프로젝트',
        description: '기준 예제',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        weightBasis: 'amount',
      },
      201,
    );
    projectId = project.id;
    const a = await sendJson<Task>(
      server!,
      'POST',
      `/api/projects/${projectId}/tasks`,
      { category: '토목', name: '공종 A', weightValue: 60_000_000, startDate: '2026-01-01', endDate: '2026-01-31' },
      201,
    );
    const b = await sendJson<Task>(
      server!,
      'POST',
      `/api/projects/${projectId}/tasks`,
      { category: '건축', name: '공종 B', weightValue: 40_000_000, startDate: '2026-02-01', endDate: '2026-03-31' },
      201,
    );
    await sendJson(server!, 'PUT', `/api/projects/${projectId}/tasks/${a.id}/progress`, { date: '2026-01-31', percent: 100 }, 200);
    await sendJson(server!, 'PUT', `/api/projects/${projectId}/tasks/${b.id}/progress`, { date: '2026-02-28', percent: 50 }, 200);

    const schedule = await getJson<Schedule>(server!, `/api/projects/${projectId}/schedule?unit=month&asOf=2026-02-28`);

    expect(schedule.periods).toHaveLength(3);
    expect(schedule.rows.map((row) => row.taskId)).toEqual([a.id, b.id]);
    expect(schedule.rows[0].bohal).toBeCloseTo(60, 2);
    expect(schedule.rows[1].bohal).toBeCloseTo(40, 2);
    expect(schedule.totals.cumulativePlanned[0]).toBeCloseTo(60, 2);
    expect(schedule.totals.cumulativePlanned[1]).toBeCloseTo(78.98, 2);
    expect(schedule.totals.cumulativePlanned[2]).toBeCloseTo(100, 2);
    expect(schedule.totals.cumulativeActual[0]).toBeCloseTo(60, 2);
    expect(schedule.totals.cumulativeActual[1]).toBeCloseTo(80, 2);
    expect(schedule.totals.cumulativeActual[2]).toBeNull();
    expect(schedule.summary.actualToDate).toBeCloseTo(80, 2);

    scheduleBeforeRestart = schedule;
    detailBeforeRestart = await getJson<ProjectDetail>(server!, `/api/projects/${projectId}`);
    expect(detailBeforeRestart.tasks).toHaveLength(2);
    expect(detailBeforeRestart.progress).toHaveLength(2);
  });

  it('CSV 내려받기 응답이 UTF-8 BOM으로 시작하고 공정표 행을 담고 있다', async () => {
    const response = await fetch(`${server!.baseUrl}/api/projects/${projectId}/schedule.csv?unit=month&asOf=2026-02-28`);
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/csv/);
    expect(response.headers.get('content-disposition')).toMatch(/attachment/);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const lines = bytes.subarray(3).toString('utf8').trim().split(/\r?\n/);
    expect(lines).toHaveLength(1 + 2 + 4);
    expect(lines[0]).toContain('공종명');
    expect(lines[1]).toContain('공종 A');
    expect(lines[4]).toContain('100.00');
  });

  it('AC-F9-1: 서버를 종료하고 다시 시작해도 같은 데이터가 조회된다', async () => {
    await stopServer(server);
    server = await startServer(dataDir);

    const projects = await getJson<{ id: string; name: string; taskCount: number }[]>(server, '/api/projects');
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: projectId, name: '예제 프로젝트', taskCount: 2 });

    expect(await getJson<ProjectDetail>(server, `/api/projects/${projectId}`)).toEqual(detailBeforeRestart);
    expect(
      await getJson<Schedule>(server, `/api/projects/${projectId}/schedule?unit=month&asOf=2026-02-28`),
    ).toEqual(scheduleBeforeRestart);
  });
});
