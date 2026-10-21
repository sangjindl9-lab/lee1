import { useState } from 'react';
import type { Project } from '../lib/types';
import { fmtDot, isValidDate, toNum } from '../lib/date';
import { makeTotal, groupMembers, nextPhaseNo, phaseLabel, suggestPhaseStart, summarizePhases, createPhase, derivePhaseTasks } from '../lib/phases';
import { Confirm, Field, fmt1, Modal, NumField, won } from './ui';

type Upd = (fn: (d: Project) => void, key?: string) => void;

/** 장기계속공사: 총차 / 1차 / 2차 … 탭과 차수 관리 */
export function PhasePanel({
  p,
  all,
  update,
  onOpen,
  onAdd,
  toast,
}: {
  p: Project;
  all: Project[];
  update: Upd;
  onOpen: (id: string) => void;
  onAdd: (np: Project) => void;
  toast: (m: string) => void;
}) {
  const [dlg, setDlg] = useState<null | 'add' | 'make' | 'resync' | 'unlink'>(null);
  const members = groupMembers(all, p);
  const total = members.find((x) => x.contract?.kind === 'total') || null;
  const linked = !!p.contract;

  if (!linked) {
    return (
      <section className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="text-[13px] text-ink2">
          <b className="text-ink">장기계속공사</b> — 착공을 여러 번 하는 공사는 총차 예정공정표와 차수별(1차·2차…) 예정공정표를 함께 관리할 수 있습니다.
        </div>
        <button className="btn btn-sm" onClick={() => setDlg('make')}>
          총차 공정표로 지정
        </button>
        {dlg === 'make' && (
          <Confirm
            title="총차 예정공정표로 지정"
            okLabel="지정"
            message={
              <>
                이 공정표를 <b>총차 예정공정표</b>로 지정합니다. 공사기간({fmtDot(p.info.start)} ~ {fmtDot(p.info.end)})과 계약금액은 총 공사 기준으로 입력하세요. 지정 후 [+ 차수 추가]로 1차·2차 공정표를 만들 수 있습니다.
              </>
            }
            onOk={() =>
              update((d) => makeTotal(d))
            }
            onClose={() => setDlg(null)}
          />
        )}
      </section>
    );
  }

  const summary = total ? summarizePhases(total, members) : null;
  const isPhase = p.contract?.kind === 'phase';

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="text-[13px] font-semibold">장기계속공사</span>
        <div className="seg" role="tablist" aria-label="차수">
          {members.map((m) => (
            <button key={m.id} role="tab" aria-pressed={m.id === p.id} onClick={() => m.id !== p.id && onOpen(m.id)}>
              {phaseLabel(m)}
            </button>
          ))}
        </div>
        {total && (
          <button className="btn btn-sm" onClick={() => setDlg('add')}>
            + 차수 추가
          </button>
        )}
        {!total && <span className="text-[12px] text-late">총차 공정표를 찾을 수 없습니다(삭제됨).</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {isPhase && total && (
            <button className="btn btn-sm" onClick={() => setDlg('resync')}>
              총차에서 다시 가져오기
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setDlg('unlink')}>
            연결 해제
          </button>
        </div>
      </div>

      {summary && (
        <div className="overflow-x-auto border-t border-line px-4 pb-3 pt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>차수</th>
                <th>공사기간</th>
                <th className="text-right">일수</th>
                <th className="text-right">계약금액(원)</th>
                <th className="text-right">총차 대비 금액(%)</th>
                <th className="text-right" title="총차 예정공정 중 이 차수 기간에 해당하는 몫">총차 예정 몫(%)</th>
                <th className="text-right" title="차수 준공일 기준 총차 누적 예정공정률">총차 누계(%)</th>
                <th className="text-right">차수 실적(%)</th>
                <th className="text-right" title="총차 예정 몫 × 차수 실적">총차 환산 실적(%p)</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.project.id} style={r.project.id === p.id ? { background: 'var(--sel)' } : undefined}>
                  <td>
                    <button className="font-semibold hover:underline" onClick={() => onOpen(r.project.id)}>
                      {r.label}
                    </button>
                  </td>
                  <td className="num whitespace-nowrap text-[12.5px]">
                    {fmtDot(r.start)} ~ {fmtDot(r.end)}
                  </td>
                  <td className="num text-right">{r.days}</td>
                  <td className="num text-right">{won(r.amount)}</td>
                  <td className="num text-right">{r.amountRatio == null ? '-' : fmt1(r.amountRatio)}</td>
                  <td className="num text-right">{r.share.toFixed(2)}</td>
                  <td className="num text-right">{fmt1(r.planCumAtEnd)}</td>
                  <td className="num text-right" style={{ color: 'var(--act)' }}>
                    {fmt1(r.actual)}
                  </td>
                  <td className="num text-right font-semibold" style={{ color: 'var(--act)' }}>
                    {r.totalContribution.toFixed(2)}
                  </td>
                </tr>
              ))}
              {!summary.rows.length && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-mute">
                    아직 차수 공정표가 없습니다. [+ 차수 추가]를 누르세요.
                  </td>
                </tr>
              )}
              {summary.rows.length > 0 && total && (
                <tr style={{ background: 'var(--sunk)', fontWeight: 600 }}>
                  <td>합계</td>
                  <td className="num text-[12.5px]">
                    총차 {fmtDot(total.info.start)} ~ {fmtDot(total.info.end)}
                  </td>
                  <td />
                  <td className={`num text-right ${total.info.amount && summary.sumAmount > total.info.amount ? 'text-late' : ''}`}>{won(summary.sumAmount)}</td>
                  <td className="num text-right">{total.info.amount ? fmt1((summary.sumAmount / total.info.amount) * 100) : '-'}</td>
                  <td className="num text-right">{summary.sumShare.toFixed(2)}</td>
                  <td />
                  <td />
                  <td className="num text-right" style={{ color: 'var(--act)' }}>
                    {summary.sumContribution.toFixed(2)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-mute">총차 환산 실적 합계는 차수별 실적을 총차 기준으로 합친 값입니다. 총차 공정표의 실적 입력과는 별개로 참고용으로 보여줍니다.</p>
        </div>
      )}

      {dlg === 'add' && total && (
        <AddPhaseDialog
          total={total}
          members={members}
          onClose={() => setDlg(null)}
          onCreate={(np) => {
            setDlg(null);
            onAdd(np);
            toast(`${phaseLabel(np)} 예정공정표를 만들었습니다.`);
          }}
        />
      )}
      {dlg === 'resync' && total && (
        <Confirm
          title="총차에서 다시 가져오기"
          okLabel="다시 가져오기"
          message={`총차 공정표의 공종·보할을 ${fmtDot(p.info.start)} ~ ${fmtDot(p.info.end)} 기간으로 다시 계산해 이 차수 공종을 교체합니다. 이 차수에 입력한 실적과 실적 이력은 지워집니다. 되돌리려면 [↶ 취소]를 누르세요.`}
          onOk={() => {
            const { tasks } = derivePhaseTasks(total, p.info.start, p.info.end);
            if (!tasks.length) {
              toast('이 차수 기간에 해당하는 총차 공종이 없습니다.');
              return;
            }
            update((d) => {
              d.tasks = tasks;
              d.history = [];
              d.weightMode = total.weightMode;
              d.scheduleBase = { start: d.info.start, end: d.info.end };
            });
            toast('총차 공정표에서 공종·보할을 다시 가져왔습니다.');
          }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'unlink' && (
        <Confirm
          title="연결 해제"
          okLabel="해제"
          message={`이 공정표(${phaseLabel(p)})를 장기계속공사 묶음에서 뺍니다. 공정표 내용은 그대로 남습니다.`}
          onOk={() => update((d) => void (d.contract = null))}
          onClose={() => setDlg(null)}
        />
      )}
    </section>
  );
}

function AddPhaseDialog({ total, members, onClose, onCreate }: { total: Project; members: Project[]; onClose: () => void; onCreate: (p: Project) => void }) {
  const no0 = nextPhaseNo(members);
  const [no, setNo] = useState(no0);
  const [start, setStart] = useState(() => suggestPhaseStart(total, members));
  const [end, setEnd] = useState(() => {
    const s = suggestPhaseStart(total, members);
    const y = s.slice(0, 4);
    const ye = `${y}-12-31`;
    return ye < total.info.end ? ye : total.info.end;
  });
  const [amount, setAmount] = useState(0);
  const [fromTotal, setFromTotal] = useState(total.tasks.length > 0);
  const dup = members.some((m) => m.contract?.kind === 'phase' && m.contract.no === no);
  const valid = isValidDate(start) && isValidDate(end) && end >= start && no >= 1 && !dup;
  const overlap = members.filter((m) => m.contract?.kind === 'phase' && m.info.start <= end && m.info.end >= start);
  const outside = valid && (start < total.info.start || end > total.info.end);
  const preview = valid && fromTotal ? derivePhaseTasks(total, start, end) : null;
  return (
    <Modal
      title="차수 예정공정표 추가"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onCreate(createPhase(total, no, start, end, amount, fromTotal))}>
            {no}차 만들기
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="차수" htmlFor="ph-no">
          <NumField id="ph-no" className="inp num text-right" value={no} min={1} max={99} digits={0} onChange={(v) => setNo(Math.round(v))} />
        </Field>
        <Field label="계약금액(원)" htmlFor="ph-amt">
          <NumField id="ph-amt" className="inp num text-right" value={amount} thousands min={0} onChange={setAmount} />
        </Field>
        <Field label="착공일" htmlFor="ph-s">
          <input id="ph-s" type="date" className="inp num" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="준공일" htmlFor="ph-e">
          <input id="ph-e" type="date" className="inp num" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <div className="col-span-2 flex flex-col gap-2 text-[13px]">
          <label className="flex items-start gap-2">
            <input type="radio" name="ph-src" checked={fromTotal} disabled={!total.tasks.length} onChange={() => setFromTotal(true)} className="mt-1" />
            <span>
              <b>총차 공정표에서 가져오기</b> (권장)
              <br />
              <span className="text-ink2">총차 공종 중 이 기간에 해당하는 공종을 가져오고, 그 기간의 예정 보할을 차수 안에서 100%로 환산합니다.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="ph-src" checked={!fromTotal} onChange={() => setFromTotal(false)} className="mt-1" />
            <span>
              <b>기본 공종으로 새로 생성</b>
              <br />
              <span className="text-ink2">차수 기간에 맞춰 기본 공종을 새로 배치합니다(보할은 임시값).</span>
            </span>
          </label>
        </div>
        <div className="col-span-2 rounded bg-sunk px-3 py-2 text-[12.5px] text-ink2">
          {!valid ? (
            dup ? `${no}차 공정표가 이미 있습니다.` : '착공일과 준공일을 확인하세요 (준공일 ≥ 착공일).'
          ) : (
            <>
              {no}차 공사기간 {toNum(end) - toNum(start) + 1}일
              {preview && (
                <>
                  {' '}· 가져올 공종 {preview.tasks.length}개 · 총차 예정 중 이 기간 몫 <b className="num">{preview.share.toFixed(2)}%</b>
                </>
              )}
              {preview && !preview.tasks.length && <span className="text-warn"> · 해당 기간 총차 공종이 없어 기본 공종으로 생성합니다.</span>}
              {overlap.length > 0 && <div className="text-warn">기간이 겹치는 차수: {overlap.map((m) => `${m.contract!.no}차`).join(', ')}</div>}
              {outside && <div className="text-warn">총차 공사기간({fmtDot(total.info.start)} ~ {fmtDot(total.info.end)}) 밖의 기간이 포함되어 있습니다.</div>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

