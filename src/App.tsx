import { useEffect, useMemo, useState } from 'react';
import { useProjects } from './state/useProjects';
import { computeProject, normalizeTo, UNIT_LABEL } from './lib/calc';
import { generateTasks, rescaleTasks } from './lib/schedule';
import { addAfter, addChild, indent, moveTask, outdent, removeTask } from './lib/taskOps';
import { exportExcel } from './lib/exportExcel';
import { exportPdf, type Paper } from './lib/exportPdf';
import { exportFormPdf } from './lib/exportFormPdf';
import { saveFile } from './lib/download';
import { isValidDate, todayKST } from './lib/date';
import type { Project, ViewUnit } from './lib/types';
import { applyCost, Gantt } from './components/Gantt';
import { FormSheet } from './components/FormSheet';
import { PhasePanel } from './components/PhasePanel';
import { phaseLabel, phaseMarks } from './lib/phases';
import { InfoPanel, ScheduleBanner, SummaryStrip } from './components/InfoPanel';
import { SCurve } from './components/SCurve';
import { HistoryPanel, MobileTasks, StatusPanel } from './components/Panels';
import { NewProjectDialog, ProjectList, TaskDetail, TemplateDialog } from './components/Dialogs';
import { Confirm, fmt1, fmt2, Modal, useToast } from './components/ui';

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

const safeName = (p: Project) => (p.info.name || '공정표').replace(/^\[예시\]\s*/, '예시_').slice(0, 60) + (p.contract ? `_${phaseLabel(p)}` : '');

export default function App() {
  const S = useProjects();
  const toast = useToast();
  const mobile = useMedia('(max-width: 767px)');
  const wide = useMedia('(min-width: 1500px)');
  const [cols, setCols] = useState<'full' | 'simple'>(() => (window.innerWidth >= 1500 ? 'full' : 'simple'));
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | 'list' | 'new' | 'template' | 'pdf' | 'regen' | 'delTask'>(null);
  const [infoOpen, setInfoOpen] = useState(!mobile);
  const [busy, setBusy] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'input' | 'chart'>('input');
  const [sheet, setSheet] = useState<'form' | 'edit'>('form');

  useEffect(() => {
    if (wide) setCols('full');
  }, [wide]);

  const p = S.cur;
  const c = useMemo(() => (p ? computeProject(p) : null), [p]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? S.redo() : S.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        S.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        S.flush();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [S]);

  if (!S.ready || !p || !c) {
    return <div className="gutter flex h-screen items-center justify-center text-mute">공정표를 불러오는 중…</div>;
  }
  const update = S.update;
  const sel = selected && p.tasks.some((t) => t.id === selected) ? selected : null;

  const generate = () => {
    if (!isValidDate(p.info.start) || !isValidDate(p.info.end) || p.info.end < p.info.start) {
      toast.show('착공일과 준공일을 확인하세요. 준공일은 착공일 이후여야 합니다.');
      return;
    }
    update((d) => {
      d.tasks = generateTasks(d);
      d.history = [];
      d.weightProvisional = true;
      d.scheduleBase = { start: d.info.start, end: d.info.end };
      if (d.weightMode === 'cost') d.weightMode = 'direct';
    });
    setSelected(null);
    toast.show('기본 공종으로 예정공정표를 생성했습니다. 보할은 임시값입니다.');
  };

  const doExport = async (kind: 'xlsx' | Paper, style: 'form' | 'detail' = 'form') => {
    setBusy(kind === 'xlsx' ? 'Excel 파일 만드는 중…' : `${kind} PDF 만드는 중…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const blob = kind === 'xlsx' ? await exportExcel(p, S.projects) : style === 'form' ? await exportFormPdf(p, kind, phaseMarks(S.projects, p)) : await exportPdf(p, kind);
      const fname = `${safeName(p)}_예정공정표_${UNIT_LABEL[p.view].replace(' ', '')}${kind === 'xlsx' ? '' : (style === 'form' ? '_제출용_' : '_관리용_') + kind}_${p.info.baseDate}.${kind === 'xlsx' ? 'xlsx' : 'pdf'}`;
      const r = await saveFile(fname, blob);
      toast.show(r === 'saved' ? `${fname} 저장` : r === 'declined' ? '저장을 취소했습니다.' : '파일을 저장하지 못했습니다. 다시 시도하세요.');
    } catch (e) {
      console.error(e);
      toast.show('출력 중 오류가 발생했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const exportJson = async (all: boolean) => {
    const data = all ? { app: 'gongjung-planner', exportedAt: new Date().toISOString(), projects: S.projects } : p;
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const r = await saveFile(all ? `공정표_전체백업_${todayKST()}.json` : `${safeName(p)}_백업_${todayKST()}.json`, blob);
    if (r === 'saved') toast.show('백업 파일을 저장했습니다.');
  };

  const weightOff = Math.abs(c.weightTotal - 100) > 0.005;
  const setView = (v: ViewUnit) => update((d) => void (d.view = v));
  const leafIds = new Set(c.tree.leaves.map((t) => t.id));
  const saveLabel = S.saveState === 'pending' || S.saveState === 'saving' ? '저장 중…' : S.saveState === 'error' ? '저장 실패' : S.savedAt ? `자동 저장됨 ${S.savedAt}` : '자동 저장';

  return (
    <div className="min-h-screen pb-10">
      {/* 상단 바 */}
      <header className="gutter sticky z-30 border-b border-line bg-panel" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded bg-head text-[11px] font-bold leading-none text-headInk" aria-hidden>
              공정
            </div>
            <button className="min-w-0 text-left" onClick={() => setDlg('list')} title="프로젝트 선택">
              <div className="label leading-tight">프로젝트 ▾ · {S.projects.length}개</div>
              <div className="truncate text-[15px] font-semibold leading-tight">
                {p.contract && <span className="mr-1.5 rounded bg-head px-1.5 py-0.5 text-[11.5px] text-headInk">{phaseLabel(p)}</span>}
                {p.info.name || '(공사명 없음)'}
              </div>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`mr-1 hidden text-[12px] sm:inline ${S.saveState === 'error' ? 'text-late' : 'text-mute'}`}>{saveLabel}</span>
            <button className="btn btn-sm" onClick={S.undo} disabled={!S.canUndo} title="실행 취소 (Ctrl+Z)">
              ↶ 취소
            </button>
            <button className="btn btn-sm" onClick={S.redo} disabled={!S.canRedo} title="다시 실행 (Ctrl+Y)">
              ↷ 재실행
            </button>
            <button className="btn btn-sm" onClick={() => setDlg('list')}>
              목록
            </button>
            <button className="btn btn-sm" onClick={() => setDlg('new')}>
              신규
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await S.flush();
                toast.show('저장했습니다.');
              }}
            >
              저장
            </button>
            <button className="btn btn-sm" onClick={() => doExport('xlsx')} disabled={!!busy}>
              Excel
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setDlg('pdf')} disabled={!!busy}>
              PDF
            </button>
          </div>
        </div>
      </header>

      <main className="gutter">
        <div className="mx-auto flex min-w-0 max-w-[1800px] flex-col gap-3 pt-3">
          <ScheduleBanner
            p={p}
            onRescale={(protect) =>
              update((d) => {
                const b = d.scheduleBase!;
                d.tasks = rescaleTasks(d.tasks, b.start, b.end, d.info.start, d.info.end, protect);
                d.scheduleBase = { start: d.info.start, end: d.info.end };
              })
            }
            onKeep={() => update((d) => void (d.scheduleBase = { start: d.info.start, end: d.info.end }))}
            onRegenerate={() => setDlg('regen')}
          />
          <PhasePanel
            p={p}
            all={S.projects}
            update={update}
            onOpen={(id) => {
              S.open(id);
              setSelected(null);
            }}
            onAdd={async (np) => {
              await S.add(np);
              setSelected(null);
            }}
            toast={toast.show}
          />
          <SummaryStrip p={p} c={c} update={update} />
          <InfoPanel p={p} update={update} onGenerate={() => (p.tasks.length ? setDlg('regen') : generate())} onTemplate={() => setDlg('template')} open={infoOpen} setOpen={setInfoOpen} />

          {/* 공정표 */}
          <section className="panel overflow-hidden">
            <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h2 mr-1">예정공정표</span>
                <div className="seg" role="group" aria-label="보기">
                  <button aria-pressed={sheet === 'form'} onClick={() => setSheet('form')}>
                    제출 양식
                  </button>
                  <button aria-pressed={sheet === 'edit'} onClick={() => setSheet('edit')}>
                    편집·간트
                  </button>
                </div>
                <div className="seg" role="group" aria-label="공정표 단위">
                  {(['month', 'week', 'd20'] as const).map((v) => (
                    <button key={v} aria-pressed={p.view === v} onClick={() => setView(v)}>
                      {UNIT_LABEL[v]}
                    </button>
                  ))}
                </div>
                <div className="seg" role="group" aria-label="보할 입력 방식">
                  <button aria-pressed={p.weightMode === 'direct'} onClick={() => update((d) => void (d.weightMode = 'direct'))}>
                    보할 직접 입력
                  </button>
                  <button
                    aria-pressed={p.weightMode === 'cost'}
                    onClick={() =>
                      update((d) => {
                        d.weightMode = 'cost';
                        if (d.tasks.some((t) => t.cost > 0)) applyCost(d);
                      })
                    }
                  >
                    공사비 산정
                  </button>
                </div>
                {!mobile && sheet === 'edit' && (
                  <div className="seg" role="group" aria-label="표시 열">
                    <button aria-pressed={cols === 'simple'} onClick={() => setCols('simple')}>
                      간단
                    </button>
                    <button aria-pressed={cols === 'full'} onClick={() => setCols('full')}>
                      전체 열
                    </button>
                  </div>
                )}
                <div className={`ml-auto flex-wrap items-center gap-3 text-[11.5px] text-ink2 ${sheet === 'edit' ? 'flex' : 'hidden'}`}>
                  <Legend color="var(--plan-soft)" border="var(--plan)" label="예정" />
                  <Legend color="var(--act)" label="실적" />
                  <Legend color="var(--late)" label="지연" />
                  <Legend color="var(--done)" label="완료" />
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-0 border-l-2 border-dashed" style={{ borderColor: 'var(--late)' }} />
                    기준일
                  </span>
                </div>
              </div>
              <div className={`flex-wrap items-center gap-1.5 ${sheet === 'edit' ? 'flex' : 'hidden'}`}>
                <button className="btn btn-sm" onClick={() => update((d) => setSelected(addAfter(d, sel)))}>
                  + 공종 추가
                </button>
                <button className="btn btn-sm" disabled={!sel} onClick={() => sel && update((d) => setSelected(addChild(d, sel)))}>
                  + 하위 공종
                </button>
                <button className="btn btn-sm" disabled={!sel} onClick={() => sel && update((d) => moveTask(d, sel, -1))} title="위로">
                  ↑
                </button>
                <button className="btn btn-sm" disabled={!sel} onClick={() => sel && update((d) => moveTask(d, sel, 1))} title="아래로">
                  ↓
                </button>
                <button className="btn btn-sm" disabled={!sel} onClick={() => sel && update((d) => outdent(d, sel))} title="내어쓰기(상위 단계로)">
                  ← 내어쓰기
                </button>
                <button className="btn btn-sm" disabled={!sel} onClick={() => sel && update((d) => indent(d, sel))} title="들여쓰기(위 공종의 하위로)">
                  들여쓰기 →
                </button>
                <button className="btn btn-sm" disabled={!sel} onClick={() => sel && setDetail(sel)}>
                  상세·색상·메모
                </button>
                <button className="btn btn-sm btn-danger" disabled={!sel} onClick={() => setDlg('delTask')}>
                  삭제
                </button>
                <span className="text-[12px] text-mute">{sel ? `선택: ${c.byId.get(sel)?.node.num}. ${c.byId.get(sel)?.node.task.name}` : '행을 눌러 공종을 선택하세요'}</span>
              </div>

              {p.weightProvisional && p.tasks.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded px-3 py-2 text-[12.5px]" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                  <b>보할은 자동 생성된 임시 예시값입니다.</b> 공종별 공사비를 입력하거나(공사비 산정) 보할을 직접 확인한 뒤 확정하세요.
                  <button className="btn btn-sm" disabled={weightOff} onClick={() => update((d) => void (d.weightProvisional = false))}>
                    보할 확정
                  </button>
                </div>
              )}
              {weightOff && c.tree.leaves.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded px-3 py-2 text-[12.5px]" style={{ background: 'var(--late-soft)', color: 'var(--late)' }}>
                  <b className="num">보할 합계 {fmt2(c.weightTotal)}%</b> — 100%가 아닙니다. 전체 공정률은 보할 합계 기준으로 환산해 계산 중입니다.
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      update((d) => {
                        const leaves = d.tasks.filter((t) => leafIds.has(t.id));
                        const v = normalizeTo(leaves.map((t) => t.weight));
                        leaves.forEach((t, i) => (t.weight = v[i]));
                        if (d.weightMode === 'cost') d.weightMode = 'direct';
                      })
                    }
                  >
                    100%로 비례조정
                  </button>
                </div>
              )}
              {p.weightMode === 'cost' && (
                <div className="text-[12.5px] text-ink2">
                  보할 = 공종 공사비 ÷ 전체 공종 공사비 합계 × 100 · 공종 공사비 합계 <b className="num">{c.costTotal.toLocaleString('ko-KR')}원</b>
                  {p.info.amount > 0 && <span className={c.costTotal !== p.info.amount ? 'text-warn' : ''}> (계약금액 대비 {fmt1((c.costTotal / p.info.amount) * 100)}%)</span>}
                </div>
              )}
              {mobile && sheet === 'edit' && (
                <div className="seg self-start" role="group" aria-label="모바일 보기">
                  <button aria-pressed={mobileTab === 'input'} onClick={() => setMobileTab('input')}>
                    실적 입력
                  </button>
                  <button aria-pressed={mobileTab === 'chart'} onClick={() => setMobileTab('chart')}>
                    공정표
                  </button>
                </div>
              )}
            </div>
            {sheet === 'form' ? (
              <FormSheet p={p} c={c} update={update} onOpenDetail={setDetail} compact={mobile} marks={phaseMarks(S.projects, p)} />
            ) : mobile && mobileTab === 'input' ? (
              <div className="border-t border-line">
                <MobileTasks c={c} update={update} onOpenDetail={setDetail} />
              </div>
            ) : (
              <Gantt p={p} c={c} update={update} selected={sel} onSelect={setSelected} onOpenDetail={setDetail} cols={cols} compact={mobile} />
            )}
          </section>

          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <div className="h2">누적공정률 · S-Curve</div>
                <div className="text-[12px] text-mute">집계 구간: {UNIT_LABEL[p.view]} · 실적 곡선은 저장된 이력 기준</div>
              </div>
              <div className="flex gap-4 text-[12.5px]">
                <span>
                  예정 누계 <b className="num" style={{ color: 'var(--plan)' }}>{fmt1(c.planned)}%</b>
                </span>
                <span>
                  실적 누계 <b className="num" style={{ color: 'var(--act)' }}>{fmt1(c.actual)}%</b>
                </span>
              </div>
            </div>
            <div className="px-2 py-3 sm:px-4">
              <SCurve p={p} c={c} />
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-2 [&>*]:min-w-0">
            <HistoryPanel p={p} c={c} update={update} toast={toast.show} />
            <StatusPanel p={p} c={c} update={update} />
          </div>
          <p className="text-center text-[11.5px] text-mute">
            저장 위치: {S.storeLabel} · 날짜 계산은 시간대 영향 없이 달력 날짜 기준(오늘 = 한국 시간) · Ctrl+Z 취소 / Ctrl+Y 재실행
          </p>
        </div>
      </main>

      {detail && <TaskDetail p={p} c={c} id={detail} update={update} onClose={() => setDetail(null)} />}
      {dlg === 'list' && (
        <ProjectList
          projects={S.projects}
          curId={p.id}
          onOpen={(id) => {
            S.open(id);
            setDlg(null);
            setSelected(null);
          }}
          onDuplicate={async (id) => {
            await S.duplicate(id);
            toast.show('공정표를 복제했습니다.');
            setDlg(null);
          }}
          onRemove={(id) => S.remove(id)}
          onNew={() => setDlg('new')}
          onExportAll={() => exportJson(true)}
          onExportCur={() => exportJson(false)}
          onImport={async (f) => {
            try {
              const n = await S.importMany(JSON.parse(await f.text()));
              toast.show(n ? `${n}개 프로젝트를 복원했습니다.` : '복원할 프로젝트가 없습니다. 파일을 확인하세요.');
              if (n) setDlg(null);
            } catch {
              toast.show('JSON 파일을 읽을 수 없습니다.');
            }
          }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'new' && (
        <NewProjectDialog
          onCreate={async (np) => {
            await S.add(np);
            setDlg(null);
            setSelected(null);
            setInfoOpen(true);
            toast.show('새 프로젝트를 만들었습니다.');
          }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'template' && <TemplateDialog p={p} update={update} onClose={() => setDlg(null)} />}
      {dlg === 'regen' && (
        <Confirm
          title="공정표 자동 생성"
          okLabel="새로 생성"
          message={
            <>
              현재 공종 {p.tasks.length}개{p.history.length ? `와 실적 이력 ${p.history.length}건` : ''}을 지우고, {p.info.start} ~ {p.info.end} 공사기간에 맞춘 기본 공종으로 새로 만듭니다. 되돌리려면 [↶ 취소]를 누르세요.
            </>
          }
          onOk={generate}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'delTask' && sel && (
        <Confirm
          title="공종 삭제"
          danger
          okLabel="삭제"
          message={`'${c.byId.get(sel)?.node.task.name}'${c.byId.get(sel)?.node.isLeaf ? '' : ' 및 하위 공종 전체'}을(를) 삭제합니다.`}
          onOk={() => {
            update((d) => removeTask(d, sel));
            setSelected(null);
          }}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg === 'pdf' && (
        <Modal title="PDF 출력" onClose={() => setDlg(null)}>
          <div className="flex flex-col gap-3 text-[13.5px]">
            <p className="text-ink2">
              현재 단위(<b>{UNIT_LABEL[p.view]}</b>)로 출력합니다. 기간이나 공종이 많으면 여러 페이지로 자동으로 나뉩니다.
            </p>
            {(
              [
                ['form', '제출용 양식', '흑백 표 · 기간별 보할값 · 굵은 예정선 · 계/누계'],
                ['detail', '관리용 상세', '색상 막대 · 예정/실적률 · 결재란 · S-Curve 페이지'],
              ] as const
            ).map(([st, title, desc]) => (
              <div key={st} className="rounded border border-line p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <b>{title}</b>
                  <span className="text-[12px] text-mute">{desc}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['A3', 'A4'] as const).map((pp) => (
                    <button
                      key={pp}
                      className={`btn h-11 justify-center ${st === 'form' && pp === 'A3' ? 'btn-primary' : ''}`}
                      onClick={() => {
                        setDlg(null);
                        doExport(pp, st);
                      }}
                    >
                      {pp} 가로{st === 'form' && pp === 'A3' ? ' (기본)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {busy && (
        <div className="modal-back" style={{ alignItems: 'center' }}>
          <div className="panel px-6 py-4 text-[14px]">{busy}</div>
        </div>
      )}
      {toast.node}
    </div>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: color, border: border ? `1px solid ${border}` : undefined }} />
      {label}
    </span>
  );
}
