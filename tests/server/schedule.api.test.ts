import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Schedule } from '../../src/shared/types';
import {
  createTestContext,
  MISSING_ID,
  postProject,
  postTask,
  putProgress,
  seedExample,
  type TestContext,
} from './helpers';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

async function getSchedule(projectId: string, query: Record<string, string> = {}): Promise<Schedule> {
  const response = await request(ctx.app).get(`/api/projects/${projectId}/schedule`).query(query);
  if (response.status !== 200) throw new Error(`공정표 조회 실패: ${response.status} ${response.text}`);
  return response.body as Schedule;
}

/** CSV 응답을 디코딩하지 않은 바이트 그대로 받습니다(BOM 확인용). */
function getCsv(app: Express, projectId: string, query: Record<string, string> = {}) {
  return request(app)
    .get(`/api/projects/${projectId}/schedule.csv`)
    .query(query)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

function expectClose(actual: readonly (number | null)[], expected: readonly (number | null)[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    if (value === null) expect(actual[index]).toBeNull();
    else expect(actual[index]).toBeCloseTo(value, 2);
  });
}

/** AC-F5-6의 상태: 공종 A 2026-01-31 100%, 공종 B 2026-02-28 50% */
async function seedWithProgress() {
  const seeded = await seedExample(ctx.app);
  await putProgress(ctx.app, seeded.project.id, seeded.a.id, '2026-01-31', 100);
  await putProgress(ctx.app, seeded.project.id, seeded.b.id, '2026-02-28', 50);
  return seeded;
}

describe('GET /api/projects/:id/schedule', () => {
  it('AC-F4-1: 예제 프로젝트의 월 단위 계획이 기준 예제 데이터 표와 일치한다', async () => {
    const { project, a, b } = await seedExample(ctx.app);

    const schedule = await getSchedule(project.id, { unit: 'month', asOf: '2026-02-28' });

    expect(schedule.project).toEqual(project);
    expect(schedule.unit).toBe('month');
    expect(schedule.asOf).toBe('2026-02-28');
    expect(schedule.periods.map((period) => period.label)).toEqual(['2026년 1월', '2026년 2월', '2026년 3월']);
    expect(schedule.asOfPeriodIndex).toBe(1);
    expect(schedule.rows.map((row) => row.taskId)).toEqual([a.id, b.id]);
    expect(schedule.rows[0].bohal).toBeCloseTo(60, 2);
    expect(schedule.rows[1].bohal).toBeCloseTo(40, 2);
    expectClose(schedule.rows[0].planned, [60, null, null]);
    expectClose(schedule.rows[1].planned, [null, 18.98, 21.02]);
    expectClose(schedule.totals.periodPlanned, [60, 18.98, 21.02]);
    expectClose(schedule.totals.cumulativePlanned, [60, 78.98, 100]);
    expect(schedule.totals.weightValue).toBe(100_000_000);
    expect(schedule.totals.bohal).toBeCloseTo(100, 2);
  });

  it('unit을 생략하면 월 단위이다', async () => {
    const { project } = await seedExample(ctx.app);

    const schedule = await getSchedule(project.id, { asOf: '2026-01-16' });

    expect(schedule.unit).toBe('month');
    expect(schedule.periods).toHaveLength(3);
  });

  it('asOf를 생략하면 서버의 오늘 날짜이다', async () => {
    const { project } = await seedExample(ctx.app);
    const pad = (value: number) => String(value).padStart(2, '0');
    const dateOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

    const before = dateOf(new Date());
    const schedule = await getSchedule(project.id);
    const after = dateOf(new Date());

    // 자정을 넘기는 순간에 실행되어도 통과하도록 요청 전후 날짜를 모두 허용합니다.
    expect([before, after]).toContain(schedule.asOf);
  });

  it('AC-F4-6: 주 단위 기간 계획은 28.57, 50.00, 21.43이다', async () => {
    const project = await postProject(ctx.app, {
      name: '2주 프로젝트',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await postTask(ctx.app, project.id, {
      name: '단일 공종',
      weightValue: 1000,
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });

    const schedule = await getSchedule(project.id, { unit: 'week', asOf: '2026-01-07' });

    expect(schedule.unit).toBe('week');
    expect(schedule.periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2025-12-29', end: '2026-01-04' },
      { start: '2026-01-05', end: '2026-01-11' },
      { start: '2026-01-12', end: '2026-01-18' },
    ]);
    expect(schedule.rows[0].bohal).toBeCloseTo(100, 2);
    expectClose(schedule.rows[0].planned, [28.57, 50, 21.43]);
    expectClose(schedule.totals.periodPlanned, [28.57, 50, 21.43]);
    expectClose(schedule.totals.cumulativePlanned, [28.57, 78.57, 100]);
    expect(schedule.asOfPeriodIndex).toBe(1);
  });

  it('AC-F5-6: 기준일 2026-02-28의 실적은 1월 60, 2월 누계 80·기간 20이고 3월은 null이다', async () => {
    const { project } = await seedWithProgress();

    const schedule = await getSchedule(project.id, { asOf: '2026-02-28' });

    expectClose(schedule.totals.cumulativeActual, [60, 80, null]);
    expectClose(schedule.totals.periodActual, [60, 20, null]);
    expect(schedule.rows.map((row) => row.currentPercent)).toEqual([100, 50]);
  });

  it('AC-F5-7: 기준일을 2026-01-31로 바꾸면 2월 실적이 null이 되고 1월 누계 실적은 60이다', async () => {
    const { project } = await seedWithProgress();

    const schedule = await getSchedule(project.id, { asOf: '2026-01-31' });

    expectClose(schedule.totals.cumulativeActual, [60, null, null]);
    expectClose(schedule.totals.periodActual, [60, null, null]);
    expect(schedule.asOfPeriodIndex).toBe(0);
  });

  it('AC-F7-1: 기준일 2026-02-28의 요약은 계획 78.98, 실적 80.00, 편차 +1.02, 앞섬이다', async () => {
    const { project } = await seedWithProgress();

    const { summary } = await getSchedule(project.id, { asOf: '2026-02-28' });

    expect(summary.plannedToDate).toBeCloseTo(78.98, 2);
    expect(summary.actualToDate).toBeCloseTo(80, 2);
    expect(summary.variance).toBeCloseTo(1.02, 2);
    expect(summary.status).toBe('ahead');
  });

  it('기준일이 프로젝트 기간 밖이면 asOfPeriodIndex가 null이다', async () => {
    const { project } = await seedExample(ctx.app);

    const schedule = await getSchedule(project.id, { asOf: '2026-04-01' });

    expect(schedule.asOfPeriodIndex).toBeNull();
  });

  it('AC-F3-4: 공종이 없는 프로젝트도 200을 반환하고 보할 합계는 0이다', async () => {
    const project = await postProject(ctx.app);

    const response = await request(ctx.app).get(`/api/projects/${project.id}/schedule`).query({ asOf: '2026-02-28' });

    expect(response.status).toBe(200);
    const schedule = response.body as Schedule;
    expect(schedule.rows).toEqual([]);
    expect(schedule.periods).toHaveLength(3);
    expect(schedule.totals.bohal).toBe(0);
    expect(schedule.totals.weightValue).toBe(0);
    expect(schedule.totals.periodPlanned).toEqual([0, 0, 0]);
    expect(schedule.totals.cumulativePlanned).toEqual([0, 0, 0]);
    expect(schedule.summary).toMatchObject({ plannedToDate: 0, actualToDate: 0 });
  });

  it.each(['day', 'MONTH', 'weeks'])('unit이 %j 이면 400으로 거부한다', async (unit) => {
    const { project } = await seedExample(ctx.app);

    const response = await request(ctx.app).get(`/api/projects/${project.id}/schedule`).query({ unit });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '기간 단위는 month(월) 또는 week(주)여야 합니다.',
      fields: { unit: '기간 단위는 month(월) 또는 week(주)여야 합니다.' },
    });
  });

  it('unit을 여러 번 보내면 400으로 거부한다', async () => {
    const { project } = await seedExample(ctx.app);

    const response = await request(ctx.app).get(`/api/projects/${project.id}/schedule?unit=month&unit=week`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['2026-02-30', '2026/02/28', '20260228', 'today'])('asOf가 %j 이면 400으로 거부한다', async (asOf) => {
    const { project } = await seedExample(ctx.app);

    const response = await request(ctx.app).get(`/api/projects/${project.id}/schedule`).query({ asOf });

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: '기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
      fields: { asOf: '기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.' },
    });
  });

  it('없는 프로젝트는 404를 반환한다', async () => {
    const response = await request(ctx.app).get(`/api/projects/${MISSING_ID}/schedule`);

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
  });
});

describe('GET /api/projects/:id/schedule.csv', () => {
  it('AC-F8-1: text/csv와 attachment, 인코딩된 한글 파일 이름으로 응답한다', async () => {
    const { project } = await seedWithProgress();

    const response = await getCsv(ctx.app, project.id, { asOf: '2026-02-28' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    const disposition = response.headers['content-disposition'] as string;
    expect(disposition).toMatch(/^attachment; filename="schedule\.csv"; filename\*=UTF-8''/);
    // 헤더에는 ASCII만 들어갑니다.
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
    const encodedName = disposition.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encodedName)).toBe('예제 프로젝트_보할공정표_월간_2026-02-28.csv');
  });

  it('AC-F8-2, AC-F8-4: 본문은 UTF-8 BOM으로 시작하고 머리글·공종 행·하단 4행으로 이루어진다', async () => {
    const { project } = await seedWithProgress();

    const response = await getCsv(ctx.app, project.id, { unit: 'month', asOf: '2026-02-28' });
    const body = response.body as Buffer;

    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = body.subarray(3).toString('utf8').split('\r\n');
    expect(lines.pop()).toBe('');
    expect(lines).toEqual([
      '구분,공종명,금액,보할(%),시작일,종료일,진척률(%),2026년 1월,2026년 2월,2026년 3월',
      '토목,공종 A,60000000,60.00,2026-01-01,2026-01-31,100.00,60.00,,',
      '건축,공종 B,40000000,40.00,2026-02-01,2026-03-31,50.00,,18.98,21.02',
      '기간 계획(%),,,,,,,60.00,18.98,21.02',
      '누계 계획(%),,,,,,,60.00,78.98,100.00',
      '기간 실적(%),,,,,,,60.00,20.00,',
      '누계 실적(%),,,,,,,60.00,80.00,',
    ]);
  });

  it('AC-F8-3: 공종명에 쉼표와 큰따옴표가 있어도 열이 어긋나지 않는다', async () => {
    const project = await postProject(ctx.app);
    await postTask(ctx.app, project.id, {
      category: '토목, 기초',
      name: '터파기 "1차"',
      weightValue: 100,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const response = await getCsv(ctx.app, project.id, { asOf: '2026-01-31' });
    const lines = (response.body as Buffer).subarray(3).toString('utf8').split('\r\n');

    expect(lines[1]).toBe('"토목, 기초","터파기 ""1차""",100,100.00,2026-01-01,2026-01-31,0.00,100.00,,');
  });

  it('주 단위 CSV는 주 기간 열과 "주간" 파일 이름을 쓴다', async () => {
    const project = await postProject(ctx.app, {
      name: '2주/프로젝트',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await postTask(ctx.app, project.id, {
      name: '단일 공종',
      weightValue: 1000,
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });

    const response = await getCsv(ctx.app, project.id, { unit: 'week', asOf: '2026-01-07' });
    const lines = (response.body as Buffer).subarray(3).toString('utf8').split('\r\n');

    expect(response.status).toBe(200);
    expect(lines[0].split(',')).toHaveLength(7 + 3);
    expect(lines[2]).toBe('기간 계획(%),,,,,,,28.57,50.00,21.43');
    const encodedName = (response.headers['content-disposition'] as string).split("filename*=UTF-8''")[1];
    // 파일 이름에 쓸 수 없는 문자(/)는 밑줄로 바뀝니다.
    expect(decodeURIComponent(encodedName)).toBe('2주_프로젝트_보할공정표_주간_2026-01-07.csv');
  });

  it('공종이 없는 프로젝트도 머리글과 하단 4행의 CSV를 내려준다', async () => {
    const project = await postProject(ctx.app);

    const response = await getCsv(ctx.app, project.id, { asOf: '2026-02-28' });
    const lines = (response.body as Buffer).subarray(3).toString('utf8').split('\r\n');

    expect(response.status).toBe(200);
    expect(lines).toHaveLength(5 + 1);
    expect(lines[1]).toBe('기간 계획(%),,,,,,,0.00,0.00,0.00');
  });

  it('잘못된 unit과 asOf는 400 JSON 오류로 응답한다', async () => {
    const { project } = await seedExample(ctx.app);

    const badUnit = await request(ctx.app).get(`/api/projects/${project.id}/schedule.csv`).query({ unit: 'day' });
    const badAsOf = await request(ctx.app).get(`/api/projects/${project.id}/schedule.csv`).query({ asOf: '2026-13-01' });

    expect(badUnit.status).toBe(400);
    expect(badUnit.body.error.fields).toEqual({ unit: '기간 단위는 month(월) 또는 week(주)여야 합니다.' });
    expect(badAsOf.status).toBe(400);
    expect(badAsOf.body.error.fields).toEqual({ asOf: '기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.' });
  });

  it('없는 프로젝트는 404를 반환한다', async () => {
    const response = await request(ctx.app).get(`/api/projects/${MISSING_ID}/schedule.csv`);

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });
  });
});
