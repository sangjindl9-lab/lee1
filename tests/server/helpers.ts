import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { createStore, type Database, type Store } from '../../src/server/store';
import type { Project, Task } from '../../src/shared/types';

// API 테스트 공용 도구. 운영체제 임시 폴더에 저장소를 만들어 실제 data 폴더를 건드리지 않습니다.

export interface TestContext {
  app: Express;
  store: Store;
  dataDir: string;
  /** 저장 파일(db.json)의 현재 내용 */
  readDb(): Database;
  /** 임시 폴더 삭제 */
  cleanup(): void;
}

export function createTestContext(): TestContext {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'bohal-api-'));
  const dataDir = path.join(tmpRoot, 'data');
  const store = createStore(dataDir);
  return {
    app: createApp(store),
    store,
    dataDir,
    readDb: () => JSON.parse(readFileSync(store.filePath, 'utf8')) as Database,
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/** 인수 기준의 "예제 프로젝트" */
export const exampleProject = {
  name: '예제 프로젝트',
  description: '기준 예제',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  weightBasis: 'amount',
};

export const taskA = {
  category: '토목',
  name: '공종 A',
  weightValue: 60_000_000,
  startDate: '2026-01-01',
  endDate: '2026-01-31',
};

export const taskB = {
  category: '건축',
  name: '공종 B',
  weightValue: 40_000_000,
  startDate: '2026-02-01',
  endDate: '2026-03-31',
};

export async function postProject(app: Express, body: object = exampleProject): Promise<Project> {
  const response = await request(app).post('/api/projects').send(body);
  if (response.status !== 201) throw new Error(`프로젝트 생성 실패: ${response.status} ${response.text}`);
  return response.body as Project;
}

export async function postTask(app: Express, projectId: string, body: object): Promise<Task> {
  const response = await request(app).post(`/api/projects/${projectId}/tasks`).send(body);
  if (response.status !== 201) throw new Error(`공종 생성 실패: ${response.status} ${response.text}`);
  return response.body as Task;
}

/** 예제 프로젝트와 공종 A, B를 API로 등록합니다. */
export async function seedExample(app: Express): Promise<{ project: Project; a: Task; b: Task }> {
  const project = await postProject(app);
  const a = await postTask(app, project.id, taskA);
  const b = await postTask(app, project.id, taskB);
  return { project, a, b };
}

export function putProgress(app: Express, projectId: string, taskId: string, date: unknown, percent: unknown) {
  return request(app).put(`/api/projects/${projectId}/tasks/${taskId}/progress`).send({ date, percent });
}
