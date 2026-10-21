import { useMemo, useRef, useState } from 'react';
import type { Project, TemplateRow, WorkKind } from '../lib/types';
import { addDays, fmtDot, isValidDate, toNum } from '../lib/date';
import { buildPeriods, clamp, plannedPct, r2, type ProjectCalc, WorkCalendar } from '../lib/calc';
import { DEFAULT_TEMPLATE, generateTasks, newProject, uid } from '../lib/schedule';
import { phaseLabel } from '../lib/phases';
import { Confirm, Field, fmt1, fmt2, Modal, NumField, won } from './ui';

type Upd = (fn: (d: Project) => void, key?: string) => void;

const SWATCH = ['', '#2c6bd3', '#0f8b8d', '#7a5bd6', '#c2410c', '#a16207', '#be185d', '#475569'];

// ───────────────── 공종 상세 ─────────────────
export function TaskDetail({ p, c, id, update, onClose, onDelete }: { p: Project; c: ProjectCalc; id: string; update: Upd; onClose: () => void; onDelete?: () => void }) {
  const r = c.byId.get(id);
  if (!r) return null;
  const t = r.node.task;
  const leaf = r.node.isLeaf;
  const set = (patch: Partial<typeof t>, key?: string) =>
    update((d) => {
      const x = d.tasks.find((y) => y.id === id);
      if (x) Object.assign(x, patch);
    }, key);

  return (
    <Modal
      title={`공종 상세 · ${r.node.num} ${t.name}`}
      onClose={onClose}
      wide
      footer={
        onDelete ? (
          <>
            <button className="btn btn-danger mr-auto" onClick={onDelete}>
              공종 삭제{leaf ? '' : ' (하위 포함)'}
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              완료
            </button>
          </>
        ) : undefined
      }
    >
      {onDelete && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded border border-line bg-sunk px-3 py-2 text-[12.5px] text-ink2">
          <span>
            보할 {fmt2(r.node.weight)}% · {fmtDot(r.node.start)} ~ {fmtDot(r.node.end)}
          </span>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>
            이 공종 삭제{leaf ? '' : ' (하위 포함)'}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="공종명" htmlFor="d-name" className="col-span-2">
          <input id="d-name" className="inp" value={t.name} onChange={(e) => set({ name: e.target.value }, 'd-name')} />
        </Field>
        <Field label="비고(표 표시)" htmlFor="d-note" className="col-span-2">
          <input id="d-note" className="inp" value={t.note} onChange={(e) => set({ note: e.target.value }, 'd-note')} />
        </Field>
        {leaf ? (
          <>
            <Field label="계획 시작일" htmlFor="d-s">
              <input id="d-s" type="date" className="inp num" value={t.start} onChange={(e) => isValidDate(e.target.value) && set({ start: e.target.value, end: e.target.value > t.end ? e.target.value : t.end, manual: true })} />
            </Field>
            <Field label="계획 종료일" htmlFor="d-e">
              <input id="d-e" type="date" className="inp num" value={t.end} onChange={(e) => isValidDate(e.target.value) && set({ end: e.target.value, start: e.target.value < t.start ? e.target.value : t.start, manual: true })} />
            </Field>
            <Field label={p.weightMode === 'cost' ? '보할(%) — 공사비로 자동 산정' : '보할(%)'} htmlFor="d-w">
              <NumField id="d-w" className="inp num text-right" value={t.weight} min={0} max={100} readOnly={p.weightMode === 'cost'} onChange={(v) => set({ weight: v }, 'd-w')} />
            </Field>
            <Field label="공종 공사비(원)" htmlFor="d-cost">
              <NumField
                id="d-cost"
                className="inp num text-right"
                value={t.cost}
                thousands
                min={0}
                onChange={(v) =>
                  update((d) => {
                    const x = d.tasks.find((y) => y.id === id)!;
                    x.cost = v;
                    if (d.weightMode === 'cost') {
                      const ids = new Set(d.tasks.map((q) => q.parentId).filter(Boolean));
                      const leaves = d.tasks.filter((q) => !ids.has(q.id));
                      const tot = leaves.reduce((s, q) => s + (q.cost || 0), 0);
                      leaves.forEach((q) => (q.weight = tot > 0 ? Math.round(((q.cost || 0) / tot) * 1e6) / 1e4 : 0));
                    }
                  }, 'd-cost')
                }
              />
            </Field>
            <Field label="실제공정률(%)" htmlFor="d-a">
              <NumField id="d-a" className="inp num text-right" value={t.actual} min={0} max={100} digits={1} onChange={(v) => set({ actual: v }, 'd-a')} />
            </Field>
            <Field label="실제 착수일" htmlFor="d-as">
              <input id="d-as" type="date" className="inp num" value={t.actualStart} onChange={(e) => set({ actualStart: e.target.value })} />
            </Field>
            <Field label="실제 완료일" htmlFor="d-ae">
              <input id="d-ae" type="date" className="inp num" value={t.actualEnd} min={t.actualStart || undefined} onChange={(e) => set({ actualEnd: e.target.value })} />
            </Field>
            <div className="flex items-end">
              {(t.actualStart || t.actualEnd) && (
                <button className="btn btn-sm" onClick={() => set({ actualStart: '', actualEnd: '' })}>
                  실제 일자 지우기
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="col-span-2 text-[13px] text-ink2 md:col-span-4">
            상위 공종입니다. 기간·보할·공정률은 하위 공종 {r.node.leaves.length}개에서 자동 집계됩니다 (보할 {fmt2(r.node.weight)}%, 예정 {fmt1(r.planned)}%, 실적 {fmt1(r.actual)}%).
          </div>
        )}
        <Field label="막대 색상" className="col-span-2 md:col-span-4">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCH.map((s) => (
              <button
                key={s || 'none'}
                aria-label={s ? `색상 ${s}` : '기본 색상'}
                aria-pressed={t.color === s}
                onClick={() => set({ color: s })}
                className="h-7 w-7 rounded border"
                style={{ background: s || 'var(--plan-soft)', borderColor: t.color === s ? 'var(--ink)' : 'var(--line)', borderWidth: t.color === s ? 2 : 1 }}
              >
                {!s && <span className="text-[10px] text-plan">기본</span>}
              </button>
            ))}
            <input type="color" aria-label="직접 선택" value={t.color || '#2c6bd3'} onChange={(e) => set({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-line bg-panel" />
          </div>
        </Field>
        <Field label="메모" htmlFor="d-memo" className="col-span-2 md:col-span-4">
          <textarea id="d-memo" className="inp" rows={3} value={t.memo} onChange={(e) => set({ memo: e.target.value }, 'd-memo')} />
        </Field>
        {leaf && t.manual && (
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink2 md:col-span-4">
            <span className="pill st-ok">직접 수정한 일정</span> 공사기간 변경 시 자동 재계산에서 보호됩니다.
            <button className="btn btn-sm" onClick={() => set({ manual: false })}>
              자동 재계산 대상으로 변경
            </button>
          </div>
        )}
      </div>
      {leaf && <PlanCurveEditor p={p} id={id} update={update} />}
    </Modal>
  );
}

/** 공종별 기간 계획 진도율(수동). 현재 표시 단위의 구간별 계획 %를 입력 → 누적점으로 저장 */
function PlanCurveEditor({ p, id, update }: { p: Project; id: string; update: Upd }) {
  const t = p.tasks.find((x) => x.id === id)!;
  const cal = useMemo(() => new WorkCalendar(p.calendar, t.start || p.info.start, t.end || p.info.end), [p.calendar, t.start, t.end, p.info.start, p.info.end]);
  if (!isValidDate(t.start) || !isValidDate(t.end)) return null;
  const periods = buildPeriods(p.view, p.info.start, t.start, t.end);
  const cums = periods.map((pr) => plannedPct(t, pr.end, cal));
  const deltas = cums.map((v, i) => v - (i ? cums[i - 1] : 0));
  const on = !!t.planCurve?.length;
  const write = (newDeltas: number[]) =>
    update((d) => {
      const x = d.tasks.find((y) => y.id === id)!;
      let acc = 0;
      const pts = [];
      for (let i = 0; i < periods.length - 1; i++) {
        acc = clamp(acc + newDeltas[i]);
        pts.push({ date: periods[i].end, cum: r2(acc) });
      }
      x.planCurve = pts.length ? pts : null;
    }, `curve-${id}`);
  const sumExceptLast = deltas.slice(0, -1).reduce((s, v) => s + v, 0);
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="text-[13.5px] font-semibold">기간별 계획 진도율</span>
        <div className="seg">
          <button aria-pressed={!on} onClick={() => update((d) => void (d.tasks.find((y) => y.id === id)!.planCurve = null))}>
            자동(보할 배분 기준)
          </button>
          <button aria-pressed={on} onClick={() => write(deltas)}>
            수동 설정
          </button>
        </div>
        <span className="text-[12px] text-mute">구간은 현재 공정표 단위({p.view === 'month' ? '월' : p.view === 'week' ? '주' : '20일'})로 표시됩니다.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>구간</th>
              <th className="text-right">기간 계획(%)</th>
              <th className="text-right">누계(%)</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((pr, i) => (
              <tr key={pr.key}>
                <td className="num text-[12.5px]">
                  {fmtDot(pr.start)} ~ {fmtDot(pr.end)}
                </td>
                <td style={{ width: 130 }}>
                  {on && i < periods.length - 1 ? (
                    <NumField className="inp num text-right" value={r2(deltas[i])} min={0} max={100} onChange={(v) => write(deltas.map((x, j) => (j === i ? v : x)))} />
                  ) : (
                    <div className="num px-2 text-right">{fmt2(deltas[i])}</div>
                  )}
                </td>
                <td className="num text-right">{fmt2(cums[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {on && sumExceptLast > 100 && <div className="mt-2 text-[12.5px] text-late">앞 구간 합계가 100%를 넘습니다. 누계는 100%에서 멈춥니다.</div>}
      {on && <div className="mt-1 text-[12px] text-mute">마지막 구간은 완료일까지 남은 진도(100%−앞 구간 합계)로 자동 계산됩니다.</div>}
    </div>
  );
}

// ───────────────── 프로젝트 목록 ─────────────────
export function ProjectList({
  projects,
  curId,
  onOpen,
  onDuplicate,
  onRemove,
  onNew,
  onExportAll,
  onExportCur,
  onImport,
  onClose,
}: {
  projects: Project[];
  curId: string;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onNew: () => void;
  onExportAll: () => void;
  onExportCur: () => void;
  onImport: (f: File) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [del, setDel] = useState<Project | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // 최근 수정순, 같은 장기계속공사 묶음은 총차·1차·2차 순으로 붙여서
  const filtered = projects.filter((p) => !q || `${p.info.name} ${p.info.client} ${p.info.location} ${phaseLabel(p)}`.toLowerCase().includes(q.toLowerCase()));
  const groupLatest = new Map<string, string>();
  for (const p of filtered) if (p.contract) groupLatest.set(p.contract.groupId, [groupLatest.get(p.contract.groupId) || '', p.updatedAt].sort()[1]);
  const keyOf = (p: Project) => (p.contract ? groupLatest.get(p.contract.groupId)! : p.updatedAt);
  const list = filtered.sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== kb) return ka < kb ? 1 : -1;
    if (a.contract && b.contract && a.contract.groupId === b.contract.groupId) return a.contract.no - b.contract.no;
    return (a.contract?.groupId || a.id) < (b.contract?.groupId || b.id) ? -1 : 1;
  });
  return (
    <Modal
      title="프로젝트 관리"
      onClose={onClose}
      wide
      footer={
        <>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <button className="btn" onClick={() => file.current?.click()}>
            JSON 복원
          </button>
          <button className="btn" onClick={onExportCur}>
            현재 프로젝트 백업
          </button>
          <button className="btn" onClick={onExportAll}>
            전체 백업(JSON)
          </button>
          <button className="btn btn-primary" onClick={onNew}>
            신규 프로젝트
          </button>
        </>
      }
    >
      <input className="inp mb-3" placeholder="공사명·발주처·위치 검색" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="프로젝트 검색" />
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>공사명</th>
              <th>발주처</th>
              <th>공사기간</th>
              <th>최종 수정</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} style={p.id === curId ? { background: 'var(--sel)' } : undefined}>
                <td>
                  <button className="text-left font-semibold hover:underline" onClick={() => onOpen(p.id)}>
                    {p.contract && <span className="mr-1.5 rounded bg-head px-1.5 py-0.5 text-[11px] font-semibold text-headInk">{phaseLabel(p)}</span>}
                    {p.info.name || '(공사명 없음)'}
                  </button>
                </td>
                <td className="text-ink2">{p.info.client}</td>
                <td className="num whitespace-nowrap text-[12.5px]">
                  {fmtDot(p.info.start)} ~ {fmtDot(p.info.end)}
                </td>
                <td className="num whitespace-nowrap text-[12px] text-mute">{p.updatedAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn btn-sm" onClick={() => onOpen(p.id)}>
                    열기
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => onDuplicate(p.id)}>
                    복제
                  </button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => setDel(p)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-mute">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-mute">모든 변경은 자동 저장됩니다. 다른 기기로 옮기거나 보관할 때는 JSON 백업을 사용하세요.</p>
      {del && <Confirm title="프로젝트 삭제" danger okLabel="삭제" message={`'${del.info.name}' 프로젝트를 삭제합니다. 되돌릴 수 없습니다.`} onOk={() => onRemove(del.id)} onClose={() => setDel(null)} />}
    </Modal>
  );
}

// ───────────────── 신규 프로젝트 ─────────────────
export function NewProjectDialog({ onCreate, onClose }: { onCreate: (p: Project) => void; onClose: () => void }) {
  const base = useMemo(() => newProject(), []);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [kind, setKind] = useState<WorkKind>('elec');
  const [start, setStart] = useState(base.info.start);
  const [end, setEnd] = useState(base.info.end);
  const [gen, setGen] = useState(true);
  const ok = name.trim() && isValidDate(start) && isValidDate(end) && end >= start;
  const days = ok ? toNum(end) - toNum(start) + 1 : 0;
  return (
    <Modal
      title="신규 프로젝트"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn btn-primary"
            disabled={!ok}
            onClick={() => {
              const p = newProject({ name: name.trim(), client, kind, start, end, baseDate: start });
              if (gen) {
                p.tasks = generateTasks(p);
                p.scheduleBase = { start, end };
              }
              onCreate(p);
            }}
          >
            만들기
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="공사명 *" htmlFor="n-name" className="col-span-2">
          <input id="n-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="발주처" htmlFor="n-client" className="col-span-2">
          <input id="n-client" className="inp" value={client} onChange={(e) => setClient(e.target.value)} />
        </Field>
        <Field label="착공일" htmlFor="n-s">
          <input id="n-s" type="date" className="inp num" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="준공일" htmlFor="n-e">
          <input id="n-e" type="date" className="inp num" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="공사 구분" className="col-span-2">
          <div className="seg">
            {(
              [
                ['elec', '전기'],
                ['comm', '정보통신'],
                ['both', '전기+통신'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={gen} onChange={(e) => setGen(e.target.checked)} /> 기본 공종으로 예정공정표 자동 생성
        </label>
        <div className="col-span-2 text-[12.5px] text-ink2">{ok ? `총 공사일수 ${days}일` : '공사명과 착공·준공일을 입력하세요 (준공일 ≥ 착공일).'}</div>
      </div>
    </Modal>
  );
}

// ───────────────── 생성 비율 설정 ─────────────────
export function TemplateDialog({ p, update, onClose }: { p: Project; update: Upd; onClose: () => void }) {
  const [rows, setRows] = useState<TemplateRow[]>(() => (p.template?.length ? p.template : DEFAULT_TEMPLATE).map((r) => ({ ...r })));
  const groups = p.info.kind === 'both' ? (['elec', 'comm'] as const) : ([p.info.kind] as const);
  const setRow = (key: string, patch: Partial<TemplateRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Modal
      title="자동 생성 비율 설정"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => setRows(DEFAULT_TEMPLATE.map((r) => ({ ...r })))}>
            기본값 복원
          </button>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              update((d) => void (d.template = rows));
              onClose();
            }}
          >
            저장
          </button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink2">착수·완료 시점은 공사기간 대비 %입니다. 시점이 겹치는 공종은 동시 시공으로 배치됩니다. 보할은 그룹 안에서 비례 환산되며, 생성 후 임시값으로 표시됩니다.</p>
      {groups.map((g) => {
        const rs = rows.filter((r) => r.group === g);
        const sum = rs.reduce((s, r) => s + r.weight, 0);
        return (
          <div key={g} className="mb-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[13.5px] font-semibold">{g === 'elec' ? '전기공사' : '정보통신공사'}</span>
              <span className={`num text-[12.5px] ${Math.abs(sum - 100) > 0.005 ? 'text-warn' : 'text-mute'}`}>보할 합계 {fmt2(sum)} (생성 시 100으로 환산)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>공종명</th>
                    <th className="text-right">착수(%)</th>
                    <th className="text-right">완료(%)</th>
                    <th className="text-right">보할</th>
                    <th>기간 막대</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.key}>
                      <td style={{ minWidth: 200 }}>
                        <input className="inp" value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                      </td>
                      <td style={{ width: 80 }}>
                        <NumField className="inp num text-right" value={r.startPct} min={0} max={100} onChange={(v) => setRow(r.key, { startPct: v })} />
                      </td>
                      <td style={{ width: 80 }}>
                        <NumField className="inp num text-right" value={r.endPct} min={0} max={100} onChange={(v) => setRow(r.key, { endPct: v })} />
                      </td>
                      <td style={{ width: 80 }}>
                        <NumField className="inp num text-right" value={r.weight} min={0} onChange={(v) => setRow(r.key, { weight: v })} />
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <div className="relative h-3 rounded bg-sunk">
                          <div className="absolute inset-y-0 rounded" style={{ left: `${r.startPct}%`, width: `${Math.max(1, r.endPct - r.startPct)}%`, background: 'var(--plan)' }} />
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-sm mt-2" onClick={() => setRows((x) => [...x, { key: uid('k'), group: g, name: '새 공종', startPct: 0, endPct: 10, weight: 0, pred: '' }])}>
              공종 추가
            </button>
          </div>
        );
      })}
    </Modal>
  );
}

export { addDays, won };
