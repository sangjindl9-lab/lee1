// 공종 편집 연산 (추가·삭제·순서·계층). 모두 Project 초안(draft)을 직접 수정한다.
import type { Project, Task } from './types';
import { newTask } from './schedule';
import { addDays, isValidDate } from './date';

const siblings = (d: Project, parentId: string | null) => d.tasks.filter((t) => t.parentId === parentId);

function descendants(d: Project, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => d.tasks.filter((t) => t.parentId === pid).forEach((t) => (out.add(t.id), walk(t.id)));
  walk(id);
  return out;
}

/** 선택 공종 아래(같은 단계)에 새 공종 추가 */
export function addAfter(d: Project, afterId: string | null): string {
  const ref = d.tasks.find((t) => t.id === afterId);
  const start = ref && isValidDate(ref.start) ? ref.start : d.info.start;
  const end = ref && isValidDate(ref.end) ? ref.end : addDays(d.info.start, 13 > 0 ? 13 : 0);
  const t = newTask({ name: '새 공종', parentId: ref ? ref.parentId : null, start, end: end > d.info.end ? d.info.end : end, manual: true });
  if (!ref) d.tasks.push(t);
  else {
    // 참조 공종과 그 하위 공종들 뒤에 삽입
    const desc = descendants(d, ref.id);
    let idx = d.tasks.findIndex((x) => x.id === ref.id);
    while (idx + 1 < d.tasks.length && desc.has(d.tasks[idx + 1].id)) idx++;
    d.tasks.splice(idx + 1, 0, t);
  }
  return t.id;
}

/** 선택 공종의 하위 공종 생성. 첫 하위 공종은 상위의 보할·일정·실적을 이어받는다(중복 계산 방지) */
export function addChild(d: Project, parentId: string): string {
  const parent = d.tasks.find((t) => t.id === parentId)!;
  const kids = siblings(d, parentId);
  const t = newTask({ name: kids.length ? '새 하위 공종' : `${parent.name} - 1`, parentId, start: parent.start, end: parent.end, manual: true });
  if (!kids.length) {
    t.weight = parent.weight;
    t.cost = parent.cost;
    t.actual = parent.actual;
    t.actualStart = parent.actualStart;
    t.actualEnd = parent.actualEnd;
    parent.weight = 0;
    parent.cost = 0;
    for (const h of d.history) if (h.values[parent.id] != null) h.values[t.id] = h.values[parent.id];
  }
  const desc = descendants(d, parentId);
  let idx = d.tasks.findIndex((x) => x.id === parentId);
  while (idx + 1 < d.tasks.length && desc.has(d.tasks[idx + 1].id)) idx++;
  d.tasks.splice(idx + 1, 0, t);
  return t.id;
}

export function removeTask(d: Project, id: string) {
  const del = descendants(d, id);
  del.add(id);
  d.tasks = d.tasks.filter((t) => !del.has(t.id));
  for (const h of d.history) for (const k of del) delete h.values[k];
}

/** 같은 단계 안에서 위/아래로 이동 (하위 공종 묶음 유지) */
export function moveTask(d: Project, id: string, dir: -1 | 1) {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return;
  const sib = siblings(d, t.parentId);
  const i = sib.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= sib.length) return;
  const block = (tid: string) => {
    const ids = descendants(d, tid);
    ids.add(tid);
    return d.tasks.filter((x) => ids.has(x.id));
  };
  const a = block(sib[Math.min(i, j)].id);
  const b = block(sib[Math.max(i, j)].id);
  const rest = d.tasks.filter((x) => !a.includes(x) && !b.includes(x));
  const firstIdx = d.tasks.indexOf(a[0]);
  const before = d.tasks.slice(0, firstIdx).filter((x) => rest.includes(x));
  const after = rest.filter((x) => !before.includes(x));
  d.tasks = [...before, ...b, ...a, ...after];
}

/** 들여쓰기: 바로 위 형제의 하위로. 내어쓰기: 상위와 같은 단계로 */
export function indent(d: Project, id: string) {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return;
  const sib = siblings(d, t.parentId);
  const i = sib.findIndex((x) => x.id === id);
  if (i <= 0) return;
  const np = sib[i - 1];
  const npHadKids = siblings(d, np.id).length > 0;
  if (!npHadKids) {
    // 새 상위가 될 공종의 보할을 하위로 내려 이중 계산 방지
    const carry = newTask({ ...np, id: undefined as any, parentId: np.id, name: `${np.name} - 1` });
    carry.id = 't' + Math.random().toString(36).slice(2, 10);
    np.weight = 0;
    np.cost = 0;
    const idx = d.tasks.indexOf(np);
    d.tasks.splice(idx + 1, 0, carry);
    for (const h of d.history) if (h.values[np.id] != null) h.values[carry.id] = h.values[np.id];
  }
  t.parentId = np.id;
  // 배열 순서: 새 상위의 마지막 하위 뒤로
  const blockIds = descendants(d, id);
  blockIds.add(id);
  const block = d.tasks.filter((x) => blockIds.has(x.id));
  d.tasks = d.tasks.filter((x) => !blockIds.has(x.id));
  const pDesc = descendants(d, np.id);
  let idx = d.tasks.indexOf(np);
  while (idx + 1 < d.tasks.length && pDesc.has(d.tasks[idx + 1].id)) idx++;
  d.tasks.splice(idx + 1, 0, ...block);
}

export function outdent(d: Project, id: string) {
  const t = d.tasks.find((x) => x.id === id);
  if (!t || !t.parentId) return;
  const parent = d.tasks.find((x) => x.id === t.parentId)!;
  t.parentId = parent.parentId;
  const blockIds = descendants(d, id);
  blockIds.add(id);
  const block = d.tasks.filter((x) => blockIds.has(x.id));
  d.tasks = d.tasks.filter((x) => !blockIds.has(x.id));
  const pDesc = descendants(d, parent.id);
  let idx = d.tasks.indexOf(parent);
  while (idx + 1 < d.tasks.length && pDesc.has(d.tasks[idx + 1].id)) idx++;
  d.tasks.splice(idx + 1, 0, ...block);
}

export function isLeafTask(d: Project, t: Task) {
  return !d.tasks.some((x) => x.parentId === t.id);
}
