import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProgressRecord, Project, Task } from '../shared/types';

// JSON 파일 저장소입니다. dataDir/db.json 한 파일에 모든 데이터를 둡니다.
// - 읽기는 메모리에 올려 둔 내용을 돌려줍니다.
// - 쓰기는 내부 큐에서 한 번에 하나씩 처리하고, db.json.tmp에 기록한 뒤 이름을 바꿔 교체합니다.
// - 파일 기록이 실패하면 메모리 내용도 바꾸지 않습니다.
// 입력값 검증은 하지 않습니다(호출하는 쪽에서 src/shared/validation.ts로 검증).

export const DB_FILE_NAME = 'db.json';
export const DB_VERSION = 1;

export interface Database {
  version: 1;
  projects: Project[];
  tasks: Task[];
  progress: ProgressRecord[];
}

export type ProjectInput = Pick<Project, 'name' | 'description' | 'startDate' | 'endDate' | 'weightBasis'>;
export type TaskInput = Pick<Task, 'category' | 'name' | 'weightValue' | 'startDate' | 'endDate'>;

export interface Store {
  /** 데이터 파일(db.json)의 전체 경로 */
  readonly filePath: string;

  /** 프로젝트 목록(만든 순서) */
  listProjects(): Promise<Project[]>;
  /** 없으면 null */
  getProject(id: string): Promise<Project | null>;
  createProject(input: ProjectInput): Promise<Project>;
  /** 없으면 null */
  updateProject(id: string, input: Partial<ProjectInput>): Promise<Project | null>;
  /** 프로젝트와 소속 공종·실적을 함께 지웁니다. 없으면 false */
  deleteProject(id: string): Promise<boolean>;

  /** 프로젝트의 공종 목록(order 오름차순) */
  listTasks(projectId: string): Promise<Task[]>;
  /** 없으면 null */
  getTask(id: string): Promise<Task | null>;
  /** 맨 뒤 순서로 추가합니다. 프로젝트가 없으면 null */
  createTask(projectId: string, input: TaskInput): Promise<Task | null>;
  /** 없으면 null */
  updateTask(id: string, input: Partial<TaskInput>): Promise<Task | null>;
  /** 공종과 그 실적을 함께 지우고 남은 공종의 order를 0부터 다시 매깁니다. 없으면 false */
  deleteTask(id: string): Promise<boolean>;
  /**
   * taskIds 순서대로 order를 0부터 다시 매깁니다.
   * taskIds가 그 프로젝트의 공종 전체와 정확히 일치하지 않으면(누락·중복·다른 프로젝트 공종) 바꾸지 않고 null을 돌려줍니다.
   */
  reorderTasks(projectId: string, taskIds: readonly string[]): Promise<Task[] | null>;

  /** 공종의 실적 목록(날짜 오름차순) */
  listProgress(taskId: string): Promise<ProgressRecord[]>;
  /** 프로젝트에 속한 모든 공종의 실적 목록 */
  listProjectProgress(projectId: string): Promise<ProgressRecord[]>;
  /** 같은 공종·같은 날짜 기록이 있으면 값을 바꾸고, 없으면 추가합니다. 공종이 없으면 null */
  upsertProgress(taskId: string, date: string, percent: number): Promise<ProgressRecord | null>;
  /** 없으면 false */
  deleteProgress(taskId: string, date: string): Promise<boolean>;
}

function emptyDatabase(): Database {
  return { version: DB_VERSION, projects: [], tasks: [], progress: [] };
}

function serialize(db: Database): string {
  return `${JSON.stringify(db, null, 2)}\n`;
}

function parseDatabase(text: string, filePath: string): Database {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`데이터 파일을 읽을 수 없습니다(JSON 형식 오류): ${filePath}`);
  }
  const data = raw as Partial<Database> | null;
  if (
    typeof data !== 'object' ||
    data === null ||
    data.version !== DB_VERSION ||
    !Array.isArray(data.projects) ||
    !Array.isArray(data.tasks) ||
    !Array.isArray(data.progress)
  ) {
    throw new Error(`데이터 파일의 구조가 올바르지 않습니다: ${filePath}`);
  }
  return { version: DB_VERSION, projects: data.projects, tasks: data.tasks, progress: data.progress };
}

/** 폴더와 파일이 없으면 만들고, 있으면 읽어 옵니다. */
function loadOrCreate(dataDir: string, filePath: string): Database {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(filePath)) {
    const db = emptyDatabase();
    writeFileSync(filePath, serialize(db), 'utf8');
    return db;
  }
  return parseDatabase(readFileSync(filePath, 'utf8'), filePath);
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Windows에서는 백신·색인 프로그램이 파일을 잠깐 잡고 있어 rename이 실패할 수 있어 몇 번 다시 시도합니다. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || code === undefined || !RENAME_RETRY_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

function byOrder(a: Task, b: Task): number {
  return a.order - b.order;
}

function byDate(a: ProgressRecord, b: ProgressRecord): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/** 정의된 값만 골라 덮어씁니다(undefined는 "바꾸지 않음"). */
function pickDefined<T extends object>(input: Partial<T>, keys: readonly (keyof T)[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (input[key] !== undefined) result[key] = input[key];
  }
  return result;
}

const PROJECT_KEYS = ['name', 'description', 'startDate', 'endDate', 'weightBasis'] as const;
const TASK_KEYS = ['category', 'name', 'weightValue', 'startDate', 'endDate'] as const;

export function createStore(dataDir: string): Store {
  const filePath = path.resolve(dataDir, DB_FILE_NAME);
  const tmpPath = `${filePath}.tmp`;

  let db = loadOrCreate(path.dirname(filePath), filePath);
  // 쓰기 큐의 꼬리. 앞선 작업이 실패해도 다음 작업은 이어서 실행됩니다.
  let tail: Promise<unknown> = Promise.resolve();

  /** 큐에 쌓인 쓰기가 끝난 뒤의 내용을 읽습니다. */
  function read<T>(select: (current: Database) => T): Promise<T> {
    return tail.then(() => structuredClone(select(db)));
  }

  /**
   * 쓰기 한 건을 큐에 넣습니다. 복사본을 고친 뒤 파일에 기록하고, 성공했을 때만 메모리 내용을 교체합니다.
   * mutate가 changed: false를 돌려주면 파일을 건드리지 않습니다.
   */
  function write<T>(mutate: (draft: Database) => { result: T; changed: boolean }): Promise<T> {
    const run = async (): Promise<T> => {
      const draft = structuredClone(db);
      const { result, changed } = mutate(draft);
      if (changed) {
        await writeFile(tmpPath, serialize(draft), 'utf8');
        await renameWithRetry(tmpPath, filePath);
        db = draft;
      }
      return structuredClone(result);
    };
    const next = tail.then(run);
    tail = next.catch(() => undefined);
    return next;
  }

  function renumber(draft: Database, projectId: string): void {
    draft.tasks
      .filter((task) => task.projectId === projectId)
      .sort(byOrder)
      .forEach((task, index) => {
        task.order = index;
      });
  }

  return {
    filePath,

    listProjects: () => read((current) => current.projects),

    getProject: (id) => read((current) => current.projects.find((project) => project.id === id) ?? null),

    createProject: (input) =>
      write((draft) => {
        const now = new Date().toISOString();
        const project: Project = {
          id: randomUUID(),
          name: input.name,
          description: input.description ?? '',
          startDate: input.startDate,
          endDate: input.endDate,
          weightBasis: input.weightBasis,
          createdAt: now,
          updatedAt: now,
        };
        draft.projects.push(project);
        return { result: project, changed: true };
      }),

    updateProject: (id, input) =>
      write((draft) => {
        const project = draft.projects.find((item) => item.id === id);
        if (!project) return { result: null, changed: false };
        Object.assign(project, pickDefined<ProjectInput>(input, PROJECT_KEYS), {
          updatedAt: new Date().toISOString(),
        });
        return { result: project, changed: true };
      }),

    deleteProject: (id) =>
      write((draft) => {
        if (!draft.projects.some((project) => project.id === id)) return { result: false, changed: false };
        const taskIds = new Set(draft.tasks.filter((task) => task.projectId === id).map((task) => task.id));
        draft.projects = draft.projects.filter((project) => project.id !== id);
        draft.tasks = draft.tasks.filter((task) => task.projectId !== id);
        draft.progress = draft.progress.filter((record) => !taskIds.has(record.taskId));
        return { result: true, changed: true };
      }),

    listTasks: (projectId) =>
      read((current) => current.tasks.filter((task) => task.projectId === projectId).sort(byOrder)),

    getTask: (id) => read((current) => current.tasks.find((task) => task.id === id) ?? null),

    createTask: (projectId, input) =>
      write((draft) => {
        if (!draft.projects.some((project) => project.id === projectId)) return { result: null, changed: false };
        const siblings = draft.tasks.filter((item) => item.projectId === projectId);
        const task: Task = {
          id: randomUUID(),
          projectId,
          category: input.category ?? '',
          name: input.name,
          weightValue: input.weightValue,
          startDate: input.startDate,
          endDate: input.endDate,
          order: siblings.reduce((max, item) => Math.max(max, item.order + 1), 0),
        };
        draft.tasks.push(task);
        return { result: task, changed: true };
      }),

    updateTask: (id, input) =>
      write((draft) => {
        const task = draft.tasks.find((item) => item.id === id);
        if (!task) return { result: null, changed: false };
        Object.assign(task, pickDefined<TaskInput>(input, TASK_KEYS));
        return { result: task, changed: true };
      }),

    deleteTask: (id) =>
      write((draft) => {
        const task = draft.tasks.find((item) => item.id === id);
        if (!task) return { result: false, changed: false };
        draft.tasks = draft.tasks.filter((item) => item.id !== id);
        draft.progress = draft.progress.filter((record) => record.taskId !== id);
        renumber(draft, task.projectId);
        return { result: true, changed: true };
      }),

    reorderTasks: (projectId, taskIds) =>
      write((draft) => {
        const tasks = draft.tasks.filter((task) => task.projectId === projectId);
        const byId = new Map(tasks.map((task) => [task.id, task]));
        const unique = new Set(taskIds);
        const matches =
          unique.size === taskIds.length && taskIds.length === tasks.length && taskIds.every((id) => byId.has(id));
        if (!matches) return { result: null, changed: false };
        taskIds.forEach((id, index) => {
          (byId.get(id) as Task).order = index;
        });
        return { result: tasks.sort(byOrder), changed: tasks.length > 0 };
      }),

    listProgress: (taskId) =>
      read((current) => current.progress.filter((record) => record.taskId === taskId).sort(byDate)),

    listProjectProgress: (projectId) =>
      read((current) => {
        const taskIds = new Set(current.tasks.filter((task) => task.projectId === projectId).map((task) => task.id));
        return current.progress.filter((record) => taskIds.has(record.taskId)).sort(byDate);
      }),

    upsertProgress: (taskId, date, percent) =>
      write((draft) => {
        if (!draft.tasks.some((task) => task.id === taskId)) return { result: null, changed: false };
        let record = draft.progress.find((item) => item.taskId === taskId && item.date === date);
        if (record) {
          record.percent = percent;
        } else {
          record = { id: randomUUID(), taskId, date, percent };
          draft.progress.push(record);
        }
        return { result: record, changed: true };
      }),

    deleteProgress: (taskId, date) =>
      write((draft) => {
        const before = draft.progress.length;
        draft.progress = draft.progress.filter((record) => !(record.taskId === taskId && record.date === date));
        const changed = draft.progress.length !== before;
        return { result: changed, changed };
      }),
  };
}
