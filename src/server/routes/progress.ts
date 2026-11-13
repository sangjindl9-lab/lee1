import { Router } from 'express';
import { isValidDate } from '../../shared/dates';
import { MESSAGES, validateProgress } from '../../shared/validation';
import { assertValid, asyncHandler, notFound, validationError } from '../errors';
import type { Store } from '../store';
import { requireTask, TASK_NOT_FOUND } from './tasks';

export const PROGRESS_NOT_FOUND = '해당 날짜의 실적 기록을 찾을 수 없습니다.';

/** /api/projects 아래에 붙는 실적 라우터 */
export function createProgressRouter(store: Store): Router {
  const router = Router();

  // 실적 등록. 같은 공종·같은 날짜 기록이 있으면 값을 덮어씁니다.
  router.put(
    '/:id/tasks/:taskId/progress',
    asyncHandler(async (req, res) => {
      const { task } = await requireTask(store, req.params.id, req.params.taskId);
      const existing = await store.listProgress(task.id);
      assertValid(validateProgress(req.body, existing));
      const { date, percent } = req.body as { date: string; percent: number };
      const record = await store.upsertProgress(task.id, date, percent);
      if (!record) throw notFound(TASK_NOT_FOUND);
      res.json(record);
    }),
  );

  router.delete(
    '/:id/tasks/:taskId/progress/:date',
    asyncHandler(async (req, res) => {
      const { task } = await requireTask(store, req.params.id, req.params.taskId);
      if (!isValidDate(req.params.date)) throw validationError({ date: MESSAGES.dateInvalid });
      const deleted = await store.deleteProgress(task.id, req.params.date);
      if (!deleted) throw notFound(PROGRESS_NOT_FOUND);
      res.status(204).end();
    }),
  );

  return router;
}
