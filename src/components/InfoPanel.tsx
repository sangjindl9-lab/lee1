import { useState } from 'react';
import type { Project, WorkKind } from '../lib/types';
import { addDays, fmtDot, isValidDate, parts, todayKST, weekdayKo } from '../lib/date';
import { overallStatus, type ProjectCalc } from '../lib/calc';
import { Field, fmt1, NumField, won } from './ui';

const KIND: [WorkKind, string][] = [
  ['elec', '전기공사'],
  ['comm', '정보통신공사'],
  ['both', '전기+통신 통합공사'],
];

type Upd = (fn: (d: Project) => void, key?: string) => void;

export function InfoPanel({ p, update, onGenerate, onTemplate, open, setOpen }: { p: Project; update: Upd; onGenerate: () => void; onTemplate: () => void; open: boolean; setOpen: (v: boolean) => void }) {
  const i = p.info;
  const set = (k: keyof Project['info'], v: any) =>
    update((d) => {
      (d.info as any)[k] = v;
    }, `info-${k}`);
  const txt = (k: keyof Project['info'], label: string, cls = '') => (
    <Field label={label} htmlFor={`f-${k}`} className={cls}>
      <input id={`f-${k}`} className="inp" value={(i as any)[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const [hol, setHol] = useState('');
  const totalDays = isValidDate(i.start) && isValidDate(i.end) && i.end >= i.start ? (new Date(i.end).getTime() - new Date(i.start).getTime()) / 864e5 + 1 : 0;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button className="flex items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="h2">공사 개요</span>
          <span className="text-[12px] text-mute">{open ? '접기 ▲' : '펼치기 ▼'}</span>
        </button>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={onTemplate}>
            생성 비율 설정
          </button>
          <button className="btn btn-primary" onClick={onGenerate}>
            공정표 자동 생성
          </button>
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-line px-4 py-4 md:grid-cols-4 xl:grid-cols-6">
          {txt('name', '공사명', 'col-span-2 xl:col-span-3')}
          {txt('client', '발주처')}
          {txt('contractor', '시공사')}
          <Field label="계약금액(원)" htmlFor="f-amount">
            <NumField id="f-amount" className="inp num text-right" value={i.amount} thousands min={0} onChange={(v) => set('amount', v)} />
          </Field>
          <Field label="공사 구분" htmlFor="f-kind">
            <select id="f-kind" className="inp" value={i.kind} onChange={(e) => set('kind', e.target.value)}>
              {KIND.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="착공일" htmlFor="f-start">
            <input id="f-start" type="date" className="inp num" value={i.start} onChange={(e) => isValidDate(e.target.value) && set('start', e.target.value)} />
          </Field>
          <Field label="준공일" htmlFor="f-end">
            <input id="f-end" type="date" className="inp num" value={i.end} onChange={(e) => isValidDate(e.target.value) && set('end', e.target.value)} />
          </Field>
          <Field label="총 공사일수">
            <div className={`inp num ${totalDays <= 0 ? 'text-late' : ''}`} style={{ background: 'var(--sunk)' }}>
              {totalDays > 0 ? `${totalDays}일` : '준공일을 착공일 이후로'}
            </div>
          </Field>
          {txt('location', '공사 위치', 'col-span-2 xl:col-span-3')}
          {txt('agent', '현장대리인')}
          {txt('docNo', '문서번호')}
          {txt('writer', '작성자')}
          {txt('reviewer', '검토자')}
          {txt('approver', '승인자')}
          {i.kind === 'both' && (
            <Field label="전기 / 통신 비중(%) — 자동 생성 시">
              <div className="flex gap-1">
                <NumField className="inp num text-right" value={p.groupShare.elec} min={0} max={100} onChange={(v) => update((d) => void (d.groupShare = { elec: v, comm: Math.max(0, 100 - v) }), 'share')} />
                <NumField className="inp num text-right" value={p.groupShare.comm} min={0} max={100} onChange={(v) => update((d) => void (d.groupShare = { comm: v, elec: Math.max(0, 100 - v) }), 'share')} />
              </div>
            </Field>
          )}
          <Field label="비고" htmlFor="f-memo" className="col-span-2 md:col-span-4 xl:col-span-6">
            <textarea id="f-memo" className="inp" rows={2} value={i.memo} onChange={(e) => set('memo', e.target.value)} />
          </Field>

          <div className="col-span-2 flex flex-col gap-2 rounded border border-line bg-sunk p-3 md:col-span-4 xl:col-span-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-semibold">예정공정률 산정 기준</span>
              <div className="seg" role="group" aria-label="작업일 기준">
                <button aria-pressed={p.calendar.mode === 'calendar'} onClick={() => update((d) => void (d.calendar.mode = 'calendar'))}>
                  전체 달력일
                </button>
                <button aria-pressed={p.calendar.mode === 'weekday'} onClick={() => update((d) => void (d.calendar.mode = 'weekday'))}>
                  주말 제외
                </button>
              </div>
              <span className="text-[13px] font-semibold">보할 배분</span>
              <div className="seg" role="group" aria-label="보할 배분">
                <button aria-pressed={p.calendar.distribution === 'month'} onClick={() => update((d) => void (d.calendar.distribution = 'month'))}>
                  월 균등
                </button>
                <button aria-pressed={p.calendar.distribution === 'workday'} onClick={() => update((d) => void (d.calendar.distribution = 'workday'))}>
                  작업일 비례
                </button>
              </div>
              <span className="text-[12px] text-mute">월 균등: 공종이 걸친 달마다 보할을 똑같이 나눔(제출용 공정표 방식). 지정 휴무일은 항상 제외됩니다.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" className="inp num" style={{ width: 160 }} value={hol} onChange={(e) => setHol(e.target.value)} aria-label="휴무일" />
              <button
                className="btn btn-sm"
                disabled={!isValidDate(hol)}
                onClick={() => {
                  update((d) => {
                    if (!d.calendar.holidays.includes(hol)) d.calendar.holidays = [...d.calendar.holidays, hol].sort();
                  });
                  setHol('');
                }}
              >
                휴무일 추가
              </button>
              <button
                className="btn btn-sm"
                title="1/1, 3/1, 5/5, 6/6, 8/15, 10/3, 10/9, 12/25 — 설·추석·부처님오신날·대체공휴일은 직접 추가"
                onClick={() =>
                  update((d) => {
                    const set = new Set(d.calendar.holidays);
                    const y0 = parts(d.info.start).y;
                    const y1 = parts(d.info.end).y;
                    for (let y = y0; y <= y1; y++) for (const md of ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25']) set.add(`${y}-${md}`);
                    d.calendar.holidays = [...set].sort();
                  })
                }
              >
                양력 고정 공휴일 추가
              </button>
              {p.calendar.holidays.length > 0 && (
                <button className="btn btn-sm btn-danger" onClick={() => update((d) => void (d.calendar.holidays = []))}>
                  전체 삭제
                </button>
              )}
            </div>
            {p.calendar.holidays.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {p.calendar.holidays.map((h) => (
                  <button key={h} className="chip-btn num rounded border border-line bg-panel px-2 py-0.5 text-[12px] hover:border-late" title="삭제" onClick={() => update((d) => void (d.calendar.holidays = d.calendar.holidays.filter((x) => x !== h)))}>
                    {fmtDot(h)}({weekdayKo(h)}) ×
                  </button>
                ))}
              </div>
            )}
            <div className="text-[11.5px] text-mute">음력 공휴일(설날·추석·부처님오신날)과 대체공휴일, 선거일 등은 날짜를 직접 추가하세요.</div>
          </div>
        </div>
      )}
    </section>
  );
}

export function ScheduleBanner({ p, onRescale, onKeep, onRegenerate }: { p: Project; onRescale: (protect: boolean) => void; onKeep: () => void; onRegenerate: () => void }) {
  const b = p.scheduleBase;
  if (!b || !p.tasks.length || (b.start === p.info.start && b.end === p.info.end)) return null;
  if (!isValidDate(p.info.start) || !isValidDate(p.info.end) || p.info.end < p.info.start) return null;
  const manual = p.tasks.filter((t) => t.manual).length;
  return (
    <div className="panel flex flex-col gap-2 px-4 py-3" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }} role="alert">
      <div className="text-[13.5px]">
        <b>공사기간이 변경되었습니다.</b> 기존 {fmtDot(b.start)}~{fmtDot(b.end)} → 변경 {fmtDot(p.info.start)}~{fmtDot(p.info.end)}. 공종 일정을 새 기간에 맞게 다시 배분할까요?
        {manual > 0 && <span className="text-ink2"> (직접 수정한 공종 {manual}개)</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" onClick={() => onRescale(true)}>
          비례 재계산 (직접 수정한 일정 유지)
        </button>
        <button className="btn btn-sm" onClick={() => onRescale(false)}>
          모든 공종 비례 재계산
        </button>
        <button className="btn btn-sm" onClick={onRegenerate}>
          기본 공종으로 새로 생성
        </button>
        <button className="btn btn-sm" onClick={onKeep}>
          현재 일정 유지
        </button>
      </div>
    </div>
  );
}

export function SummaryStrip({ p, c, update }: { p: Project; c: ProjectCalc; update: Upd }) {
  const st = overallStatus(c.deviation);
  const cell = 'flex min-w-0 flex-col gap-1 px-4 py-3';
  return (
    <section className="panel grid grid-cols-2 divide-line sm:grid-cols-4 lg:grid-cols-8 [&>*]:border-line [&>*]:border-b lg:[&>*]:border-b-0 lg:[&>*:not(:last-child)]:border-r">
      <div className={cell}>
        <span className="label">착공일</span>
        <span className="num text-[15px] font-semibold">{fmtDot(p.info.start)}</span>
      </div>
      <div className={cell}>
        <span className="label">준공일</span>
        <span className="num text-[15px] font-semibold">{fmtDot(p.info.end)}</span>
      </div>
      <div className={cell}>
        <span className="label">총 공사기간</span>
        <span className="num text-[15px] font-semibold">
          {c.totalDays}일 <span className="text-[12px] font-normal text-mute">작업일 {c.workDays}</span>
        </span>
      </div>
      <div className={cell}>
        <span className="label">계약금액</span>
        <span className="num text-[15px] font-semibold">{won(p.info.amount)}원</span>
      </div>
      <div className={cell}>
        <label className="label" htmlFor="base-date">
          기준일 <span className="text-mute">(경과 {c.elapsedDays}일)</span>
        </label>
        <div className="flex items-center gap-1">
          <input id="base-date" type="date" className="cell-inp num border-line" style={{ borderColor: 'var(--line)', height: 28, minWidth: 128 }} value={p.info.baseDate} onChange={(e) => isValidDate(e.target.value) && update((d) => void (d.info.baseDate = e.target.value), 'base')} />
          <button className="btn btn-sm" onClick={() => update((d) => void (d.info.baseDate = todayKST()))} title="오늘(KST)">
            오늘
          </button>
        </div>
      </div>
      <div className={cell}>
        <span className="label">예정공정률</span>
        <span className="kpi-num" style={{ color: 'var(--plan)' }}>
          {fmt1(c.planned)}%
        </span>
      </div>
      <div className={cell}>
        <span className="label">실제공정률</span>
        <span className="kpi-num" style={{ color: 'var(--act)' }}>
          {fmt1(c.actual)}%
        </span>
      </div>
      <div className={cell}>
        <span className="label">공정 편차 · 상태</span>
        <span className="flex items-center gap-2">
          <span className="kpi-num" style={{ color: st.key === 'late' ? 'var(--late)' : 'var(--ink)' }}>
            {c.deviation >= 0 ? '+' : ''}
            {fmt1(c.deviation)}
            <span className="text-[13px]">%p</span>
          </span>
          <span className={`pill st-${st.key}`}>{st.label}</span>
        </span>
      </div>
    </section>
  );
}

export { addDays };
