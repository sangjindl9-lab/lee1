import { Router } from 'express';
import { buildSchedule } from '../../shared/bohal';
import { scheduleToCsv } from '../../shared/csv';
import type { PeriodUnit, Schedule } from '../../shared/types';
import { asyncHandler, validationError } from '../errors';
import type { Store } from '../store';
import { readAsOf, requireProject } from './projects';

export const UNIT_INVALID = '기간 단위는 month(월) 또는 week(주)여야 합니다.';

/** unit 쿼리를 읽습니다. 없으면 월 단위, 허용되지 않는 값이면 400 오류를 던집니다. */
export function readUnit(value: unknown): PeriodUnit {
  if (value === undefined || value === '') return 'month';
  if (value !== 'month' && value !== 'week') throw validationError({ unit: UNIT_INVALID });
  return value;
}

/** 내려받는 CSV의 파일 이름(한글 포함). 파일 이름에 쓸 수 없는 문자는 밑줄로 바꿉니다. */
export function csvFileName(schedule: Schedule): string {
  const projectName = schedule.project.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '프로젝트';
  const unitLabel = schedule.unit === 'week' ? '주간' : '월간';
  return `${projectName}_보할공정표_${unitLabel}_${schedule.asOf}.csv`;
}

/**
 * 첨부 파일용 Content-Disposition 값을 만듭니다.
 * 한글 이름은 RFC 5987 방식(filename*=UTF-8''...)으로 인코딩하고,
 * 이를 모르는 프로그램을 위해 영문 이름(filename)도 함께 넣습니다.
 */
export function attachmentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="schedule.csv"; filename*=UTF-8''${encoded}`;
}

/** /api/projects 아래에 붙는 공정표 라우터 */
export function createScheduleRouter(store: Store): Router {
  const router = Router();

  async function loadSchedule(projectId: string, query: { unit?: unknown; asOf?: unknown }): Promise<Schedule> {
    const unit = readUnit(query.unit);
    const asOf = readAsOf(query.asOf);
    const project = await requireProject(store, projectId);
    const tasks = await store.listTasks(project.id);
    const progress = await store.listProjectProgress(project.id);
    return buildSchedule(project, tasks, progress, unit, asOf);
  }

  // 공정표 CSV 내려받기
  router.get(
    '/:id/schedule.csv',
    asyncHandler(async (req, res) => {
      const schedule = await loadSchedule(req.params.id, req.query);
      res.status(200);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', attachmentDisposition(csvFileName(schedule)));
      res.send(scheduleToCsv(schedule));
    }),
  );

  // 보할 공정표 계산 결과
  router.get(
    '/:id/schedule',
    asyncHandler(async (req, res) => {
      res.json(await loadSchedule(req.params.id, req.query));
    }),
  );

  return router;
}
