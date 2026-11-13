import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgressRecord, ProjectSummary } from '../../src/shared/types';
import {
  createTestContext,
  exampleProject,
  MISSING_ID,
  postProject,
  putProgress,
  seedExample,
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

async function progressOf(projectId: string, taskId: string): Promise<ProgressRecord[]> {
  const response = await request(ctx.app).get(`/api/projects/${projectId}`);
  return (response.body.progress as ProgressRecord[]).filter((record) => record.taskId === taskId);
}

async function actualToDate(projectId: string, asOf: string): Promise<number> {
  const response = await request(ctx.app).get('/api/projects').query({ asOf });
  const summary = (response.body as ProjectSummary[]).find((item) => item.id === projectId);
  if (!summary) throw new Error('프로젝트 요약이 없습니다.');
  return summary.actualToDate;
}

describe('PUT /api/projects/:id/tasks/:taskId/progress', () => {
  it('AC-F5-1: 200과 실적 기록을 반환하고 기록 목록에 날짜순으로 나타난다', async () => {
    const { project, a } = await seedExample(ctx.app);

    const later = await putProgress(ctx.app, project.id, a.id, '2026-01-20', 70);
    const earlier = await putProgress(ctx.app, project.id, a.id, '2026-01-10', 30);

    expect(later.status).toBe(200);
    expect(later.body).toMatchObject({ taskId: a.id, date: '2026-01-20', percent: 70 });
    expect(later.body.id).toMatch(UUID);
    expect(earlier.status).toBe(200);
    expect((await progressOf(project.id, a.id)).map(({ date, percent }) => ({ date, percent }))).toEqual([
      { date: '2026-01-10', percent: 30 },
      { date: '2026-01-20', percent: 70 },
    ]);
  });

  it('0%와 100%를 저장할 수 있다', async () => {
    const { project, a } = await seedExample(ctx.app);

    expect((await putProgress(ctx.app, project.id, a.id, '2026-01-01', 0)).status).toBe(200);
    expect((await putProgress(ctx.app, project.id, a.id, '2026-01-31', 100)).status).toBe(200);
  });

  it('AC-F5-2: 같은 날짜로 다시 저장하면 기록이 늘지 않고 값이 바뀐다', async () => {
    const { project, a } = await seedExample(ctx.app);
    const first = await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const second = await putProgress(ctx.app, project.id, a.id, '2026-01-15', 65);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ...first.body, percent: 65 });
    expect(await progressOf(project.id, a.id)).toEqual([second.body]);
    expect(ctx.readDb().progress).toHaveLength(1);
  });

  it.each([-0.1, 100.1, '50', null])('AC-F5-3: 진척률이 %j 이면 400으로 거부한다', async (percent) => {
    const { project, a } = await seedExample(ctx.app);

    const response = await putProgress(ctx.app, project.id, a.id, '2026-01-15', percent);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '진척률은 0부터 100 사이의 숫자로 입력하세요.',
      fields: { percent: '진척률은 0부터 100 사이의 숫자로 입력하세요.' },
    });
    expect(ctx.readDb().progress).toEqual([]);
  });

  it('AC-F5-4: 이전 기록보다 작은 진척률은 400과 안내 메시지로 거부한다', async () => {
    const { project, a } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const response = await putProgress(ctx.app, project.id, a.id, '2026-01-20', 40);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '진척률은 이전 기록보다 작을 수 없습니다.',
      fields: { percent: '진척률은 이전 기록보다 작을 수 없습니다.' },
    });
    expect(ctx.readDb().progress).toHaveLength(1);
  });

  it('AC-F5-5: 이후 기록보다 큰 진척률은 400으로 거부한다', async () => {
    const { project, a } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const response = await putProgress(ctx.app, project.id, a.id, '2026-01-10', 60);

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ percent: '진척률은 이후 기록보다 클 수 없습니다.' });
    expect(ctx.readDb().progress).toHaveLength(1);
  });

  it('다른 공종의 기록과는 비교하지 않는다', async () => {
    const { project, a, b } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const response = await putProgress(ctx.app, project.id, b.id, '2026-02-20', 10);

    expect(response.status).toBe(200);
  });

  it.each(['', '2026-02-30', '20260115', undefined])('날짜가 %j 이면 400으로 거부한다', async (date) => {
    const { project, a } = await seedExample(ctx.app);

    const response = await putProgress(ctx.app, project.id, a.id, date, 50);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(response.body.error.fields)).toEqual(['date']);
  });

  it('없는 프로젝트·없는 공종·다른 프로젝트의 공종은 404를 반환한다', async () => {
    const { project, a } = await seedExample(ctx.app);
    const other = await postProject(ctx.app, { ...exampleProject, name: '다른 프로젝트' });

    const missingProject = await putProgress(ctx.app, MISSING_ID, a.id, '2026-01-15', 50);
    const missingTask = await putProgress(ctx.app, project.id, MISSING_ID, '2026-01-15', 50);
    const wrongProject = await putProgress(ctx.app, other.id, a.id, '2026-01-15', 50);

    expect(missingProject.status).toBe(404);
    expect(missingProject.body).toEqual({
      error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' },
    });
    for (const response of [missingTask, wrongProject]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: '공종을 찾을 수 없습니다.' } });
    }
    expect(ctx.readDb().progress).toEqual([]);
  });
});

describe('DELETE /api/projects/:id/tasks/:taskId/progress/:date', () => {
  it('AC-F5-9: 204를 반환하고 목록에서 사라지며 실적 누계가 다시 계산된다', async () => {
    const { project, a } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);
    await putProgress(ctx.app, project.id, a.id, '2026-01-31', 100);
    // 공종 A 보할 60 × 100%
    expect(await actualToDate(project.id, '2026-01-31')).toBeCloseTo(60, 10);

    const response = await request(ctx.app).delete(
      `/api/projects/${project.id}/tasks/${a.id}/progress/2026-01-31`,
    );

    expect(response.status).toBe(204);
    expect((await progressOf(project.id, a.id)).map((record) => record.date)).toEqual(['2026-01-15']);
    // 남은 기록 50% → 60 × 50%
    expect(await actualToDate(project.id, '2026-01-31')).toBeCloseTo(30, 10);
  });

  it('삭제한 뒤에는 그 날짜보다 작은 값도 다시 입력할 수 있다', async () => {
    const { project, a } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);
    await request(ctx.app).delete(`/api/projects/${project.id}/tasks/${a.id}/progress/2026-01-15`);

    const response = await putProgress(ctx.app, project.id, a.id, '2026-01-20', 40);

    expect(response.status).toBe(200);
  });

  it('그 날짜의 기록이 없으면 404를 반환한다', async () => {
    const { project, a } = await seedExample(ctx.app);
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const response = await request(ctx.app).delete(
      `/api/projects/${project.id}/tasks/${a.id}/progress/2026-01-16`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: '해당 날짜의 실적 기록을 찾을 수 없습니다.' },
    });
    expect(ctx.readDb().progress).toHaveLength(1);
  });

  it('날짜 형식이 틀리면 400을 반환한다', async () => {
    const { project, a } = await seedExample(ctx.app);

    const response = await request(ctx.app).delete(`/api/projects/${project.id}/tasks/${a.id}/progress/tomorrow`);

    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual({ date: '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.' });
  });

  it('없는 공종이나 다른 프로젝트의 공종은 404를 반환하고 지우지 않는다', async () => {
    const { project, a } = await seedExample(ctx.app);
    const other = await postProject(ctx.app, { ...exampleProject, name: '다른 프로젝트' });
    await putProgress(ctx.app, project.id, a.id, '2026-01-15', 50);

    const missingTask = await request(ctx.app).delete(
      `/api/projects/${project.id}/tasks/${MISSING_ID}/progress/2026-01-15`,
    );
    const wrongProject = await request(ctx.app).delete(
      `/api/projects/${other.id}/tasks/${a.id}/progress/2026-01-15`,
    );

    expect(missingTask.status).toBe(404);
    expect(wrongProject.status).toBe(404);
    expect(wrongProject.body.error.code).toBe('NOT_FOUND');
    expect(ctx.readDb().progress).toHaveLength(1);
  });
});
