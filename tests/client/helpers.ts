import { vi } from 'vitest';
import { buildSchedule } from '../../src/shared/bohal';
import type { ProgressRecord, Project, ProjectSummary, Schedule, Task } from '../../src/shared/types';

export interface MockCall {
  method: string;
  url: string;
  body: unknown;
}

export type MockHandler = (call: MockCall) => Response | undefined;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

/**
 * 전역 fetch를 모의합니다. handler가 응답을 돌려주지 않은 요청은 테스트 실패로 드러나도록 거부합니다.
 * 반환한 calls 배열에 요청이 순서대로 쌓입니다.
 */
export function mockFetch(handler: MockHandler): MockCall[] {
  const calls: MockCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: MockCall = {
        method: (init?.method ?? 'GET').toUpperCase(),
        url: String(input),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const response = handler(call);
      if (!response) throw new Error(`모의하지 않은 요청: ${call.method} ${call.url}`);
      return response;
    }),
  );
  return calls;
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '신축 공사',
    description: '',
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    weightBasis: 'amount',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    ...makeProject(),
    taskCount: 3,
    plannedToDate: 42.5,
    actualToDate: 38.125,
    variance: -4.375,
    status: 'behind',
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    category: '',
    name: '공종',
    weightValue: 1,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    order: 0,
    ...overrides,
  };
}

export interface FakeData {
  project: Project;
  tasks: Task[];
  progress: ProgressRecord[];
}

/** 기준 예제 데이터(ACCEPTANCE_CRITERIA.md): 2026-01-01 ~ 2026-03-31, 공종 A 6천만, 공종 B 4천만 */
export function exampleData(): FakeData {
  return {
    project: makeProject({ id: 'p1', name: '예제 프로젝트', startDate: '2026-01-01', endDate: '2026-03-31' }),
    tasks: [
      makeTask({
        id: 'a',
        name: '공종 A',
        category: '토목',
        weightValue: 60_000_000,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        order: 0,
      }),
      makeTask({
        id: 'b',
        name: '공종 B',
        category: '건축',
        weightValue: 40_000_000,
        startDate: '2026-02-01',
        endDate: '2026-03-31',
        order: 1,
      }),
    ],
    progress: [],
  };
}

/** 공정표 응답을 실제 계산 엔진으로 만듭니다. */
export function makeSchedule(data: FakeData, asOf = '2026-02-28'): Schedule {
  const tasks = [...data.tasks].sort((x, y) => x.order - y.order);
  return buildSchedule(data.project, tasks, data.progress, 'month', asOf);
}

/**
 * 프로젝트 하나를 가진 서버를 흉내 내는 fetch 처리기입니다.
 * 공종·실적 요청을 받으면 data를 고치고, 조회 요청에는 고친 data로 계산한 값을 돌려줍니다.
 */
export function fakeServer(data: FakeData, asOf = '2026-02-28'): MockHandler {
  const base = `/api/projects/${data.project.id}`;
  let nextId = 1;
  const ordered = () => [...data.tasks].sort((x, y) => x.order - y.order);

  return ({ method, url, body }) => {
    const path = url.split('?')[0];
    if (method === 'GET' && path === base) {
      return jsonResponse({ project: data.project, tasks: ordered(), progress: data.progress });
    }
    if (method === 'GET' && path === `${base}/schedule`) return jsonResponse(makeSchedule(data, asOf));
    if (method === 'POST' && path === `${base}/tasks`) {
      const task = makeTask({ ...(body as Partial<Task>), id: `new${nextId++}`, order: data.tasks.length });
      data.tasks.push(task);
      return jsonResponse(task, 201);
    }
    if (method === 'PUT' && path === `${base}/tasks/order`) {
      const { taskIds } = body as { taskIds: string[] };
      for (const task of data.tasks) task.order = taskIds.indexOf(task.id);
      return jsonResponse(ordered());
    }

    const progressMatch = /\/tasks\/([^/]+)\/progress(?:\/([^/]+))?$/.exec(path);
    if (progressMatch) {
      const [, taskId, date] = progressMatch;
      if (method === 'PUT') {
        const input = body as { date: string; percent: number };
        data.progress = data.progress.filter((r) => !(r.taskId === taskId && r.date === input.date));
        const record: ProgressRecord = { id: `r${nextId++}`, taskId, date: input.date, percent: input.percent };
        data.progress.push(record);
        return jsonResponse(record);
      }
      if (method === 'DELETE') {
        data.progress = data.progress.filter((r) => !(r.taskId === taskId && r.date === date));
        return emptyResponse(204);
      }
    }

    const taskMatch = /\/tasks\/([^/]+)$/.exec(path);
    if (taskMatch) {
      const task = data.tasks.find((t) => t.id === taskMatch[1]);
      if (!task) return errorResponse(404, 'NOT_FOUND', '공종을 찾을 수 없습니다.');
      if (method === 'PUT') {
        Object.assign(task, body);
        return jsonResponse(task);
      }
      if (method === 'DELETE') {
        data.tasks = data.tasks.filter((t) => t !== task);
        data.progress = data.progress.filter((r) => r.taskId !== task.id);
        data.tasks.forEach((t, index) => {
          t.order = index;
        });
        return emptyResponse(204);
      }
    }
    return undefined;
  };
}
