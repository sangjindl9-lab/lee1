import { useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/types';
import { addDays, isValidDate } from '../lib/date';
import { dateToX, UNIT_LABEL, type ProjectCalc } from '../lib/calc';
import { buildForm, cellNum, periodHead } from '../lib/form';
import type { PhaseMark } from '../lib/phases';

const PHASE = '#1d4ed8';

// 제출용 예정공정표 — 관공서 제출 양식처럼 흑백 표, 상단 칸에 기간별 보할값과 굵은 예정선, 하단 칸에 실적.
const INK = '#111';
const GRID = '#222';
const HALF = 27;

export function FormSheet({ p, c, update, onOpenDetail, compact, marks = [], selected = null, onSelect }: { p: Project; c: ProjectCalc; update: (fn: (d: Project) => void, key?: string) => void; onOpenDetail: (id: string) => void; compact: boolean; marks?: PhaseMark[]; selected?: string | null; onSelect?: (id: string) => void }) {
  const f = buildForm(p, c);
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const nameW = compact ? 132 : 190;
  const wW = compact ? 50 : 60;
  const noteW = compact ? 70 : 110;
  const minCol = p.view === 'week' ? 44 : p.view === 'month' ? 58 : 84;
  const n = Math.max(1, f.periods.length);
  const colW = Math.max(minCol, Math.min(minCol * 2.4, Math.floor((boxW - nameW - wW - noteW - 4) / n)));
  const tlW = n * colW;
  const showAct = p.form.showActual;
  const fo = p.form;

  // 머리글 연도 묶음
  const groups: { label: string; n: number }[] = [];
  for (const pr of f.periods) {
    const h = periodHead(pr);
    const g = groups[groups.length - 1];
    if (g && g.label === h.top) g.n++;
    else groups.push({ label: h.top, n: 1 });
  }
  // 총차 공정표: 차수 경계(각 차수 착공일) 세로선
  const pS = f.periods.length ? f.periods[0].start : '';
  const pE = f.periods.length ? f.periods[f.periods.length - 1].end : '';
  const markXs = marks
    .filter((m) => isValidDate(m.start) && m.start > pS && m.start <= pE)
    .map((m) => ({ label: m.label, x: dateToX(m.start, f.periods, colW) }));
  const markBands = marks
    .filter((m) => isValidDate(m.start) && isValidDate(m.end) && m.end >= pS && m.start <= pE)
    .map((m) => {
      const a = dateToX(m.start < pS ? pS : m.start, f.periods, colW);
      const b = dateToX(addDays(m.end > pE ? pE : m.end, 1), f.periods, colW);
      return { label: m.label, a, b };
    });
  const MarkLines = () => (
    <>
      {markXs.map((m) => (
        <div key={m.label} className="pointer-events-none absolute inset-y-0" style={{ left: m.x - 1, borderLeft: `2px solid ${PHASE}`, opacity: 0.8 }} />
      ))}
    </>
  );
  const baseX = isValidDate(p.info.baseDate) ? dateToX(addDays(p.info.baseDate, 1), f.periods, colW) : -1;
  const cellB = `1px solid ${GRID}`;
  const sticky = (left: number, w: number, extra: React.CSSProperties = {}): React.CSSProperties => ({ position: 'sticky', left, width: w, flex: 'none', background: '#fff', zIndex: 2, ...extra });
  const vline: React.CSSProperties = { backgroundImage: `linear-gradient(to right, ${GRID} 1px, transparent 1px)`, backgroundSize: `${colW}px 100%` };

  const Row = ({ id, label, weight, depth, plan, act, start, end, actStart, actEnd, note, bold, onClick }: any) => {
    const x1 = isValidDate(start) ? dateToX(start, f.periods, colW) : 0;
    const x2 = isValidDate(end) ? dateToX(addDays(end, 1), f.periods, colW) : 0;
    const hasLine = isValidDate(start) && isValidDate(end) && x2 > x1;
    const ae = actEnd || (actStart ? p.info.baseDate : '');
    const ax1 = actStart ? dateToX(actStart, f.periods, colW) : 0;
    const ax2 = actStart && ae >= actStart ? dateToX(addDays(ae, 1), f.periods, colW) : ax1;
    return (
      <div className="flex" style={{ borderBottom: cellB, height: HALF * 2 }} key={id}>
        <div style={sticky(0, nameW, { borderRight: cellB, display: 'flex', alignItems: 'center', padding: `0 6px 0 ${8 + depth * 12}px`, background: selected === id ? '#fff3c4' : '#fff', boxShadow: selected === id ? 'inset 3px 0 0 #1d4ed8' : undefined })}>
          <button className="h-full w-full text-left leading-snug" style={{ fontSize: compact ? 12 : 13, fontWeight: bold ? 700 : 400, color: INK }} onClick={() => onSelect?.(id)} onDoubleClick={onClick} title="눌러서 선택 · 두 번 눌러 상세 편집">
            {label}
          </button>
        </div>
        <div style={sticky(nameW, wW, { borderRight: cellB, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6, fontSize: 12.5 })} className="form-num">
          {weight == null ? '' : weight.toFixed(2)}
        </div>
        <div className="relative flex-none" style={{ width: tlW, ...vline }}>
          <div className="absolute inset-x-0" style={{ top: HALF, borderTop: `1px solid #c9c9c9` }} />
          {hasLine && <div className="absolute" style={{ left: x1, width: x2 - x1, top: HALF - 2, height: 3, background: INK }} />}
          {showAct && actStart && ax2 > ax1 && <div className="absolute" style={{ left: ax1, width: ax2 - ax1, top: HALF * 2 - 9, height: 3, backgroundImage: `repeating-linear-gradient(to right, ${INK} 0 6px, transparent 6px 9px)` }} />}
          <MarkLines />
          {baseX >= 0 && <div className="absolute inset-y-0" style={{ left: baseX - 1, borderLeft: '2px dashed #c62828' }} />}
          {f.periods.map((_, i) => (
            <div key={i} className="form-num absolute text-center" style={{ left: i * colW, width: colW, top: 3, fontSize: 10.5, color: INK }}>
              {cellNum(plan[i])}
            </div>
          ))}
          {showAct &&
            f.periods.map((_, i) =>
              act[i] == null || Math.abs(act[i]) < 0.005 ? null : (
                <div key={'a' + i} className="form-num absolute text-center" style={{ left: i * colW, width: colW, top: HALF + 3, fontSize: 10.5, color: '#1b5e20', fontWeight: 600 }}>
                  {cellNum(act[i])}
                </div>
              ),
            )}
        </div>
        <div className="flex-none" style={{ width: noteW, borderLeft: cellB, fontSize: 11.5, padding: '4px 6px', color: INK, overflow: 'hidden' }}>
          {note}
        </div>
      </div>
    );
  };

  const SumRow = ({ label, a, b, bold }: { label: string; a: (number | null)[]; b: (number | null)[]; bold?: boolean }) => (
    <div className="flex" style={{ borderBottom: cellB, height: showAct ? HALF * 2 : HALF + 14 }}>
      <div style={sticky(0, nameW, { borderRight: cellB, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, letterSpacing: '0.6em' })}>{label}</div>
      <div style={sticky(nameW, wW, { borderRight: cellB, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6, fontSize: 12.5, fontWeight: 600 })} className="form-num">
        {bold ? f.weightTotal.toFixed(1) : ''}
      </div>
      <div className="relative flex-none" style={{ width: tlW, ...vline }}>
        {showAct && <div className="absolute inset-x-0" style={{ top: HALF, borderTop: `1px solid #c9c9c9` }} />}
        <MarkLines />
        {f.periods.map((_, i) => (
          <div key={i} className="form-num absolute text-center" style={{ left: i * colW, width: colW, top: showAct ? 6 : 12, fontSize: 11.5, color: INK }}>
            {a[i] == null ? '' : a[i]!.toFixed(2)}
          </div>
        ))}
        {showAct &&
          f.periods.map((_, i) => (
            <div key={'b' + i} className="form-num absolute text-center" style={{ left: i * colW, width: colW, top: HALF + 6, fontSize: 11.5, color: '#1b5e20', fontWeight: 600 }}>
              {b[i] == null ? '' : b[i]!.toFixed(2)}
            </div>
          ))}
      </div>
      <div className="flex-none" style={{ width: noteW, borderLeft: cellB }} />
    </div>
  );

  return (
    <div>
      {/* 양식 설정 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 sm:px-4">
        <input className="inp" style={{ width: 220 }} value={fo.title} onChange={(e) => update((d) => void (d.form.title = e.target.value), 'form-title')} aria-label="표 제목" title="표 제목 (예: Ⅳ. 예 정 공 정 표(변경))" />
        <div className="seg" role="group" aria-label="표시 공종">
          <button aria-pressed={fo.level === 'all'} onClick={() => update((d) => void (d.form.level = 'all'))}>
            전체 공종
          </button>
          <button aria-pressed={fo.level === 'top'} onClick={() => update((d) => void (d.form.level = 'top'))}>
            상위 공종만
          </button>
        </div>
        <div className="seg" role="group" aria-label="보할 배분">
          <button aria-pressed={p.calendar.distribution === 'month'} onClick={() => update((d) => void (d.calendar.distribution = 'month'))} title="공종이 걸친 달마다 보할을 똑같이 나눔">
            월 균등 배분
          </button>
          <button aria-pressed={p.calendar.distribution === 'workday'} onClick={() => update((d) => void (d.calendar.distribution = 'workday'))} title="작업일수에 비례해 나눔">
            작업일 비례
          </button>
        </div>
        {(
          [
            ['showActual', '실적 표시'],
            ['numbering', '번호'],
            ['showSign', '결재란'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" checked={fo[k]} onChange={(e) => update((d) => void ((d.form as any)[k] = e.target.checked))} /> {l}
          </label>
        ))}
      </div>

      <div ref={box} className="overflow-x-auto" style={{ background: '#e9e9e6' }}>
        <div className="form-paper mx-auto my-3" style={{ width: Math.max(nameW + wW + tlW + noteW + 2 + 40, 0), background: '#fff', color: INK, padding: '22px 20px 18px', boxShadow: '0 1px 4px rgba(0,0,0,.18)' }}>
          <div className="relative">
            <h3 className="text-center" style={{ fontSize: compact ? 22 : 28, fontWeight: 700, letterSpacing: '0.12em' }}>
              {fo.title}
            </h3>
            {fo.showSign && (
              <div className="absolute right-0 top-0 flex" style={{ border: cellB }}>
                {(
                  [
                    ['작성', p.info.writer],
                    ['검토', p.info.reviewer],
                    ['승인', p.info.approver],
                  ] as const
                ).map(([k, v], i) => (
                  <div key={k} style={{ width: 58, borderLeft: i ? cellB : undefined, fontSize: 11 }}>
                    <div className="text-center" style={{ borderBottom: cellB, padding: '2px 0' }}>
                      {k}
                    </div>
                    <div className="flex items-end justify-center" style={{ height: 34, paddingBottom: 3 }}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1" style={{ fontSize: 13, fontWeight: 600 }}>
            <span>공사명 : {p.info.name}</span>
            <span>시공업체 : {p.info.contractor} (인)</span>
          </div>
          <div className="mt-1.5" style={{ border: `1.5px solid ${INK}`, width: nameW + wW + tlW + noteW + 1 }}>
            {markBands.length > 0 && (
              <div className="flex" style={{ borderBottom: cellB, height: 24 }}>
                <div style={sticky(0, nameW + wW, { borderRight: cellB, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 })}>차 수 구 분</div>
                <div className="relative flex-none" style={{ width: tlW }}>
                  {markBands.map((m) => (
                    <div key={m.label} className="absolute inset-y-0 flex items-center justify-center" style={{ left: m.a, width: Math.max(2, m.b - m.a), borderLeft: `2px solid ${PHASE}`, borderRight: `2px solid ${PHASE}`, color: PHASE, fontSize: 12, fontWeight: 700, background: 'rgba(29,78,216,0.06)' }}>
                      {m.b - m.a > 40 ? `${m.label} 공사` : m.label}
                    </div>
                  ))}
                </div>
                <div className="flex-none" style={{ width: noteW, borderLeft: cellB }} />
              </div>
            )}
            {/* 머리글 */}
            <div className="flex" style={{ borderBottom: cellB, height: 64 }}>
              <div style={sticky(0, nameW, { borderRight: cellB, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, letterSpacing: '1.4em', paddingLeft: '1.4em' })}>공종</div>
              <div style={sticky(nameW, wW, { borderRight: cellB, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, lineHeight: 1.25 })}>
                <span>보할</span>
                <span>(%)</span>
              </div>
              <div className="flex-none" style={{ width: tlW }}>
                <div className="flex" style={{ height: 32, borderBottom: cellB }}>
                  {groups.map((g, i) => (
                    <div key={i} className="form-num flex items-center justify-center" style={{ width: g.n * colW, borderLeft: i ? cellB : undefined, fontSize: 12.5 }}>
                      {g.label}
                    </div>
                  ))}
                </div>
                <div className="flex" style={{ height: 31 }}>
                  {f.periods.map((pr, i) => (
                    <div key={pr.key} className="form-num flex items-center justify-center text-center" style={{ width: colW, borderLeft: i ? cellB : undefined, fontSize: p.view === 'd20' ? 10.5 : 12, lineHeight: 1.1 }}>
                      {periodHead(pr).label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-none items-center justify-center" style={{ width: noteW, borderLeft: cellB, fontSize: 13, letterSpacing: '1.2em', paddingLeft: '1.2em' }}>
                비고
              </div>
            </div>
            {f.rows.map((r) => (
              <Row key={r.id} {...r} bold={r.depth === 0 && fo.level === 'all' && c.byId.get(r.id)?.node.isLeaf === false} onClick={() => onOpenDetail(r.id)} />
            ))}
            {!f.rows.length && <div className="px-4 py-6 text-center text-[13px]" style={{ color: '#666' }}>공종이 없습니다. [공정표 자동 생성]을 누르세요.</div>}
            <SumRow label="계" a={f.planSum} b={f.actSum} bold />
            <SumRow label="누계" a={f.planCum} b={f.actCum} />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2" style={{ fontSize: 11, color: '#444' }}>
            <span>
              {UNIT_LABEL[p.view]} · 보할 배분: {p.calendar.distribution === 'month' ? '월 균등' : '작업일 비례'} · 상단: 예정(━ 굵은 선, 기간별 보할값){showAct ? ' · 하단: 실적(┅ 점선, 녹색 값 — 저장된 실적 이력 기준)' : ''}
            </span>
            <span>
              {markXs.length > 0 && <span style={{ color: PHASE }}>│ 차수 경계 · </span>}
              기준일 {p.info.baseDate.replace(/-/g, '.')} <span style={{ color: '#c62828' }}>┆ 붉은 점선</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
