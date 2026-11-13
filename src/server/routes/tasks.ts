import { Router } from 'express';
import type { Project, Task } from '../../shared/types';
import { validateTask } from '../../shared/validation';
import { assertValid, asyncHandler, notFound, validationError } from '../errors';
import type { Store, TaskInput } from '../store';
import { asObject, requireProject } from './projects';

export const TASK_NOT_FOUND = '공종을 찾을 수 없습니다.';
export const TASK_IDS_REQUIRED = '공종 순서 목록(taskIds)을 문자열 배열로 보내 주세요.';
export const TASK_IDS_MISMATCH = '순서 목록이 이 프로젝트의 공종 전체와 일치하지 않습니다.';

/** 프로젝트와 그 프로젝트에 속한 공종을 읽고, 없으면 404 오류를 던집니다. */
export async function requireTask(
  store: Store,
  projectId: string,
  taskId: string,
): Promise<{ project: Project; task: Task }> {
  const project = await requireProject(store, projectId);
  const task = await store.getTask(taskId);
  // 다른 프로젝트의 공종은 없는 것으로 봅니다.
  if (!task || task.projectId !== project.id) throw notFound(TASK_NOT_FOUND);
  return { project, task };
}

/** 검증을 통과한 본문을 저장 형식으로 바꿉니다. */
function toTaskInput(data: Record<string, unknown>): TaskInput {
  return {
    category: typeof data.category === 'string' ? data.category.trim() : '',
    name: (data.name as string).trim(),
    weightValue: data.weightValue as number,
    startDate: data.startDate as string,
    endDate: data.endDate as string,
  };
}

/** /api/projects 아래에 붙는 공종 라우터 */
export function createTasksRouter(store: Store): Router {
  const router = Router();

  // 공종 추가(맨 뒤 순서)
  router.post(
    '/:id/tasks',
    asyncHandler(async (req, res) => {
      const project = await requireProject(store, req.params.id);
      assertValid(validateTask(req.body, project));
      const task = await store.createTask(project.id, toTaskInput(req.body as Record<string, unknown>));
      if (!task) throw notFound(TASK_NOT_FOUND);
      res.status(201).json(task);
    }),
  );

  // 순서 변경. '/:id/tasks/:taskId'보다 먼저 등록해야 'order'가 공종 id로 해석되지 않습니다.
  router.put(
    '/:id/tasks/order',
    asyncHandler(async (req, res) => {
      const project = await requireProject(store, req.params.id);
      const taskIds = asObject(req.body)?.taskIds;
      if (!Array.isArray(taskIds) || !taskIds.every((id): id is string => typeof id === 'string')) {
        throw validationError({ taskIds: TASK_IDS_REQUIRED });
      }
      const tasks = await store.reorderTasks(project.id, taskIds);
      if (!tasks) throw validationError({ taskIds: TASK_IDS_MISMATCH });
      res.json(tasks);
    }),
  );

  // 보내지 않은 항목은 기존 값을 유지합니다.
  router.put(
    '/:id/tasks/:taskId',
    asyncHandler(async (req, res) => {
      const { project, task } = await requireTask(store, req.params.id, req.params.taskId);
      const body = asObject(req.body);
      const candidate = body
        ? {
            category: task.category,
            name: task.name,
            weightValue: task.weightValue,
            startDate: task.startDate,
            endDate: task.endDate,
            ...body,
          }
        : req.body;
      assertValid(validateTask(candidate, project));
      const updated = await store.updateTask(task.id, toTaskInput(candidate as Record<string, unknown>));
      if (!updated) throw notFound(TASK_NOT_FOUND);
      res.json(updated);
    }),
  );

  // 공종과 그 실적 삭제
  router.delete(
    '/:id/tasks/:taskId',
    asyncHandler(async (req, res) => {
      const { task } = await requireTask(store, req.params.id, req.params.taskId);
      const deleted = await store.deleteTask(task.id);
      if (!deleted) throw notFound(TASK_NOT_FOUND);
      res.status(204).end();
    }),
  );

  return router;
}
