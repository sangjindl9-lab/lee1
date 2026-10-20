import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/types';
import { createStore, getLastId, migrate, setLastId, type ProjectStore } from '../lib/storage';
import { sampleProject, uid } from '../lib/schedule';

const MAX_UNDO = 120;

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function useProjects() {
  const storeRef = useRef<ProjectStore | null>(null);
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cur, setCur] = useState<Project | null>(null);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [, force] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string>('');
  const [storeLabel, setStoreLabel] = useState('');
  const timer = useRef<number | null>(null);
  const latest = useRef<Project | null>(null);
  const curRef = useRef<Project | null>(null);
  curRef.current = cur;

  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await createStore();
      storeRef.current = store;
      let list = (await store.list()).map(migrate).filter(Boolean) as Project[];
      if (!list.length) {
        const s = sampleProject();
        await store.save(s);
        list = [s];
      }
      if (!alive) return;
      list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      setProjects(list);
      const last = getLastId();
      setCur(list.find((p) => p.id === last) || list[0]);
      setStoreLabel(store.label);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (p: Project) => {
    const store = storeRef.current;
    if (!store) return;
    setSaveState('saving');
    try {
      await store.save(p);
      setSaveState('saved');
      const d = new Date();
      setSavedAt(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`);
    } catch {
      setSaveState('error');
    }
  }, []);

  const schedule = useCallback(
    (p: Project) => {
      latest.current = p;
      setSaveState('pending');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (latest.current) persist(latest.current);
      }, 700);
    },
    [persist],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = latest.current || cur;
    if (p) await persist(p);
  }, [cur, persist]);

  useEffect(() => {
    const h = () => {
      if (timer.current && latest.current) {
        try {
          storeRef.current?.save(latest.current);
        } catch {
          /* noop */
        }
      }
    };
    window.addEventListener('beforeunload', h);
    window.addEventListener('pagehide', h);
    return () => {
      window.removeEventListener('beforeunload', h);
      window.removeEventListener('pagehide', h);
    };
  }, []);

  const commit = useCallback(
    (next: Project, prev: Project | null, key?: string) => {
      if (prev) {
        const now = Date.now();
        const coalesce = key && lastKey.current && lastKey.current.key === key && now - lastKey.current.at < 1200;
        if (!coalesce) {
          past.current.push(prev);
          if (past.current.length > MAX_UNDO) past.current.shift();
        }
        lastKey.current = key ? { key, at: now } : null;
        future.current = [];
      }
      curRef.current = next;
      setCur(next);
      setProjects((ps) => {
        const i = ps.findIndex((p) => p.id === next.id);
        if (i < 0) return [next, ...ps];
        const c = ps.slice();
        c[i] = next;
        return c;
      });
      schedule(next);
    },
    [schedule],
  );

  /** 프로젝트 변경: fn에 복사본을 넘겨 수정. key가 같으면 연속 입력을 실행취소 1단계로 묶음 */
  const update = useCallback(
    (fn: (draft: Project) => void, key?: string) => {
      const prev = curRef.current;
      if (!prev) return;
      const draft: Project = structuredClone(prev);
      fn(draft);
      draft.updatedAt = new Date().toISOString();
      commit(draft, prev, key);
    },
    [commit],
  );

  const undo = useCallback(() => {
    if (!cur || !past.current.length) return;
    const prev = past.current.pop()!;
    future.current.push(cur);
    lastKey.current = null;
    const p = { ...prev, updatedAt: new Date().toISOString() };
    commit(p, null);
    force((x) => x + 1);
  }, [cur, commit]);

  const redo = useCallback(() => {
    if (!cur || !future.current.length) return;
    const nxt = future.current.pop()!;
    past.current.push(cur);
    lastKey.current = null;
    commit({ ...nxt, updatedAt: new Date().toISOString() }, null);
    force((x) => x + 1);
  }, [cur, commit]);

  const open = useCallback(
    async (id: string) => {
      await flush();
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      past.current = [];
      future.current = [];
      setCur(p);
      setLastId(id);
    },
    [projects, flush],
  );

  const add = useCallback(
    async (p: Project) => {
      await flush();
      past.current = [];
      future.current = [];
      setProjects((ps) => [p, ...ps.filter((x) => x.id !== p.id)]);
      setCur(p);
      setLastId(p.id);
      await persist(p);
    },
    [flush, persist],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const src = projects.find((x) => x.id === id);
      if (!src) return;
      const now = new Date().toISOString();
      const copy: Project = structuredClone(src);
      copy.id = uid('p');
      copy.info.name = `${src.info.name} (복사본)`;
      copy.createdAt = now;
      copy.updatedAt = now;
      await add(copy);
    },
    [projects, add],
  );

  const remove = useCallback(
    async (id: string) => {
      await storeRef.current?.remove(id);
      const rest = projects.filter((x) => x.id !== id);
      setProjects(rest);
      if (cur?.id === id) {
        if (rest.length) {
          setCur(rest[0]);
          setLastId(rest[0].id);
        } else {
          const s = sampleProject();
          await add(s);
        }
        past.current = [];
        future.current = [];
      }
    },
    [projects, cur, add],
  );

  const importMany = useCallback(
    async (raw: unknown): Promise<number> => {
      const arr = Array.isArray(raw) ? raw : (raw as any)?.projects ? (raw as any).projects : [raw];
      const list = arr.map(migrate).filter(Boolean) as Project[];
      for (const p of list) await storeRef.current?.save(p);
      if (list.length) {
        setProjects((ps) => {
          const m = new Map(ps.map((p) => [p.id, p]));
          list.forEach((p) => m.set(p.id, p));
          return [...m.values()];
        });
        past.current = [];
        future.current = [];
        setCur(list[0]);
        setLastId(list[0].id);
      }
      return list.length;
    },
    [],
  );

  useEffect(() => {
    if (cur) setLastId(cur.id);
  }, [cur?.id]);

  return {
    ready,
    projects,
    cur,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    open,
    add,
    duplicate,
    remove,
    importMany,
    flush,
    saveState,
    savedAt,
    storeLabel,
  };
}
