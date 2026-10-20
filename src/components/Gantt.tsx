import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Task, ViewUnit } from '../lib/types';
import { addDays, fmtDot, isValidDate, toNum, fromNum } from '../lib/date';
import { dateToX, STATUS_LABEL, xToDate, type ProjectCalc, type TaskCalc } from '../lib/calc';
import { fmt1, fmt2, NumField, won } from './ui';

export const COL_W: Record<ViewUnit, number> = { month: 84, week: 48, d20: 92 };

interface Col {
  key: string;
  label: string;
  w: number;
}

type DragState = { id: string; mode: 'move' | 'start' | 'end'; x0: number; s0: string; e0: string; s: string; e: string } | null;

export function Gantt({
  p,
  c,
  update,
  selected,
  onSelect,
  onOpenDetail,
  cols,
  compact,
}: {
  p: Project;
  c: ProjectCalc;
  update: (fn: (d: Project) => void, key?: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  cols: 'full' | 'simple';
  compact: boolean; // 모바일: 번호·공종명만 고정
}) {
  const periods = c.periods.map((x) => x.period);
  const costMode = p.weightMode === 'cost';

  const leftCols: Col[] = useMemo(() => {
    if (compact) return [{ key: 'no', label: 'No', w: 40 }, { key: 'name', label: '공종명', w: 150 }];
    const base: Col[] = [
      { key: 'no', label: 'No', w: 46 },
      { key: 'name', label: '공종명', w: 220 },
      ...(costMode ? [{ key: 'cost', label: '공사비(원)', w: 118 }] : []),
      { key: 'weight', label: '보할(%)', w: 70 },
    ];
    if (cols === 'full') base.push({ key: 'start', label: '계획 시작', w: 116 }, { key: 'end', label: '계획 종료', w: 116 });
    base.push({ key: 'plan', label: '예정(%)', w: 60 }, { key: 'act', label: '실적(%)', w: 66 });
    if (cols === 'full') base.push({ key: 'status', label: '상태', w: 62 }, { key: 'note', label: '비고', w: 130 });
    return base;
  }, [cols, compact, costMode]);
  const leftW = leftCols.reduce((s, x) => s + x.w, 0);
  const scroller = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // 기간이 적으면 화면 폭을 채우도록 칸을 넓힌다(최대 4배)
  const minW = COL_W[p.view];
  const colW = periods.length ? Math.min(minW * 4, Math.max(minW, Math.floor((boxW - leftW - 2) / periods.length))) : minW;
  const tlW = Math.max(periods.length * colW, 200);

  const [drag, setDrag] = useState<DragState>(null);
  const [tip, setTip] = useState<{ x: number; y: number; r: TaskCalc } | null>(null);

  const setTask = (id: string, patch: Partial<Task>, key?: string) =>
    update((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return;
      Object.assign(t, patch);
      if (patch.cost !== undefined && d.weightMode === 'cost') applyCost(d);
    }, key);

  const baseX = isValidDate(p.info.baseDate) ? dateToX(addDays(p.info.baseDate, 1), periods, colW) : -1;

  // 상단 머리글: 그룹(연도·월) 묶음
  const groups: { label: string; n: number }[] = [];
  for (const pr of periods) {
    const g = groups[groups.length - 1];
    if (g && g.label === pr.group) g.n++;
    else groups.push({ label: pr.group, n: 1 });
  }

  const onBarDown = (e: React.PointerEvent, t: Task) => {
    if (e.pointerType === 'touch') return; // 터치는 스크롤 우선, 일정은 표·상세에서 수정
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const off = e.clientX - rect.left;
    const mode = off < 7 ? 'start' : off > rect.width - 7 ? 'end' : 'move';
    el.setPointerCapture(e.pointerId);
    setDrag({ id: t.id, mode, x0: e.clientX, s0: t.start, e0: t.end, s: t.start, e: t.end });
    e.preventDefault();
  };
  const onBarMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (drag.mode === 'move') {
      const nx = dateToX(drag.s0, periods, colW) + dx;
      const ns = xToDate(Math.max(0, nx + 1), periods, colW);
      const delta = toNum(ns) - toNum(drag.s0);
      setDrag({ ...drag, s: fromNum(toNum(drag.s0) + delta), e: fromNum(toNum(drag.e0) + delta) });
    } else if (drag.mode === 'start') {
      const nx = dateToX(drag.s0, periods, colW) + dx;
      let ns = xToDate(Math.max(0, nx + 1), periods, colW);
      if (ns > drag.e0) ns = drag.e0;
      setDrag({ ...drag, s: ns });
    } else {
      const nx = dateToX(addDays(drag.e0, 1), periods, colW) + dx;
      let ne = xToDate(Math.max(0, nx - 1), periods, colW);
      if (ne < drag.s0) ne = drag.s0;
      setDrag({ ...drag, e: ne });
    }
  };
  const onBarUp = () => {
    if (!drag) return;
    if (drag.s !== drag.s0 || drag.e !== drag.e0) setTask(drag.id, { start: drag.s, end: drag.e, manual: true });
    setDrag(null);
  };

  const fillColor = (r: TaskCalc) => (r.status === 'done' ? 'var(--done)' : r.status === 'late' ? 'var(--late)' : 'var(--act)');

  const renderLeftCell = (col: Col, r: TaskCalc) => {
    const t = r.node.task;
    const leaf = r.node.isLeaf;
    switch (col.key) {
      case 'no':
        return (
          <button className="num w-full text-center text-[12px] text-mute hover:text-ink" onClick={() => onOpenDetail(t.id)} title="상세 편집">
            {r.node.num}
          </button>
        );
      case 'name':
        return (
          <div className="flex w-full min-w-0 items-center" style={{ paddingLeft: r.node.depth * 14 }}>
            {t.color && <span className="mr-1 h-2.5 w-2.5 flex-none rounded-sm" style={{ background: t.color }} />}
            {compact ? (
              <span className="truncate px-1 text-[13px]" title={t.name}>
                {t.name || '(이름 없음)'}
              </span>
            ) : (
              <input
                id={`name-${t.id}`}
                className="cell-inp"
                value={t.name}
                placeholder="공종명"
                onChange={(e) => setTask(t.id, { name: e.target.value }, `name-${t.id}`)}
              />
            )}
          </div>
        );
      case 'cost':
        return leaf ? (
          <NumField id={`cost-${t.id}`} ariaLabel="공사비" value={t.cost} thousands min={0} onChange={(v) => setTask(t.id, { cost: v }, `cost-${t.id}`)} />
        ) : (
          <span className="num w-full px-1 text-right text-[12.5px]">{won(r.node.leaves.reduce((s, x) => s + (x.cost || 0), 0))}</span>
        );
      case 'weight':
        return leaf && !costMode ? (
          <NumField id={`w-${t.id}`} ariaLabel="보할" value={t.weight} min={0} max={100} onChange={(v) => setTask(t.id, { weight: v }, `w-${t.id}`)} />
        ) : (
          <span className="num w-full px-1 text-right text-[12.5px]">{fmt2(r.node.weight)}</span>
        );
      case 'start':
      case 'end': {
        const v = col.key === 'start' ? r.node.start : r.node.end;
        return leaf ? (
          <input
            type="date"
            className="cell-inp num"
            value={v}
            onChange={(e) => {
              const nv = e.target.value;
              if (!isValidDate(nv)) return;
              if (col.key === 'start') setTask(t.id, { start: nv, end: nv > t.end ? nv : t.end, manual: true });
              else setTask(t.id, { end: nv, start: nv < t.start ? nv : t.start, manual: true });
            }}
          />
        ) : (
          <span className="num px-1 text-[12.5px] text-ink2">{fmtDot(v)}</span>
        );
      }
      case 'plan':
        return <span className="num w-full px-1 text-right text-[12.5px]">{fmt1(r.planned)}</span>;
      case 'act':
        return leaf ? (
          <NumField id={`a-${t.id}`} ariaLabel="실적" value={t.actual} min={0} max={100} digits={1} onChange={(v) => setTask(t.id, { actual: v }, `a-${t.id}`)} />
        ) : (
          <span className="num w-full px-1 text-right text-[12.5px]">{fmt1(r.actual)}</span>
        );
      case 'status':
        return <span className={`pill st-${r.status} mx-auto`}>{STATUS_LABEL[r.status]}</span>;
      case 'note':
        return <input className="cell-inp text-[12.5px]" value={t.note} placeholder="" onChange={(e) => setTask(t.id, { note: e.target.value }, `note-${t.id}`)} />;
    }
    return null;
  };

  return (
    <div className="relative">
      <div className="gantt" ref={scroller}>
        <div style={{ width: leftW + tlW }}>
          {/* 머리글 */}
          <div className="g-head" style={{ height: 52 }}>
            <div className="g-left" style={{ width: leftW, height: 52 }}>
              {leftCols.map((col) => (
                <div key={col.key} className="g-hcell h-full font-semibold" style={{ width: col.w }}>
                  {col.label}
                </div>
              ))}
            </div>
            <div className="g-tl" style={{ width: tlW }}>
              <div className="flex" style={{ height: 26, borderBottom: '1px solid color-mix(in srgb, var(--head-ink) 18%, transparent)' }}>
                {groups.map((g, i) => (
                  <div key={i} className="g-hcell font-semibold" style={{ width: g.n * colW }}>
                    {g.label}
                  </div>
                ))}
              </div>
              <div className="flex" style={{ height: 26 }}>
                {periods.map((pr) => (
                  <div key={pr.key} className="g-hcell num text-[11px]" style={{ width: colW }} title={`${fmtDot(pr.start)} ~ ${fmtDot(pr.end)} (${pr.days}일)`}>
                    {pr.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 공종 행 */}
          {c.rows.map((r) => {
            const t = r.node.task;
            const leaf = r.node.isLeaf;
            const dragging = drag && drag.id === t.id;
            const s = dragging ? drag.s : r.node.start;
            const e = dragging ? drag.e : r.node.end;
            const valid = isValidDate(s) && isValidDate(e);
            const x1 = valid ? dateToX(s, periods, colW) : 0;
            const x2 = valid ? dateToX(addDays(e, 1), periods, colW) : 0;
            const hasActDates = isValidDate(t.actualStart) && leaf;
            const ax1 = hasActDates ? dateToX(t.actualStart, periods, colW) : 0;
            const actEnd = isValidDate(t.actualEnd) ? t.actualEnd : p.info.baseDate;
            const ax2 = hasActDates && actEnd >= t.actualStart ? dateToX(addDays(actEnd, 1), periods, colW) : ax1;
            const planColor = t.color || 'var(--plan)';
            return (
              <div key={t.id} className={`g-row ${selected === t.id ? 'sel' : ''} ${leaf ? '' : 'parent'}`} onMouseDown={() => onSelect(t.id)} onFocus={() => onSelect(t.id)}>
                <div className="g-left" style={{ width: leftW }}>
                  {leftCols.map((col) => (
                    <div key={col.key} className="flex h-full items-center overflow-hidden px-0.5" style={{ width: col.w }}>
                      {renderLeftCell(col, r)}
                    </div>
                  ))}
                </div>
                <div
                  className="g-tl"
                  style={{
                    width: tlW,
                    backgroundImage: 'linear-gradient(to right, var(--line2) 1px, transparent 1px)',
                    backgroundSize: `${colW}px 100%`,
                  }}
                >
                  {baseX >= 0 && <div className="base-line" style={{ left: baseX - 1 }} />}
                  {valid &&
                    (leaf ? (
                      <div
                        className={`bar bar-plan ${'drag'}`}
                        style={{
                          left: x1,
                          width: Math.max(3, x2 - x1),
                          top: hasActDates ? 5 : 9,
                          height: hasActDates ? 13 : 17,
                          borderColor: planColor,
                          background: t.color ? `color-mix(in srgb, ${t.color} 24%, var(--panel))` : undefined,
                          touchAction: 'pan-x pan-y',
                        }}
                        onPointerDown={(ev) => onBarDown(ev, t)}
                        onPointerMove={onBarMove}
                        onPointerUp={onBarUp}
                        onPointerCancel={() => setDrag(null)}
                        onMouseEnter={(ev) => setTip({ x: ev.clientX, y: ev.clientY, r })}
                        onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, r })}
                        onMouseLeave={() => setTip(null)}
                      >
                        {/* 실제 착수일이 없으면 계획 막대 안에 달성률만 표시 (날짜를 임의로 만들지 않음) */}
                        {!hasActDates && r.actual > 0 && <div className="bar-fill" style={{ width: `${r.actual}%`, background: fillColor(r) }} />}
                        <span className="handle" style={{ left: 0 }} />
                        <span className="handle" style={{ right: 0 }} />
                      </div>
                    ) : (
                      <div
                        className="bar bar-group"
                        style={{ left: x1, width: Math.max(3, x2 - x1), top: 15 }}
                        onMouseEnter={(ev) => setTip({ x: ev.clientX, y: ev.clientY, r })}
                        onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, r })}
                        onMouseLeave={() => setTip(null)}
                      >
                        <div className="absolute inset-y-0 left-0" style={{ width: `${r.actual}%`, background: fillColor(r) }} />
                      </div>
                    ))}
                  {hasActDates && (
                    <div className="bar" style={{ left: ax1, width: Math.max(3, ax2 - ax1), top: 21, height: 9, background: fillColor(r), opacity: 0.95 }} title={`실제 수행: ${fmtDot(t.actualStart)} ~ ${t.actualEnd ? fmtDot(t.actualEnd) : '진행 중'}`} />
                  )}
                  {valid && (
                    <span className="num pointer-events-none absolute text-[10.5px] text-ink2" style={{ left: x2 + 4, top: 10 }}>
                      {r.actual > 0 ? `${fmt1(r.actual)}%` : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {c.rows.length === 0 && (
            <div className="g-row">
              <div className="g-left px-3 text-[13px] text-mute" style={{ width: leftW }}>
                공종이 없습니다. [공정표 자동 생성] 또는 [공종 추가]를 누르세요.
              </div>
            </div>
          )}

          {/* 하단 누계 */}
          <div className="g-foot">
            {(
              [
                ['기간 예정', (i: number) => fmt1(c.periods[i].planDelta)],
                ['예정 누계', (i: number) => fmt1(c.periods[i].planCum)],
                ['기간 실적', (i: number) => (c.periods[i].actDelta == null ? '–' : fmt1(c.periods[i].actDelta!))],
                ['실적 누계', (i: number) => (c.periods[i].actCum == null ? '–' : fmt1(c.periods[i].actCum!))],
              ] as const
            ).map(([label, val], ri) => (
              <div key={label} className="g-row">
                <div className="g-left justify-between px-2 text-[12px] font-semibold" style={{ width: leftW }}>
                  <span style={{ color: ri < 2 ? 'var(--plan)' : 'var(--act)' }}>{label} (%)</span>
                  {ri === 0 && !compact && (
                    <span className={`num text-[12px] ${Math.abs(c.weightTotal - 100) > 0.005 ? 'text-late' : 'text-ink2'}`}>보할 합계 {fmt2(c.weightTotal)}%</span>
                  )}
                  {ri === 1 && !compact && <span className="num text-[12px] text-ink2">기준일 {fmt1(c.planned)}%</span>}
                  {ri === 3 && !compact && <span className="num text-[12px] text-ink2">현재 {fmt1(c.actual)}%</span>}
                </div>
                <div className="flex" style={{ width: tlW }}>
                  {periods.map((pr, i) => (
                    <div key={pr.key} className="g-fcell num" style={{ width: colW, color: ri % 2 ? 'var(--ink)' : 'var(--ink2)', fontWeight: ri % 2 ? 600 : 400 }}>
                      {val(i)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {tip && !drag && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 290), top: tip.y + 16 }}>
          <div className="font-semibold">
            {tip.r.node.num}. {tip.r.node.task.name}
          </div>
          <div className="num">
            계획 {fmtDot(tip.r.node.start)} ~ {fmtDot(tip.r.node.end)}
          </div>
          {tip.r.node.isLeaf && tip.r.node.task.actualStart && (
            <div className="num">
              실제 {fmtDot(tip.r.node.task.actualStart)} ~ {tip.r.node.task.actualEnd ? fmtDot(tip.r.node.task.actualEnd) : '진행 중'}
            </div>
          )}
          <div className="num">
            보할 {fmt2(tip.r.node.weight)}% · 예정 {fmt1(tip.r.planned)}% · 실적 {fmt1(tip.r.actual)}%
          </div>
          <div>상태: {STATUS_LABEL[tip.r.status]}</div>
          {tip.r.node.isLeaf && <div style={{ opacity: 0.7 }}>막대 끌기: 이동 · 양 끝: 기간 조정</div>}
        </div>
      )}
    </div>
  );
}

/** 공사비 산정 방식: 보할 = 공종 공사비 ÷ 전체 공사비 × 100 */
export function applyCost(d: Project) {
  const ids = new Set(d.tasks.map((t) => t.parentId).filter(Boolean));
  const leaves = d.tasks.filter((t) => !ids.has(t.id));
  const total = leaves.reduce((s, t) => s + (t.cost || 0), 0);
  for (const t of leaves) t.weight = total > 0 ? Math.round(((t.cost || 0) / total) * 1e6) / 1e4 : 0;
  if (total > 0 && leaves.every((t) => t.cost > 0)) d.weightProvisional = false;
}
