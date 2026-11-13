// 서버 API를 호출하는 fetch 래퍼입니다.
// 실패한 응답은 서버가 보낸 한국어 message와 입력란별 오류(fields)를 담은 ApiError로 던집니다.

import type {
  PeriodUnit,
  ProgressRecord,
  Project,
  ProjectSummary,
  Schedule,
  Task,
  WeightBasis,
} from '../shared/types';
import type { FieldErrors } from '../shared/validation';

export const NETWORK_ERROR_MESSAGE = '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.';
export const UNKNOWN_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';

/** API 호출 실패. status가 0이면 서버에 닿지 못한 경우입니다. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** 입력란 이름별 오류 메시지. 없으면 빈 객체입니다. */
  readonly fields: FieldErrors;

  constructor(status: number, code: string, message: string, fields: FieldErrors = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** 화면에 보여 줄 오류 문구를 고릅니다. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return UNKNOWN_ERROR_MESSAGE;
}

export interface ProjectPayload {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  weightBasis: WeightBasis;
}

export interface TaskPayload {
  category: string;
  name: string;
  weightValue: number;
  startDate: string;
  endDate: string;
}

export interface ProgressPayload {
  date: string;
  percent: number;
}

export interface ProjectDetail {
  project: Project;
  tasks: Task[];
  progress: ProgressRecord[];
}

export interface ScheduleQuery {
  unit?: PeriodUnit;
  asOf?: string;
}

function toFieldErrors(value: unknown): FieldErrors {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const fields: FieldErrors = {};
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === 'string') fields[key] = message;
  }
  return fields;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // JSON이 아닌 오류 응답(프록시 오류 등)은 기본 문구를 씁니다.
  }
  const error =
    typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof error === 'object' && error !== null) {
    const { code, message, fields } = error as { code?: unknown; message?: unknown; fields?: unknown };
    return new ApiError(
      response.status,
      typeof code === 'string' ? code : 'UNKNOWN_ERROR',
      typeof message === 'string' && message !== '' ? message : UNKNOWN_ERROR_MESSAGE,
      toFieldErrors(fields),
    );
  }
  return new ApiError(response.status, 'UNKNOWN_ERROR', UNKNOWN_ERROR_MESSAGE);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', UNKNOWN_ERROR_MESSAGE);
  }
}

function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function projectPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

function taskPath(projectId: string, taskId: string): string {
  return `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}`;
}

/** 공정표 CSV를 내려받는 주소 */
export function scheduleCsvUrl(projectId: string, query: ScheduleQuery = {}): string {
  return `${projectPath(projectId)}/schedule.csv${queryString({ unit: query.unit, asOf: query.asOf })}`;
}

export const api = {
  listProjects(asOf?: string): Promise<ProjectSummary[]> {
    return request('GET', `/api/projects${queryString({ asOf })}`);
  },
  createProject(payload: ProjectPayload): Promise<Project> {
    return request('POST', '/api/projects', payload);
  },
  getProject(projectId: string): Promise<ProjectDetail> {
    return request('GET', projectPath(projectId));
  },
  updateProject(projectId: string, payload: Partial<ProjectPayload>): Promise<Project> {
    return request('PUT', projectPath(projectId), payload);
  },
  deleteProject(projectId: string): Promise<void> {
    return request('DELETE', projectPath(projectId));
  },

  createTask(projectId: string, payload: TaskPayload): Promise<Task> {
    return request('POST', `${projectPath(projectId)}/tasks`, payload);
  },
  updateTask(projectId: string, taskId: string, payload: Partial<TaskPayload>): Promise<Task> {
    return request('PUT', taskPath(projectId, taskId), payload);
  },
  deleteTask(projectId: string, taskId: string): Promise<void> {
    return request('DELETE', taskPath(projectId, taskId));
  },
  reorderTasks(projectId: string, taskIds: string[]): Promise<Task[]> {
    return request('PUT', `${projectPath(projectId)}/tasks/order`, { taskIds });
  },

  saveProgress(projectId: string, taskId: string, payload: ProgressPayload): Promise<ProgressRecord> {
    return request('PUT', `${taskPath(projectId, taskId)}/progress`, payload);
  },
  deleteProgress(projectId: string, taskId: string, date: string): Promise<void> {
    return request('DELETE', `${taskPath(projectId, taskId)}/progress/${encodeURIComponent(date)}`);
  },

  getSchedule(projectId: string, query: ScheduleQuery = {}): Promise<Schedule> {
    return request(
      'GET',
      `${projectPath(projectId)}/schedule${queryString({ unit: query.unit, asOf: query.asOf })}`,
    );
  },
};
