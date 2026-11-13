import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { todayString } from '../../src/server/routes/projects';
import type { Store } from '../../src/server/store';
import type { ProjectSummary } from '../../src/shared/types';
import {
  createTestContext,
  exampleProject,
  MISSING_ID,
  postProject,
  putProgress,
  seedExample,
  taskA,
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

describe('POST /api/projects', () => {
  it('AC-F1-1: 201과 id가 있는 프로젝트를 반환하고 목록에 나타난다', async () => {
    const response = await request(ctx.app).post('/api/projects').send(exampleProject);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject(exampleProject);
    expect(response.body.id).toMatch(UUID);
    expect(response.body.createdAt).toBe(response.body.updatedAt);

    const list = await request(ctx.app).get('/api/projects');
    expect(list.status).toBe(200);
    expect(list.body.map((item: ProjectSummary) => item.id)).toEqual([response.body.id]);
  });

  it('이름 앞뒤 공백은 지우고 설명이 없으면 빈 문자열로 저장한다', async () => {
    const response = await request(ctx.app)
      .post('/api/projects')
      .send({ name: '  신축 공사  ', startDate: '2026-01-01', endDate: '2026-01-01' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('신축 공사');
    expect(response.body.description).toBe('');
  });

  it('AC-F1-2: 이름이 비어 있으면 400 VALIDATION_ERROR와 한국어 메시지를 반환하고 저장하지 않는다', async () => {
    const response = await request(ctx.app)
      .post('/api/projects')
      .send({ ...exampleProject, name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: '프로젝트 이름을 입력하세요.',
        fields: { name: '프로젝트 이름을 입력하세요.' },
      },
    });
    expect(ctx.readDb().projects).toEqual([]);
  });

  it('AC-F1-3: 종료일이 시작일보다 이르면 400을 반환한다', async () => {
    const response = await request(ctx.app)
      .post('/api/projects')
      .send({ ...exampleProject, startDate: '2026-03-31', endDate: '2026-01-01' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fields).toEqual({ endDate: '종료일은 시작일보다 빠를 수 없습니다.' });
    expect(ctx.readDb().projects).toEqual([]);
  });

  it('AC-F1-4: 보할 기준을 보내지 않으면 amount로 저장된다', async () => {
    const { weightBasis: _omitted, ...withoutBasis } = exampleProject;
    const response = await request(ctx.app).post('/api/projects').send(withoutBasis);

    expect(response.status).toBe(201);
    expect(response.body.weightBasis).toBe('amount');
    expect(ctx.readDb().projects[0].weightBasis).toBe('amount');
  });

  it('보할 기준 manual을 저장하고, 모르는 값은 400으로 거부한다', async () => {
    const manual = await request(ctx.app)
      .post('/api/projects')
      .send({ ...exampleProject, weightBasis: 'manual' });
    expect(manual.status).toBe(201);
    expect(manual.body.weightBasis).toBe('manual');

    const unknown = await request(ctx.app)
      .post('/api/projects')
      .send({ ...exampleProject, weightBasis: 'cost' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields.weightBasis).toBe('보할 기준은 금액 또는 가중치 중에서 선택하세요.');
  });

  it('여러 입력란이 틀리면 fields에 모두 담아 반환한다', async () => {
    const response = await request(ctx.app).post('/api/projects').send({ startDate: '2026-02-30' });

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({
      name: '프로젝트 이름을 입력하세요.',
      startDate: '시작일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
      endDate: '종료일을 입력하세요.',
    });
  });

  it('JSON 형식이 깨진 본문은 400 VALIDATION_ERROR를 반환한다', async () => {
    const response = await request(ctx.app)
      .post('/api/projects')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: '요청 본문이 올바른 JSON 형식이 아닙니다.' },
    });
  });

  it('본문이 배열이면 400을 반환한다', async () => {
    const response = await request(ctx.app).post('/api/projects').send([exampleProject]);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/projects', () => {
  it('프로젝트가 없으면 빈 배열을 반환한다', async () => {
    const response = await request(ctx.app).get('/api/projects');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('AC-F1-5: 각 항목에 이름, 기간, 공종 수, 계획 누계, 실적 누계, 상태가 있다', async () => {
    const { project, a, b } = await seedExample(ctx.app);
    expect((await putProgress(ctx.app, project.id, a.id, '2026-01-31', 100)).status).toBe(200);
    expect((await putProgress(ctx.app, project.id, b.id, '2026-02-28', 50)).status).toBe(200);
    const empty = await postProject(ctx.app, { ...exampleProject, name: '공종 없는 프로젝트' });

    const response = await request(ctx.app).get('/api/projects').query({ asOf: '2026-02-28' });

    expect(response.status).toBe(200);
    const [first, second] = response.body as ProjectSummary[];
    expect(first).toMatchObject({
      id: project.id,
      name: '예제 프로젝트',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      taskCount: 2,
      status: 'ahead',
    });
    // 계획 누계 60 + 40 × 28/59, 실적 누계 60 × 100% + 40 × 50%
    expect(first.plannedToDate).toBeCloseTo(78.98, 2);
    expect(first.actualToDate).toBeCloseTo(80, 10);
    expect(first.variance).toBeCloseTo(1.02, 2);
    expect(second).toMatchObject({
      id: empty.id,
      taskCount: 0,
      plannedToDate: 0,
      actualToDate: 0,
      status: 'onTrack',
    });
  });

  it('기준일에 따라 계획·실적 누계와 상태가 달라진다', async () => {
    await seedExample(ctx.app);

    const response = await request(ctx.app).get('/api/projects').query({ asOf: '2026-01-16' });

    const [summary] = response.body as ProjectSummary[];
    expect(summary.plannedToDate).toBeCloseTo(30.97, 2);
    expect(summary.actualToDate).toBe(0);
    expect(summary.status).toBe('behind');
  });

  it('asOf를 보내지 않으면 서버의 오늘 날짜로 계산한다', async () => {
    const today = todayString();
    await postProject(ctx.app, { ...exampleProject, startDate: today, endDate: today });
    const { id } = (await request(ctx.app).get('/api/projects')).body[0] as ProjectSummary;
    const created = await request(ctx.app)
      .post(`/api/projects/${id}/tasks`)
      .send({ ...taskA, startDate: today, endDate: today });
    expect(created.status).toBe(201);

    const response = await request(ctx.app).get('/api/projects');

    // 오늘 하루짜리 공종이므로 오늘 기준 계획 누계는 100입니다.
    expect(response.body[0].plannedToDate).toBeCloseTo(100, 10);
    expect(response.body[0].status).toBe('behind');
  });

  it('asOf가 날짜 형식이 아니면 400을 반환한다', async () => {
    const response = await request(ctx.app).get('/api/projects').query({ asOf: '2026-13-01' });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
      fields: { asOf: '기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.' },
    });
  });
});

describe('GET /api/projects/:id', () => {
  it('프로젝트와 공종(순서대로)·실적을 함께 반환한다', async () => {
    const { project, a, b } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const response = await request(ctx.app).get(`/api/projects/${project.id}`);

    expect(response.status).toBe(200);
    expect(response.body.project).toEqual(project);
    expect(response.body.tasks).toEqual([a, b]);
    expect(response.body.progress).toHaveLength(1);
    expect(response.body.progress[0]).toMatchObject({ taskId: a.id, date: '2026-01-15', percent: 50 });
  });
});

describe('PUT /api/projects/:id', () => {
  it('수정한 값을 200으로 반환하고 저장한다', async () => {
    const project = await postProject(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}`)
      .send({ ...exampleProject, name: '이름 변경', endDate: '2026-06-30', weightBasis: 'manual' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: project.id,
      name: '이름 변경',
      endDate: '2026-06-30',
      weightBasis: 'manual',
      createdAt: project.createdAt,
    });
    expect(ctx.readDb().projects[0].name).toBe('이름 변경');
  });

  it('보내지 않은 항목은 기존 값을 유지한다', async () => {
    const project = await postProject(ctx.app, { ...exampleProject, weightBasis: 'manual' });

    const response = await request(ctx.app).put(`/api/projects/${project.id}`).send({ name: '이름만 변경' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: '이름만 변경',
      description: '기준 예제',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      weightBasis: 'manual',
    });
  });

  it('이름을 비우면 400을 반환하고 저장된 값은 바뀌지 않는다', async () => {
    const project = await postProject(ctx.app);

    const response = await request(ctx.app).put(`/api/projects/${project.id}`).send({ name: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ name: '프로젝트 이름을 입력하세요.' });
    expect(ctx.readDb().projects[0]).toEqual(project);
  });

  it('AC-F1-6: 기간을 줄여 공종이 벗어나면 400으로 거부하고 저장된 값은 바뀌지 않는다', async () => {
    const { project } = await seedExample(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}`)
      .send({ ...exampleProject, endDate: '2026-02-28' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fields).toEqual({
      endDate: '프로젝트 기간은 등록된 공종의 기간을 모두 포함해야 합니다.',
    });
    expect(ctx.readDb().projects[0]).toEqual(project);

    const startCut = await request(ctx.app)
      .put(`/api/projects/${project.id}`)
      .send({ ...exampleProject, startDate: '2026-01-02' });
    expect(startCut.status).toBe(400);
    expect(startCut.body.error.fields.startDate).toBe('프로젝트 기간은 등록된 공종의 기간을 모두 포함해야 합니다.');
  });

  it('공종을 모두 포함하는 범위로는 기간을 바꿀 수 있다', async () => {
    const { project } = await seedExample(ctx.app);

    const response = await request(ctx.app)
      .put(`/api/projects/${project.id}`)
      .send({ ...exampleProject, startDate: '2025-12-01', endDate: '2026-04-30' });

    expect(response.status).toBe(200);
    expect(response.body.startDate).toBe('2025-12-01');
  });
});

describe('DELETE /api/projects/:id', () => {
  it('AC-F1-7: 204를 반환하고 목록에서 사라지며 이후 조회는 404이다', async () => {
    const project = await postProject(ctx.app);

    const response = await request(ctx.app).delete(`/api/projects/${project.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect((await request(ctx.app).get('/api/projects')).body).toEqual([]);
    const after = await request(ctx.app).get(`/api/projects/${project.id}`);
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('NOT_FOUND');
  });

  it('AC-F1-8: 저장 파일에 그 프로젝트의 공종과 실적이 남지 않고 다른 프로젝트는 그대로다', async () => {
    const { project, a } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);
    const other = await seedExample(ctx.app);
    await putProgress(ctx.app, other.project.id, other.b.id, '2026-02-10', 20);

    const response = await request(ctx.app).delete(`/api/projects/${project.id}`);

    expect(response.status).toBe(204);
    const db = ctx.readDb();
    expect(db.projects.map((item) => item.id)).toEqual([other.project.id]);
    expect(db.tasks.map((item) => item.id).sort()).toEqual([other.a.id, other.b.id].sort());
    expect(db.progress.map((item) => item.taskId)).toEqual([other.b.id]);
  });
});

describe('없는 프로젝트', () => {
  it('AC-F1-9: 조회·수정·삭제 모두 404 NOT_FOUND와 한국어 메시지를 반환한다', async () => {
    const responses = [
      await request(ctx.app).get(`/api/projects/${MISSING_ID}`),
      await request(ctx.app).put(`/api/projects/${MISSING_ID}`).send(exampleProject),
      await request(ctx.app).delete(`/api/projects/${MISSING_ID}`),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' },
      });
    }
  });
});

describe('예상하지 못한 오류', () => {
  it('500 INTERNAL_ERROR와 한국어 메시지를 반환하고 내부 오류 내용은 노출하지 않는다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      ...ctx.store,
      listProjects: () => Promise.reject(new Error('disk failure')),
    } as Store;

    const response = await request(createApp(broken)).get('/api/projects');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: '서버에서 오류가 발생했습니다. 잠시 후 다시 시도하세요.' },
    });
    expect(response.text).not.toContain('disk failure');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
