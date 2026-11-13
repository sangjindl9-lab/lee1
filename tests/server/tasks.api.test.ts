import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { createStore } from '../../src/server/store';
import type { Task } from '../../src/shared/types';
import {
  createTestContext,
  exampleProject,
  MISSING_ID,
  postProject,
  postTask,
  putProgress,
  seedExample,
  taskA,
  taskB,
  type TestContext,
  UUID,
} from './helpers';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

async function taskNames(projectId: string): Promise<string[]> {
  const response = await request(ctx.app).get(`/api/projects/${projectId}`);
  return (response.body.tasks as Task[]).map((task) => task.name);
}

describe('POST /api/projects/:id/tasks', () => {
  it('AC-F2-1: 201과 공종을 반환하고 마지막 순서로 추가된다', async () => {
    const project = await postProject(ctx.app);

    const first = await request(ctx.app).post(`/api/projects/${project.id}/tasks`).send(taskA);
    const second = await request(ctx.app).post(`/api/projects/${project.id}/tasks`).send(taskB);

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ ...taskA, projectId: project.id, order: 0 });
    expect(first.body.id).toMatch(UUID);
    expect(second.status).toBe(201);
    expect(second.body.order).toBe(1);
    expect(await taskNames(project.id)).toEqual(['공종 A', '공종 B']);
  });

  it('구분을 보내지 않으면 빈 문자열로, 공종명은 앞뒤 공백을 지워 저장한다', async () => {
    const project = await postProject(ctx.app);
    const { category: _omitted, ...withoutCategory } = taskA;

    const response = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...withoutCategory, name: '  터파기  ' });

    expect(response.status).toBe(201);
    expect(response.body.category).toBe('');
    expect(response.body.name).toBe('터파기');
  });

  it('공종명이 비어 있으면 400을 반환한다', async () => {
    const project = await postProject(ctx.app);

    const response = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, name: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '공종명을 입력하세요.',
      fields: { name: '공종명을 입력하세요.' },
    });
  });

  it.each([0, -1, '1000', null])('AC-F2-2: 금액이 %j 이면 400으로 거부한다', async (weightValue) => {
    const project = await postProject(ctx.app);

    const response = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, weightValue });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fields).toEqual({ weightValue: '금액은 0보다 큰 숫자로 입력하세요.' });
    expect(ctx.readDb().tasks).toEqual([]);
  });

  it('AC-F2-2: 가중치 기준 프로젝트에서는 가중치 문구로 거부한다', async () => {
    const project = await postProject(ctx.app, { ...exampleProject, weightBasis: 'manual' });

    const response = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, weightValue: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ weightValue: '가중치는 0보다 큰 숫자로 입력하세요.' });
  });

  it('AC-F2-3: 종료일이 시작일보다 이르면 400, 시작일과 종료일이 같으면 저장된다', async () => {
    const project = await postProject(ctx.app);

    const reversed = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, startDate: '2026-01-31', endDate: '2026-01-01' });
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.fields).toEqual({ endDate: '종료일은 시작일보다 빠를 수 없습니다.' });

    const sameDay = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, startDate: '2026-01-10', endDate: '2026-01-10' });
    expect(sameDay.status).toBe(201);
    expect(sameDay.body).toMatchObject({ startDate: '2026-01-10', endDate: '2026-01-10' });
  });

  it('AC-F2-4: 공종 기간이 프로젝트 기간을 벗어나면 400과 안내 메시지를 반환한다', async () => {
    const project = await postProject(ctx.app);

    const late = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, endDate: '2026-04-01' });
    expect(late.status).toBe(400);
    expect(late.body.error.message).toBe('공종 기간은 프로젝트 기간 안에 있어야 합니다.');
    expect(late.body.error.fields).toEqual({ endDate: '공종 기간은 프로젝트 기간 안에 있어야 합니다.' });

    const early = await request(ctx.app)
      .post(`/api/projects/${project.id}/tasks`)
      .send({ ...taskA, startDate: '2025-12-31' });
    expect(early.status).toBe(400);
    expect(early.body.error.fields).toEqual({ startDate: '공종 기간은 프로젝트 기간 안에 있어야 합니다.' });
    expect(ctx.readDb().tasks).toEqual([]);
  });

  it('없는 프로젝트에는 404를 반환한다', async () => {
    const response = await request(ctx.app).post(`/api/projects/${MISSING_ID}/tasks`).send(taskA);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' },
    });
  });
});

describe('PUT /api/projects/:id/tasks/:taskId', () => {
  it('AC-F2-5: 수정한 값을 200으로 반환하고 조회에 반영된다', async () => {
    const { project, a } = await seedExample(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}/tasks/${a.id}`)
      .send({ ...taskA, name: '공종 A 수정', weightValue: 80_000_000, endDate: '2026-02-15' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...a,
      name: '공종 A 수정',
      weightValue: 80_000_000,
      endDate: '2026-02-15',
    });
    const detail = await request(ctx.app).get(`/api/projects/${project.id}`);
    expect(detail.body.tasks[0]).toEqual(response.body);
  });

  it('보내지 않은 항목은 기존 값을 유지한다', async () => {
    const { project, a } = await seedExample(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}/tasks/${a.id}`)
      .send({ weightValue: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...a, weightValue: 1 });
  });

  it('검증에 실패하면 400을 반환하고 저장된 값은 바뀌지 않는다', async () => {
    const { project, a } = await seedExample(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}/tasks/${a.id}`)
      .send({ ...taskA, weightValue: -5, endDate: '2026-05-01' });

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({
      weightValue: '금액은 0보다 큰 숫자로 입력하세요.',
      endDate: '공종 기간은 프로젝트 기간 안에 있어야 합니다.',
    });
    expect(ctx.readDb().tasks.find((task) => task.id === a.id)).toEqual(a);
  });

  it('없는 공종이나 다른 프로젝트의 공종은 404를 반환한다', async () => {
    const { project, a } = await seedExample(ctx.app);
    const other = await postProject(ctx.app, { ...exampleProject, name: '다른 프로젝트' });

    const missing = await request(ctx.app).put(`/api/projects/${project.id}/tasks/${MISSING_ID}`).send(taskA);
    const wrongProject = await request(ctx.app).put(`/api/projects/${other.id}/tasks/${a.id}`).send(taskA);
    const missingProject = await request(ctx.app).put(`/api/projects/${MISSING_ID}/tasks/${a.id}`).send(taskA);

    for (const response of [missing, wrongProject]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: '공종을 찾을 수 없습니다.' } });
    }
    expect(missingProject.status).toBe(404);
    expect(missingProject.body.error.message).toBe('프로젝트를 찾을 수 없습니다.');
  });
});

describe('DELETE /api/projects/:id/tasks/:taskId', () => {
  it('AC-F2-5: 204를 반환하고 공종과 그 실적이 삭제되며 남은 공종의 순서가 다시 매겨진다', async () => {
    const { project, a, b } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);
    await putProgress(ctx.app, project.id, b.id, '2026-02-15', 10);

    const response = await request(ctx.app).delete(`/api/projects/${project.id}/tasks/${a.id}`);

    expect(response.status).toBe(204);
    const db = ctx.readDb();
    expect(db.tasks).toEqual([{ ...b, order: 0 }]);
    expect(db.progress.map((record) => record.taskId)).toEqual([b.id]);
  });

  it('없는 공종이나 다른 프로젝트의 공종은 404를 반환하고 지우지 않는다', async () => {
    const { project, a } = await seedExample(ctx.app);
    const other = await postProject(ctx.app, { ...exampleProject, name: '다른 프로젝트' });

    const missing = await request(ctx.app).delete(`/api/projects/${project.id}/tasks/${MISSING_ID}`);
    const wrongProject = await request(ctx.app).delete(`/api/projects/${other.id}/tasks/${a.id}`);

    expect(missing.status).toBe(404);
    expect(wrongProject.status).toBe(404);
    expect(wrongProject.body.error.code).toBe('NOT_FOUND');
    expect(ctx.readDb().tasks).toHaveLength(2);
  });
});

describe('PUT /api/projects/:id/tasks/order', () => {
  it('AC-F2-6: 아래로 옮긴 순서를 200으로 반환하고 저장소를 다시 열어도 유지된다', async () => {
    const { project, a, b } = await seedExample(ctx.app);
    const c = await postTask(ctx.app, project.id, { ...taskB, name: '공종 C' });

    // 공종 A를 한 칸 아래로
    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}/tasks/order`)
      .send({ taskIds: [b.id, a.id, c.id] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { ...b, order: 0 },
      { ...a, order: 1 },
      { ...c, order: 2 },
    ]);
    expect(await taskNames(project.id)).toEqual(['공종 B', '공종 A', '공종 C']);

    // 서버를 다시 시작한 것처럼 같은 폴더로 저장소와 앱을 새로 만듭니다.
    const restarted = createApp(createStore(ctx.dataDir));
    const detail = await request(restarted).get(`/api/projects/${project.id}`);
    expect((detail.body.tasks as Task[]).map((task) => task.name)).toEqual(['공종 B', '공종 A', '공종 C']);
  });

  it.each([
    ['누락', (a: Task, _b: Task) => [a.id]],
    ['중복', (a: Task, _b: Task) => [a.id, a.id]],
    ['모르는 id', (a: Task, _b: Task) => [a.id, MISSING_ID]],
  ])('목록이 프로젝트의 공종 전체와 다르면(%s) 400을 반환하고 순서를 바꾸지 않는다', async (_label, build) => {
    const { project, a, b } = await seedExample(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}/tasks/order`)
      .send({ taskIds: build(a, b) });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '순서 목록이 이 프로젝트의 공종 전체와 일치하지 않습니다.',
      fields: { taskIds: '순서 목록이 이 프로젝트의 공종 전체와 일치하지 않습니다.' },
    });
    expect(await taskNames(project.id)).toEqual(['공종 A', '공종 B']);
  });

  it.each([{}, { taskIds: 'abc' }, { taskIds: [1, 2] }])('taskIds가 문자열 배열이 아니면(%j) 400을 반환한다', async (body) => {
    const { project } = await seedExample(ctx.app);

    const response = await request(ctx.app).put(`/api/projects/${project.id}/tasks/order`).send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({
      taskIds: '공종 순서 목록(taskIds)을 문자열 배열로 보내 주세요.',
    });
  });

  it('없는 프로젝트에는 404를 반환한다', async () => {
    const response = await request(ctx.app).put(`/api/projects/${MISSING_ID}/tasks/order`).send({ taskIds: [] });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
