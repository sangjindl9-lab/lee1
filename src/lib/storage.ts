// 저장소 계층. 화면 코드는 ProjectStore 인터페이스만 사용하므로
// 향후 로그인·클라우드 DB(Firebase, Supabase, 자체 API 등)는 어댑터만 추가하면 된다.
import type { Project } from './types';
import { DEFAULT_TEMPLATE, defaultForm } from './schedule';
import { api } from './api';
import { isAutoTitleText } from './form';

export interface ProjectStore {
  readonly label: string;
  list(): Promise<Project[]>;
  save(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = 'gongjung.projects.v1';
const LAST = 'gongjung.last';

function readAll(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeAll(m: Record<string, Project>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 저장공간 부족·비공개 모드 등: 메모리 상태는 유지 */
  }
}

export class LocalStore implements ProjectStore {
  label = '이 브라우저';
  async list() {
    return Object.values(readAll());
  }
  async save(p: Project) {
    const m = readAll();
    m[p.id] = p;
    writeAll(m);
  }
  async remove(id: string) {
    const m = readAll();
    delete m[id];
    writeAll(m);
  }
}

// claude.ai 아티팩트에서 실행될 때만 사용되는 개인 클라우드 저장(로그인한 본인만 접근)
type ClaudeDB = {
  collection(path: string): { get(): Promise<{ docs: { id: string; exists: boolean; data(): any }[] }>; doc(id: string): { set(d: any): Promise<void>; delete(): Promise<void> } };
};
declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
  }
}

export class ClaudeCloudStore implements ProjectStore {
  label = '내 클라우드';
  constructor(private db: ClaudeDB, private uid: string) {}
  private col() {
    return this.db.collection('data/users/' + this.uid);
  }
  async list() {
    const snap = await this.col().get();
    return snap.docs.filter((d) => d.exists).map((d) => JSON.parse(d.data().json) as Project);
  }
  async save(p: Project) {
    await this.col().doc(p.id).set({ json: JSON.stringify(p), name: p.info.name, updatedAt: p.updatedAt });
  }
  async remove(id: string) {
    await this.col().doc(id).delete();
  }
}

/** 로컬 저장을 기본으로, 클라우드가 있으면 함께 저장하고 최신본으로 병합 */
export class SyncStore implements ProjectStore {
  label: string;
  private queue = new Map<string, Promise<void>>();
  constructor(private local: ProjectStore, private cloud: ProjectStore | null) {
    this.label = cloud ? `${local.label} + ${cloud.label}` : local.label;
  }
  async list() {
    const loc = await this.local.list();
    if (!this.cloud) return loc;
    let rem: Project[] = [];
    try {
      rem = await this.cloud.list();
    } catch {
      return loc;
    }
    const m = new Map<string, Project>();
    for (const p of [...loc, ...rem]) {
      const cur = m.get(p.id);
      if (!cur || cur.updatedAt < p.updatedAt) m.set(p.id, p);
    }
    const merged = [...m.values()];
    for (const p of merged) await this.local.save(p);
    return merged;
  }
  async save(p: Project) {
    await this.local.save(p);
    if (this.cloud) {
      const prev = this.queue.get(p.id) || Promise.resolve();
      const next = prev.then(() => this.cloud!.save(p)).catch(() => {});
      this.queue.set(p.id, next);
      await next;
    }
  }
  async remove(id: string) {
    await this.local.remove(id);
    if (this.cloud) await this.cloud.remove(id).catch(() => {});
  }
}

/** 회원제 서버 저장 — 로그인한 회원의 데이터만 읽고 쓴다 */
export class ServerStore implements ProjectStore {
  label = '회원 서버';
  private queue = new Map<string, Promise<void>>();
  async list() {
    const r = await api<{ projects: Project[] }>('GET', '/api/projects');
    return r.projects;
  }
  async save(p: Project) {
    const prev = this.queue.get(p.id) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => api('PUT', `/api/projects/${encodeURIComponent(p.id)}`, { data: p }).then(() => undefined));
    this.queue.set(p.id, next);
    await next;
  }
  async remove(id: string) {
    await api('DELETE', `/api/projects/${encodeURIComponent(id)}`);
  }
}

let serverMode = false;
let lastKey = LAST;
export function setServerMode(on: boolean, username?: string) {
  serverMode = on;
  lastKey = on && username ? `${LAST}.${username}` : LAST;
}
export function isServerMode() {
  return serverMode;
}
/** 이 브라우저(로컬)에 남아 있는 공정표 — 회원 서버로 옮길 때 사용 */
export async function localProjects(): Promise<Project[]> {
  return (await new LocalStore().list()).map(migrate).filter(Boolean) as Project[];
}

export async function createStore(): Promise<ProjectStore> {
  if (serverMode) return new ServerStore();
  const local = new LocalStore();
  try {
    if (window.claude?.use) {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const id = db && user ? await user.id() : null;
      if (db && id) return new SyncStore(local, new ClaudeCloudStore(db, id));
    }
  } catch {
    /* 클라우드 사용 불가 → 로컬만 */
  }
  return new SyncStore(local, null);
}

export function getLastId(): string | null {
  try {
    return localStorage.getItem(lastKey);
  } catch {
    return null;
  }
}
export function setLastId(id: string) {
  try {
    localStorage.setItem(lastKey, id);
  } catch {
    /* noop */
  }
}

/** 이전 버전 데이터나 외부 JSON을 현재 구조로 보정 */
export function migrate(raw: any): Project | null {
  if (!raw || typeof raw !== 'object' || !raw.info || !Array.isArray(raw.tasks)) return null;
  // 예전 버전 예시 공사에 들어 있던 회사명을 일반 예시 이름으로 교체
  if (typeof raw.info.name === 'string' && raw.info.name.startsWith('[예시]')) {
    if (raw.info.contractor === '㈜에스에스전력') raw = { ...raw, info: { ...raw.info, contractor: '○○전기통신㈜' } };
    if (raw.info.docNo === 'SS-2026-PL-001') raw = { ...raw, info: { ...raw.info, docNo: 'PL-2026-001' } };
  }
  return {
    weightMode: 'direct',
    weightProvisional: false,
    groupShare: { elec: 60, comm: 40 },
    history: [],
    view: 'month',
    scheduleBase: null,
    statusNote: '',
    ...raw,
    calendar: { mode: 'weekday', distribution: 'month', holidays: [], ...(raw.calendar || {}) },
    form: { ...defaultForm(), ...(raw.form || {}), title: isAutoTitleText(raw.form?.title || '') ? '' : raw.form?.title || '' },
    template: Array.isArray(raw.template) && raw.template.length ? raw.template : DEFAULT_TEMPLATE.map((r) => ({ ...r })),
    schema: 1,
    tasks: raw.tasks.map((t: any) => ({
      cost: 0, actual: 0, actualStart: '', actualEnd: '', note: '', memo: '', color: '', manual: false, planCurve: null, parentId: null, ...t,
    })),
  } as Project;
}
