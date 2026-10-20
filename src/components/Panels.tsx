import { useState } from 'react';
import type { ProgressEntry, Project } from '../lib/types';
import { fmtDot, isValidDate } from '../lib/date';
import { entryPct, sortedHistory, STATUS_LABEL, type ProjectCalc } from '../lib/calc';
import { uid } from '../lib/schedule';
import { Confirm, Field, fmt1, Modal, NumField } from './ui';

type Upd = (fn: (d: Project) => void, key?: string) => void;

// ───────────────── 실적 이력 ─────────────────
export function HistoryPanel({ p, c, update, toast }: { p: Project; c: ProjectCalc; update: Upd; toast: (m: string) => void }) {
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState<ProgressEntry | null>(null);
  const [del, setDel] = useState<ProgressEntry | null>(null);
  const [load, setLoad] = useState<ProgressEntry | null>(null);
  const leaves = c.tree.leaves;
  const hist = sortedHistory(p.history).reverse();
  const atBase = p.history.find((h) => h.date === p.info.baseDate);
  const differs = atBase ? leaves.some((t) => Math.abs((atBase.values[t.id] ?? 0) - (t.actual || 0)) > 1e-9) : true;

  const saveNow = () => {
    update((d) => {
      const values = Object.fromEntries(leaves.map((t) => [t.id, d.tasks.find((x) => x.id === t.id)!.actual || 0]));
      const ex = d.history.find((h) => h.date === d.info.baseDate);
      if (ex) {
        ex.values = values;
        if (note) ex.note = note;
        ex.savedAt = new Date().toISOString();
      } else d.history.push({ id: uid('h'), date: d.info.baseDate, values, note, savedAt: new Date().toISOString() });
    });
    setNote('');
    toast(`${fmtDot(p.info.baseDate)} 실적 ${fmt1(c.actual)}% 저장됨`);
  };

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <div className="h2">기준일별 실적 이력</div>
          <div className="text-[12px] text-mute">누적 실제공정률 곡선은 저장된 이력만 사용합니다. 입력하지 않은 날짜의 실적은 만들지 않습니다.</div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2 px-4 py-3">
        <Field label={`기준일 ${fmtDot(p.info.baseDate)} · 현재 실적 ${fmt1(c.actual)}%`} htmlFor="h-note" className="min-w-[200px] flex-1">
          <input id="h-note" className="inp" placeholder="비고(선택)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button className="btn btn-primary" onClick={saveNow} disabled={!leaves.length}>
          {atBase ? '기준일 실적 덮어쓰기' : '기준일 실적 저장'}
        </button>
      </div>
      {atBase && differs && <div className="mx-4 mb-2 rounded px-3 py-2 text-[12.5px]" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>표의 현재 실적이 {fmtDot(p.info.baseDate)}에 저장된 이력과 다릅니다. 저장하면 이력이 갱신됩니다.</div>}
      {!atBase && leaves.some((t) => t.actual > 0) && <div className="mx-4 mb-2 text-[12.5px] text-mute">기준일 실적이 아직 이력에 없습니다.</div>}
      <div className="overflow-x-auto px-4 pb-4">
        <table className="tbl">
          <thead>
            <tr>
              <th>입력일(기준일)</th>
              <th className="text-right">전체 실적(%)</th>
              <th>비고</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hist.map((h) => (
              <tr key={h.id}>
                <td className="num">{fmtDot(h.date)}</td>
                <td className="num text-right font-semibold" style={{ color: 'var(--act)' }}>
                  {fmt1(entryPct(h, leaves))}
                </td>
                <td className="text-ink2" style={{ minWidth: 120 }}>{h.note}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn btn-sm" onClick={() => setEdit(structuredClone(h))}>
                    조회·수정
                  </button>{' '}
                  <button className="btn btn-sm" onClick={() => setLoad(h)} title="이 이력의 값을 표의 현재 실적으로 불러옵니다">
                    현재값으로
                  </button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => setDel(h)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!hist.length && (
              <tr>
                <td colSpan={4} className="py-5 text-center text-mute">
                  저장된 실적 이력이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          title={`실적 이력 · ${fmtDot(edit.date)}`}
          onClose={() => setEdit(null)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>
                취소
              </button>
              <button
                className="btn btn-primary"
                disabled={!isValidDate(edit.date) || p.history.some((h) => h.date === edit.date && h.id !== edit.id)}
                onClick={() => {
                  update((d) => {
                    const i = d.history.findIndex((h) => h.id === edit.id);
                    if (i >= 0) d.history[i] = { ...edit, savedAt: new Date().toISOString() };
                  });
                  setEdit(null);
                }}
              >
                저장
              </button>
            </>
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Field label="입력일" htmlFor="e-date">
              <input id="e-date" type="date" className="inp num" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
            </Field>
            <Field label="비고" htmlFor="e-note">
              <input id="e-note" className="inp" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Field>
          </div>
          {p.history.some((h) => h.date === edit.date && h.id !== edit.id) && <div className="mb-2 text-[12.5px] text-late">같은 날짜의 이력이 이미 있습니다.</div>}
          <div className="max-h-[50vh] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>공종</th>
                  <th className="text-right">보할</th>
                  <th className="text-right">실적(%)</th>
                </tr>
              </thead>
              <tbody>
                {c.rows
                  .filter((r) => r.node.isLeaf)
                  .map((r) => (
                    <tr key={r.node.task.id}>
                      <td>
                        {r.node.num}. {r.node.task.name}
                      </td>
                      <td className="num text-right text-ink2">{r.node.weight.toFixed(2)}</td>
                      <td style={{ width: 110 }}>
                        <NumField
                          className="inp num text-right"
                          value={edit.values[r.node.task.id] ?? 0}
                          min={0}
                          max={100}
                          digits={1}
                          onChange={(v) => setEdit((e) => (e ? { ...e, values: { ...e.values, [r.node.task.id]: v } } : e))}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-right text-[13px]">
            전체 실적 <b className="num">{fmt1(entryPct(edit, leaves))}%</b>
          </div>
        </Modal>
      )}
      {del && <Confirm title="이력 삭제" danger okLabel="삭제" message={`${fmtDot(del.date)} 실적 이력을 삭제합니다.`} onOk={() => update((d) => void (d.history = d.history.filter((h) => h.id !== del.id)))} onClose={() => setDel(null)} />}
      {load && (
        <Confirm
          title="현재 실적으로 불러오기"
          message={`${fmtDot(load.date)} 이력의 공종별 실적을 표의 현재 실적으로 바꿉니다. 기준일도 ${fmtDot(load.date)}로 변경됩니다.`}
          onOk={() =>
            update((d) => {
              for (const t of d.tasks) if (load.values[t.id] != null) t.actual = load.values[t.id];
              d.info.baseDate = load.date;
            })
          }
          onClose={() => setLoad(null)}
        />
      )}
    </section>
  );
}

// ───────────────── 공정현황 및 특이사항 ─────────────────
export function StatusPanel({ p, c, update }: { p: Project; c: ProjectCalc; update: Upd }) {
  const leafRows = c.rows.filter((r) => r.node.isLeaf);
  const count = (k: string) => leafRows.filter((r) => r.status === k || (k === 'progress' && r.status === 'ahead')).length;
  const late = leafRows
    .filter((r) => r.status === 'late')
    .sort((a, b) => a.actual - a.planned - (b.actual - b.planned))
    .slice(0, 6);
  return (
    <section className="panel">
      <div className="border-b border-line px-4 py-3">
        <div className="h2">공정현황 및 특이사항</div>
      </div>
      <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            {(['done', 'progress', 'late', 'idle'] as const).map((k) => (
              <span key={k} className={`pill st-${k}`}>
                {STATUS_LABEL[k]} {count(k)}
              </span>
            ))}
          </div>
          <p className="text-[13.5px] leading-relaxed">
            {fmtDot(p.info.baseDate)} 기준 예정공정률 <b className="num">{fmt1(c.planned)}%</b>, 실제공정률 <b className="num">{fmt1(c.actual)}%</b>로 예정 대비{' '}
            <b className="num" style={{ color: c.deviation < -0.05 ? 'var(--late)' : 'var(--ink)' }}>
              {c.deviation >= 0 ? '+' : ''}
              {fmt1(c.deviation)}%p
            </b>{' '}
            {c.deviation < -0.05 ? '지연' : c.deviation > 0.05 ? '선행' : '정상'} 상태입니다.
          </p>
          {late.length > 0 && (
            <div>
              <div className="label mb-1">지연 공종</div>
              <table className="tbl">
                <tbody>
                  {late.map((r) => (
                    <tr key={r.node.task.id}>
                      <td className="text-[13px]">{r.node.task.name}</td>
                      <td className="num whitespace-nowrap text-right text-[12.5px] text-ink2">
                        {fmt1(r.planned)} → {fmt1(r.actual)}
                      </td>
                      <td className="num whitespace-nowrap text-right text-[12.5px] font-semibold text-late">{fmt1(r.actual - r.planned)}%p</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <Field label="특이사항 (PDF 출력에 포함)" htmlFor="status-note">
          <textarea id="status-note" className="inp" rows={7} value={p.statusNote} onChange={(e) => update((d) => void (d.statusNote = e.target.value), 'statusNote')} placeholder="자재 수급, 인력, 설계변경, 협의사항 등" />
        </Field>
      </div>
    </section>
  );
}

// ───────────────── 모바일 실적 입력 ─────────────────
export function MobileTasks({ c, update, onOpenDetail }: { c: ProjectCalc; update: Upd; onOpenDetail: (id: string) => void }) {
  return (
    <div className="flex flex-col divide-y divide-line">
      {c.rows.map((r) => {
        const t = r.node.task;
        return (
          <div key={t.id} className="flex flex-col gap-1.5 px-3 py-2.5" style={{ paddingLeft: 12 + r.node.depth * 12, background: r.node.isLeaf ? undefined : 'var(--sunk)' }}>
            <div className="flex items-start justify-between gap-2">
              <button className="min-w-0 text-left" onClick={() => onOpenDetail(t.id)}>
                <span className="num mr-1 text-[12px] text-mute">{r.node.num}</span>
                <span className={`text-[14px] ${r.node.isLeaf ? '' : 'font-semibold'}`}>{t.name}</span>
              </button>
              <span className={`pill st-${r.status} flex-none`}>{STATUS_LABEL[r.status]}</span>
            </div>
            <div className="num flex flex-wrap gap-x-3 text-[12px] text-ink2">
              <span>
                {fmtDot(r.node.start).slice(2)}~{fmtDot(r.node.end).slice(2)}
              </span>
              <span>보할 {r.node.weight.toFixed(2)}</span>
              <span style={{ color: 'var(--plan)' }}>예정 {fmt1(r.planned)}</span>
            </div>
            {r.node.isLeaf ? (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={t.actual}
                  aria-label={`${t.name} 실적`}
                  className="flex-1"
                  style={{ accentColor: 'var(--act)' }}
                  onChange={(e) => update((d) => void (d.tasks.find((x) => x.id === t.id)!.actual = Number(e.target.value)), `a-${t.id}`)}
                />
                <div style={{ width: 74 }}>
                  <NumField className="inp num text-right" value={t.actual} min={0} max={100} digits={1} ariaLabel="실적(%)" onChange={(v) => update((d) => void (d.tasks.find((x) => x.id === t.id)!.actual = v), `a-${t.id}`)} />
                </div>
                <span className="text-[12px] text-mute">%</span>
              </div>
            ) : (
              <div className="num text-[12.5px]" style={{ color: 'var(--act)' }}>
                실적 {fmt1(r.actual)}%
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
