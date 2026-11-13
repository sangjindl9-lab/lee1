import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Database, type ProjectInput, type TaskInput } from '../../src/server/store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const projectInput: ProjectInput = {
  name: '신축 공사',
  description: '지상 5층',
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  weightBasis: 'amount',
};

function taskInput(name: string, overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    category: '건축',
    name,
    weightValue: 1000,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    ...overrides,
  };
}

let tmpRoot: string;
let dataDir: string;

function readDb(): Database {
  return JSON.parse(readFileSync(path.join(dataDir, 'db.json'), 'utf8')) as Database;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'bohal-store-'));
  dataDir = path.join(tmpRoot, 'data');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('데이터 파일 준비', () => {
  it('폴더와 파일이 없으면 지정한 폴더에 빈 db.json을 만든다 (AC-F9-2, AC-F9-3)', async () => {
    expect(existsSync(dataDir)).toBe(false);

    const store = createStore(dataDir);

    expect(store.filePath).toBe(path.join(dataDir, 'db.json'));
    expect(readDb()).toEqual({ version: 1, projects: [], tasks: [], progress: [] });
    expect(await store.listProjects()).toEqual([]);
  });

  it('여러 단계의 폴더도 한 번에 만든다', () => {
    const nested = path.join(tmpRoot, 'a', 'b', 'c');

    createStore(nested);

    expect(existsSync(path.join(nested, 'db.json'))).toBe(true);
  });

  it('이미 있는 파일은 덮어쓰지 않고 읽는다', async () => {
    const first = createStore(dataDir);
    const project = await first.createProject(projectInput);

    const second = createStore(dataDir);

    expect(await second.listProjects()).toEqual([project]);
  });

  it('내용이 깨진 파일은 덮어쓰지 않고 한국어 오류를 낸다', () => {
    createStore(dataDir);
    const file = path.join(dataDir, 'db.json');
    writeFileSync(file, '{ 깨진 내용', 'utf8');

    expect(() => createStore(dataDir)).toThrow(/데이터 파일을 읽을 수 없습니다/);
    expect(readFileSync(file, 'utf8')).toBe('{ 깨진 내용');
  });

  it('구조가 다른 파일은 한국어 오류를 낸다', () => {
    createStore(dataDir);
    writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ version: 1, projects: [] }), 'utf8');

    expect(() => createStore(dataDir)).toThrow(/구조가 올바르지 않습니다/);
  });

  it('쓰기가 끝나면 임시 파일(db.json.tmp)이 남지 않는다', async () => {
    const store = createStore(dataDir);

    await store.createProject(projectInput);

    expect(existsSync(path.join(dataDir, 'db.json.tmp'))).toBe(false);
  });
});

describe('프로젝트', () => {
  it('생성하면 UUID와 생성·수정 시각이 붙고 파일에 기록된다', async () => {
    const store = createStore(dataDir);

    const project = await store.createProject(projectInput);

    expect(project).toMatchObject(projectInput);
    expect(project.id).toMatch(UUID);
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
    expect(project.updatedAt).toBe(project.createdAt);
    expect(readDb().projects).toEqual([project]);
  });

  it('목록은 만든 순서이고, id로 한 건을 조회한다', async () => {
    const store = createStore(dataDir);
    const a = await store.createProject({ ...projectInput, name: '가' });
    const b = await store.createProject({ ...projectInput, name: '나' });

    expect((await store.listProjects()).map((p) => p.id)).toEqual([a.id, b.id]);
    expect(await store.getProject(b.id)).toEqual(b);
    expect(await store.getProject('없는-id')).toBeNull();
  });

  it('수정하면 넘긴 값만 바뀌고 id와 생성 시각은 그대로다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);

    const updated = await store.updateProject(project.id, { name: '증축 공사', endDate: '2026-12-31' });

    expect(updated).toMatchObject({
      id: project.id,
      name: '증축 공사',
      description: '지상 5층',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      weightBasis: 'amount',
      createdAt: project.createdAt,
    });
    expect(updated!.updatedAt >= project.updatedAt).toBe(true);
    expect(readDb().projects).toEqual([updated]);
  });

  it('없는 프로젝트를 수정·삭제하면 null·false를 돌려주고 파일은 그대로다', async () => {
    const store = createStore(dataDir);
    await store.createProject(projectInput);
    const before = readFileSync(store.filePath, 'utf8');

    expect(await store.updateProject('없는-id', { name: 'x' })).toBeNull();
    expect(await store.deleteProject('없는-id')).toBe(false);
    expect(readFileSync(store.filePath, 'utf8')).toBe(before);
  });

  it('삭제하면 그 프로젝트의 공종과 실적이 파일에 남지 않고 다른 프로젝트는 그대로다 (AC-F1-8)', async () => {
    const store = createStore(dataDir);
    const target = await store.createProject({ ...projectInput, name: '지울 프로젝트' });
    const other = await store.createProject({ ...projectInput, name: '남길 프로젝트' });
    const t1 = (await store.createTask(target.id, taskInput('토공')))!;
    const t2 = (await store.createTask(target.id, taskInput('골조')))!;
    const keep = (await store.createTask(other.id, taskInput('마감')))!;
    await store.upsertProgress(t1.id, '2026-01-31', 30);
    await store.upsertProgress(t2.id, '2026-01-31', 10);
    const keepRecord = await store.upsertProgress(keep.id, '2026-01-31', 50);

    expect(await store.deleteProject(target.id)).toBe(true);

    const db = readDb();
    expect(db.projects).toEqual([other]);
    expect(db.tasks).toEqual([keep]);
    expect(db.progress).toEqual([keepRecord]);
    expect(await store.getProject(target.id)).toBeNull();
    expect(await store.listTasks(target.id)).toEqual([]);
    expect(await store.listProgress(t1.id)).toEqual([]);
  });
});

describe('공종', () => {
  it('생성하면 order가 맨 뒤로 붙고 프로젝트별로 따로 센다', async () => {
    const store = createStore(dataDir);
    const p1 = await store.createProject(projectInput);
    const p2 = await store.createProject({ ...projectInput, name: '다른 프로젝트' });

    const a = (await store.createTask(p1.id, taskInput('토공')))!;
    const b = (await store.createTask(p1.id, taskInput('골조')))!;
    const c = (await store.createTask(p2.id, taskInput('마감')))!;

    expect(a).toMatchObject({ ...taskInput('토공'), projectId: p1.id, order: 0 });
    expect(a.id).toMatch(UUID);
    expect(b.order).toBe(1);
    expect(c.order).toBe(0);
    expect(await store.listTasks(p1.id)).toEqual([a, b]);
    expect(await store.getTask(b.id)).toEqual(b);
    expect(readDb().tasks).toHaveLength(3);
  });

  it('없는 프로젝트에는 공종을 만들지 않는다', async () => {
    const store = createStore(dataDir);

    expect(await store.createTask('없는-id', taskInput('토공'))).toBeNull();
    expect(readDb().tasks).toEqual([]);
  });

  it('수정하면 넘긴 값만 바뀌고 순서와 소속은 그대로다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    await store.createTask(project.id, taskInput('토공'));
    const task = (await store.createTask(project.id, taskInput('골조')))!;

    const updated = await store.updateTask(task.id, { name: '철근콘크리트', weightValue: 2500 });

    expect(updated).toEqual({ ...task, name: '철근콘크리트', weightValue: 2500 });
    expect(await store.getTask(task.id)).toEqual(updated);
    expect(readDb().tasks.find((t) => t.id === task.id)).toEqual(updated);
    expect(await store.updateTask('없는-id', { name: 'x' })).toBeNull();
  });

  it('삭제하면 그 공종의 실적도 지워지고 남은 공종의 순서가 0부터 이어진다 (AC-F2-5)', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const a = (await store.createTask(project.id, taskInput('토공')))!;
    const b = (await store.createTask(project.id, taskInput('골조')))!;
    const c = (await store.createTask(project.id, taskInput('마감')))!;
    await store.upsertProgress(b.id, '2026-01-31', 20);
    await store.upsertProgress(b.id, '2026-02-28', 60);
    const keepRecord = await store.upsertProgress(c.id, '2026-02-28', 5);

    expect(await store.deleteTask(b.id)).toBe(true);

    const db = readDb();
    expect(db.tasks.map((t) => [t.id, t.order])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
    expect(db.progress).toEqual([keepRecord]);
    expect(await store.getTask(b.id)).toBeNull();
    expect(await store.deleteTask(b.id)).toBe(false);
  });

  it('순서를 다시 지정하면 넘긴 순서대로 0부터 매겨진다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const a = (await store.createTask(project.id, taskInput('토공')))!;
    const b = (await store.createTask(project.id, taskInput('골조')))!;
    const c = (await store.createTask(project.id, taskInput('마감')))!;

    const reordered = await store.reorderTasks(project.id, [c.id, a.id, b.id]);

    expect(reordered!.map((t) => [t.id, t.order])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    expect((await store.listTasks(project.id)).map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    expect((await createStore(dataDir).listTasks(project.id)).map((t) => t.id)).toEqual([c.id, a.id, b.id]);

    const added = (await store.createTask(project.id, taskInput('조경')))!;
    expect(added.order).toBe(3);
  });

  it('순서 목록이 공종 전체와 일치하지 않으면 바꾸지 않는다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const other = await store.createProject({ ...projectInput, name: '다른 프로젝트' });
    const a = (await store.createTask(project.id, taskInput('토공')))!;
    const b = (await store.createTask(project.id, taskInput('골조')))!;
    const foreign = (await store.createTask(other.id, taskInput('마감')))!;

    expect(await store.reorderTasks(project.id, [b.id])).toBeNull();
    expect(await store.reorderTasks(project.id, [b.id, b.id])).toBeNull();
    expect(await store.reorderTasks(project.id, [b.id, foreign.id])).toBeNull();
    expect(await store.reorderTasks(project.id, [b.id, a.id, '없는-id'])).toBeNull();

    expect((await store.listTasks(project.id)).map((t) => t.id)).toEqual([a.id, b.id]);
  });
});

describe('실적', () => {
  it('등록하면 UUID가 붙고 목록은 날짜순이다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const task = (await store.createTask(project.id, taskInput('토공')))!;

    const later = (await store.upsertProgress(task.id, '2026-02-28', 60))!;
    const earlier = (await store.upsertProgress(task.id, '2026-01-31', 20))!;

    expect(later).toMatchObject({ taskId: task.id, date: '2026-02-28', percent: 60 });
    expect(later.id).toMatch(UUID);
    expect(await store.listProgress(task.id)).toEqual([earlier, later]);
    expect(readDb().progress).toHaveLength(2);
  });

  it('같은 공종·같은 날짜로 다시 저장하면 기록이 늘지 않고 값만 바뀐다 (AC-F5-2)', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const task = (await store.createTask(project.id, taskInput('토공')))!;
    const otherTask = (await store.createTask(project.id, taskInput('골조')))!;
    const first = (await store.upsertProgress(task.id, '2026-01-31', 20))!;
    await store.upsertProgress(otherTask.id, '2026-01-31', 5);

    const second = (await store.upsertProgress(task.id, '2026-01-31', 35))!;

    expect(second).toEqual({ ...first, percent: 35 });
    expect(await store.listProgress(task.id)).toEqual([second]);
    expect((await store.listProgress(otherTask.id))[0].percent).toBe(5);
    expect(readDb().progress).toHaveLength(2);
  });

  it('없는 공종에는 실적을 기록하지 않는다', async () => {
    const store = createStore(dataDir);

    expect(await store.upsertProgress('없는-id', '2026-01-31', 20)).toBeNull();
    expect(readDb().progress).toEqual([]);
  });

  it('공종과 날짜로 한 건만 삭제한다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const task = (await store.createTask(project.id, taskInput('토공')))!;
    await store.upsertProgress(task.id, '2026-01-31', 20);
    const kept = (await store.upsertProgress(task.id, '2026-02-28', 60))!;

    expect(await store.deleteProgress(task.id, '2026-01-31')).toBe(true);
    expect(await store.deleteProgress(task.id, '2026-01-31')).toBe(false);

    expect(await store.listProgress(task.id)).toEqual([kept]);
    expect(readDb().progress).toEqual([kept]);
  });

  it('프로젝트 단위로 소속 공종의 실적만 모아 준다', async () => {
    const store = createStore(dataDir);
    const p1 = await store.createProject(projectInput);
    const p2 = await store.createProject({ ...projectInput, name: '다른 프로젝트' });
    const a = (await store.createTask(p1.id, taskInput('토공')))!;
    const b = (await store.createTask(p1.id, taskInput('골조')))!;
    const c = (await store.createTask(p2.id, taskInput('마감')))!;
    const ra = await store.upsertProgress(a.id, '2026-02-28', 60);
    const rb = await store.upsertProgress(b.id, '2026-01-31', 10);
    await store.upsertProgress(c.id, '2026-01-31', 99);

    expect(await store.listProjectProgress(p1.id)).toEqual([rb, ra]);
  });
});

describe('데이터 보존과 순차 쓰기', () => {
  it('새 저장소 인스턴스를 만들어도 프로젝트·공종·실적이 그대로 조회된다 (AC-F9-1)', async () => {
    const first = createStore(dataDir);
    const project = await first.createProject(projectInput);
    const task = (await first.createTask(project.id, taskInput('토공')))!;
    const record = (await first.upsertProgress(task.id, '2026-01-31', 20))!;

    const second = createStore(dataDir);

    expect(await second.listProjects()).toEqual([project]);
    expect(await second.getProject(project.id)).toEqual(project);
    expect(await second.listTasks(project.id)).toEqual([task]);
    expect(await second.listProgress(task.id)).toEqual([record]);
  });

  it('동시에 호출한 쓰기 20건이 모두 반영된다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);

    const created = await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.createTask(project.id, taskInput(`공종 ${index + 1}`))),
    );

    expect(created.every((task) => task !== null)).toBe(true);
    expect(new Set(created.map((task) => task!.id)).size).toBe(20);
    expect(created.map((task) => task!.order)).toEqual(Array.from({ length: 20 }, (_, index) => index));

    const db = readDb();
    expect(db.tasks.map((task) => task.name)).toEqual(Array.from({ length: 20 }, (_, index) => `공종 ${index + 1}`));
    expect(await createStore(dataDir).listTasks(project.id)).toHaveLength(20);
  });

  it('종류가 다른 쓰기를 기다리지 않고 섞어 호출해도 호출한 순서대로 반영된다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);
    const task = (await store.createTask(project.id, taskInput('토공')))!;

    const jobs: Promise<unknown>[] = [];
    for (let day = 1; day <= 10; day += 1) {
      const date = `2026-01-${String(day).padStart(2, '0')}`;
      jobs.push(store.upsertProgress(task.id, date, day));
      jobs.push(store.upsertProgress(task.id, date, day * 10));
    }
    const pendingRead = store.listProgress(task.id);
    await Promise.all(jobs);

    expect((await pendingRead).map((record) => record.percent)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(readDb().progress).toHaveLength(10);
  });

  it('돌려받은 객체를 고쳐도 저장소 내용은 바뀌지 않는다', async () => {
    const store = createStore(dataDir);
    const project = await store.createProject(projectInput);

    project.name = '밖에서 고친 이름';
    (await store.listProjects())[0].name = '목록에서 고친 이름';

    expect((await store.getProject(project.id))!.name).toBe('신축 공사');
  });

  it('파일 기록이 실패하면 오류를 돌려주고 메모리 내용도 바꾸지 않으며 다음 쓰기는 정상 처리된다', async () => {
    const store = createStore(dataDir);
    const kept = await store.createProject(projectInput);
    // 폴더를 지워 임시 파일 기록이 실패하게 만듭니다.
    rmSync(dataDir, { recursive: true, force: true });

    await expect(store.createProject({ ...projectInput, name: '실패할 프로젝트' })).rejects.toThrow();
    expect(await store.listProjects()).toEqual([kept]);

    createStore(dataDir);
    const next = await store.createProject({ ...projectInput, name: '다음 프로젝트' });
    expect(readDb().projects).toEqual([kept, next]);
  });
});
