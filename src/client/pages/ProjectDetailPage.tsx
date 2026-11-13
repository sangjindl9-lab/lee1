import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidDate } from '../../shared/dates';
import type { PeriodUnit, Schedule, ScheduleRow, Task } from '../../shared/types';
import { ApiError, api, errorMessage, type ProjectDetail } from '../api';
import BohalTable from '../components/BohalTable';
import ProgressDialog from '../components/ProgressDialog';
import SCurveChart from '../components/SCurveChart';
import ScheduleToolbar from '../components/ScheduleToolbar';
import SummaryCards from '../components/SummaryCards';
import TaskForm from '../components/TaskForm';
import TaskTable from '../components/TaskTable';
import { formatDateRange, todayString, weightBasisLabel } from '../format';
import type { Notify } from './ProjectListPage';

interface ProjectDetailPageProps {
  projectId: string;
  notify: Notify;
}

type TabKey = 'tasks' | 'schedule';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tasks', label: '공종 관리' },
  { key: 'schedule', label: '보할 공정표' },
];

interface PageData {
  detail: ProjectDetail;
  schedule: Schedule;
}

type FormState = { mode: 'create' } | { mode: 'edit'; row: ScheduleRow } | null;

/** 프로젝트 상세 화면(#/projects/:id): 프로젝트 정보와 '공종 관리', '보할 공정표' 탭 */
export default function ProjectDetailPage({ projectId, notify }: ProjectDetailPageProps) {
  const [data, setData] = useState<PageData | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [tab, setTab] = useState<TabKey>('tasks');
  const [form, setForm] = useState<FormState>(null);
  const [progressTaskId, setProgressTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 보할 공정표 탭: 기간 단위와 기준일에 따라 따로 조회한 공정표
  const [unit, setUnit] = useState<PeriodUnit>('month');
  const [asOf, setAsOf] = useState(() => todayString());
  const [view, setView] = useState<Schedule | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewRetry, setViewRetry] = useState(0);

  // 늦게 도착한 이전 응답이 최신 화면을 덮어쓰지 않도록 요청 순번을 셉니다.
  const requestSeq = useRef(0);

  const fetchData = useCallback(async (): Promise<PageData> => {
    const [detail, schedule] = await Promise.all([api.getProject(projectId), api.getSchedule(projectId)]);
    return { detail, schedule };
  }, [projectId]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadError(null);
    setData(null);
    try {
      const next = await fetchData();
      if (seq === requestSeq.current) setData(next);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setLoadError({
        message: errorMessage(error),
        notFound: error instanceof ApiError && error.status === 404,
      });
    }
  }, [fetchData]);

  /** 저장·삭제·순서 변경 뒤 화면을 비우지 않고 보할과 진척률을 다시 불러옵니다. */
  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const next = await fetchData();
      if (seq === requestSeq.current) setData(next);
    } catch (error) {
      if (seq === requestSeq.current) notify('error', errorMessage(error));
    }
  }, [fetchData, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // 보할 공정표 탭을 열거나 기간 단위·기준일이 바뀌면 공정표를 다시 조회합니다.
  // 기준일 입력란이 비어 있는 동안에는 조회하지 않고 마지막 표를 그대로 둡니다.
  useEffect(() => {
    if (tab !== 'schedule' || !isValidDate(asOf)) return;
    let cancelled = false;
    setViewError(null);
    api
      .getSchedule(projectId, { unit, asOf })
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setViewError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, projectId, unit, asOf, viewRetry]);

  const closeForm = useCallback(() => setForm(null), []);
  const closeProgress = useCallback(() => setProgressTaskId(null), []);
  const notifyError = useCallback((message: string) => notify('error', message), [notify]);

  function handleTaskSaved(saved: Task) {
    const wasEdit = form?.mode === 'edit';
    setForm(null);
    notify('success', `'${saved.name}' 공종을 ${wasEdit ? '수정했습니다' : '추가했습니다'}.`);
    void reload();
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteTask(projectId, deleteTarget.taskId);
      notify('success', `'${deleteTarget.name}' 공종을 삭제했습니다.`);
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  const backLink = (
    <a className="back-link" href="#/">
      ← 프로젝트 목록으로
    </a>
  );

  if (loadError) {
    return (
      <section className="page">
        {backLink}
        <div className="state state-error" role="alert">
          <p>프로젝트를 불러오지 못했습니다.</p>
          <p>{loadError.message}</p>
          {!loadError.notFound && (
            <button type="button" className="btn" onClick={() => void load()}>
              다시 시도
            </button>
          )}
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="page">
        {backLink}
        <p className="state state-loading" role="status">
          프로젝트를 불러오는 중입니다…
        </p>
      </section>
    );
  }

  const { detail, schedule } = data;
  const { project } = detail;
  const progressRow = progressTaskId ? schedule.rows.find((row) => row.taskId === progressTaskId) : undefined;

  return (
    <section className="page">
      {backLink}
      <div className="page-header">
        <h2 className="page-title">{project.name}</h2>
      </div>
      {project.description && <p className="page-description">{project.description}</p>}
      <dl className="project-info">
        <div>
          <dt>기간</dt>
          <dd>{formatDateRange(project.startDate, project.endDate)}</dd>
        </div>
        <div>
          <dt>보할 기준</dt>
          <dd>{weightBasisLabel(project.weightBasis)}</dd>
        </div>
        <div>
          <dt>공종 수</dt>
          <dd>{schedule.rows.length}개</dd>
        </div>
      </dl>

      <div className="tabs" role="tablist" aria-label="프로젝트 상세">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            className={`tab${tab === key ? ' tab-active' : ''}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <div className="tab-panel" role="tabpanel" id="panel-tasks" aria-labelledby="tab-tasks">
          <div className="panel-toolbar">
            <button type="button" className="btn btn-primary" onClick={() => setForm({ mode: 'create' })}>
              공종 추가
            </button>
          </div>
          <TaskTable
            schedule={schedule}
            onProgress={(row) => setProgressTaskId(row.taskId)}
            onEdit={(row) => setForm({ mode: 'edit', row })}
            onDelete={setDeleteTarget}
            onChanged={reload}
            onError={notifyError}
          />
        </div>
      )}

      {tab === 'schedule' && (
        <div className="tab-panel" role="tabpanel" id="panel-schedule" aria-labelledby="tab-schedule">
          <ScheduleToolbar
            projectId={projectId}
            unit={unit}
            asOf={asOf}
            onUnitChange={setUnit}
            onAsOfChange={setAsOf}
          />
          {!isValidDate(asOf) && (
            <p className="field-error" role="alert">
              기준일을 선택하세요.
            </p>
          )}
          {viewError && (
            <div className="state state-error" role="alert">
              <p>공정표를 불러오지 못했습니다.</p>
              <p>{viewError}</p>
              <button type="button" className="btn" onClick={() => setViewRetry((count) => count + 1)}>
                다시 시도
              </button>
            </div>
          )}
          {!view && !viewError && (
            <p className="state state-loading" role="status">
              공정표를 불러오는 중입니다…
            </p>
          )}
          {view && !viewError && (
            <>
              {view.rows.length > 0 && <SummaryCards summary={view.summary} asOf={view.asOf} />}
              <BohalTable schedule={view} />
              {view.rows.length > 0 && <SCurveChart schedule={view} />}
            </>
          )}
        </div>
      )}

      {form && (
        <TaskForm
          key={form.mode === 'edit' ? form.row.taskId : 'new'}
          project={project}
          task={
            form.mode === 'edit'
              ? {
                  id: form.row.taskId,
                  category: form.row.category,
                  name: form.row.name,
                  weightValue: form.row.weightValue,
                  startDate: form.row.startDate,
                  endDate: form.row.endDate,
                }
              : undefined
          }
          onSaved={handleTaskSaved}
          onCancel={closeForm}
        />
      )}

      {progressRow && (
        <ProgressDialog
          key={progressRow.taskId}
          projectId={projectId}
          task={progressRow}
          records={detail.progress.filter((record) => record.taskId === progressRow.taskId)}
          onChanged={reload}
          onClose={closeProgress}
        />
      )}

      {deleteTarget && (
        <div className="dialog-backdrop">
          <div className="dialog dialog-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title">
            <div className="dialog-header">
              <h2 className="dialog-title" id="delete-task-title">
                공종 삭제
              </h2>
            </div>
            <div className="dialog-body">
              <p>'{deleteTarget.name}' 공종을 삭제할까요?</p>
              <p>이 공종의 실적 기록도 함께 삭제되며 되돌릴 수 없습니다.</p>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                취소
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
