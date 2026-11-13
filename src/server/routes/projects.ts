import { Router } from 'express';
import { buildSchedule } from '../../shared/bohal';
import { isValidDate } from '../../shared/dates';
import type { Project, ProjectSummary } from '../../shared/types';
import { validateProject } from '../../shared/validation';
import { assertValid, asyncHandler, notFound, validationError } from '../errors';
import type { ProjectInput, Store } from '../store';

export const PROJECT_NOT_FOUND = '프로젝트를 찾을 수 없습니다.';
export const AS_OF_INVALID = '기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.';

/** 서버의 오늘 날짜(YYYY-MM-DD, 서버 PC의 달력 날짜) */
export function todayString(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** asOf 쿼리를 읽습니다. 없으면 오늘, 형식이 틀리면 400 오류를 던집니다. */
export function readAsOf(value: unknown): string {
  if (value === undefined || value === '') return todayString();
  if (!isValidDate(value)) throw validationError({ asOf: AS_OF_INVALID });
  return value;
}

/** 프로젝트를 읽고, 없으면 404 오류를 던집니다. */
export async function requireProject(store: Store, id: string): Promise<Project> {
  const project = await store.getProject(id);
  if (!project) throw notFound(PROJECT_NOT_FOUND);
  return project;
}

/** JSON 본문이 객체이면 그대로, 아니면 null */
export function asObject(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/** 검증을 통과한 본문을 저장 형식으로 바꿉니다. */
function toProjectInput(data: Record<string, unknown>): ProjectInput {
  return {
    name: (data.name as string).trim(),
    description: typeof data.description === 'string' ? data.description : '',
    startDate: data.startDate as string,
    endDate: data.endDate as string,
    // 보할 기준을 보내지 않으면 금액 기준입니다.
    weightBasis: data.weightBasis === 'manual' ? 'manual' : 'amount',
  };
}

export function createProjectsRouter(store: Store): Router {
  const router = Router();

  // 프로젝트 목록(공종 수, 기준일 현재 계획·실적 누계, 상태 포함)
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const asOf = readAsOf(req.query.asOf);
      const projects = await store.listProjects();
      const summaries: ProjectSummary[] = [];
      for (const project of projects) {
        const tasks = await store.listTasks(project.id);
        const progress = await store.listProjectProgress(project.id);
        const { summary } = buildSchedule(project, tasks, progress, 'month', asOf);
        summaries.push({
          ...project,
          taskCount: tasks.length,
          plannedToDate: summary.plannedToDate,
          actualToDate: summary.actualToDate,
          variance: summary.variance,
          status: summary.status,
        });
      }
      res.json(summaries);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      assertValid(validateProject(req.body));
      const project = await store.createProject(toProjectInput(req.body as Record<string, unknown>));
      res.status(201).json(project);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const project = await requireProject(store, req.params.id);
      const tasks = await store.listTasks(project.id);
      const progress = await store.listProjectProgress(project.id);
      res.json({ project, tasks, progress });
    }),
  );

  // 보내지 않은 항목은 기존 값을 유지합니다.
  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await requireProject(store, req.params.id);
      const tasks = await store.listTasks(existing.id);
      const body = asObject(req.body);
      const candidate = body
        ? {
            name: existing.name,
            description: existing.description,
            startDate: existing.startDate,
            endDate: existing.endDate,
            weightBasis: existing.weightBasis,
            ...body,
          }
        : req.body;
      assertValid(validateProject(candidate, tasks));
      const updated = await store.updateProject(existing.id, toProjectInput(candidate as Record<string, unknown>));
      if (!updated) throw notFound(PROJECT_NOT_FOUND);
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const deleted = await store.deleteProject(req.params.id);
      if (!deleted) throw notFound(PROJECT_NOT_FOUND);
      res.status(204).end();
    }),
  );

  return router;
}
