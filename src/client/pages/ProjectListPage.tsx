import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectSummary } from '../../shared/types';
import { api, errorMessage } from '../api';
import ProjectForm from '../components/ProjectForm';
import { formatDateRange, formatNumber, formatPercent, statusLabel } from '../format';

export type Notify = (type: 'success' | 'error', message: string) => void;

interface ProjectListPageProps {
  notify: Notify;
}

type FormState = { mode: 'create' } | { mode: 'edit'; project: ProjectSummary } | null;

function ProgressBar({ label, value, kind }: { label: string; value: number; kind: 'planned' | 'actual' }) {
  const width = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const text = formatPercent(value);
  return (
    <div className="progress-row">
      <span className="progress-label">{label}</span>
      <div
        className={`progress-bar progress-bar-${kind}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-valuetext={text}
      >
        <div className="progress-bar-fill" style={{ width: `${width}%` }} />
      </div>
      <span className="progress-value">{text}</span>
    </div>
  );
}

/** 프로젝트 목록 화면(#/) */
export default function ProjectListPage({ notify }: ProjectListPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProjects(await api.listProjects());
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeForm = useCallback(() => setForm(null), []);

  function handleSaved(saved: Project) {
    const wasEdit = form?.mode === 'edit';
    setForm(null);
    notify('success', `'${saved.name}' 프로젝트를 ${wasEdit ? '수정했습니다' : '만들었습니다'}.`);
    void load();
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteProject(deleteTarget.id);
      setProjects((current) => current?.filter((item) => item.id !== deleteTarget.id) ?? current);
      notify('success', `'${deleteTarget.name}' 프로젝트를 삭제했습니다.`);
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  let content;
  if (loadError) {
    content = (
      <div className="state state-error" role="alert">
        <p>프로젝트 목록을 불러오지 못했습니다.</p>
        <p>{loadError}</p>
        <button type="button" className="btn" onClick={() => void load()}>
          다시 시도
        </button>
      </div>
    );
  } else if (projects === null) {
    content = (
      <p className="state state-loading" role="status">
        프로젝트 목록을 불러오는 중입니다…
      </p>
    );
  } else if (projects.length === 0) {
    content = (
      <div className="state state-empty">
        <p>아직 등록된 프로젝트가 없습니다.</p>
        <p>새 프로젝트를 만들어 보할 공정표를 작성해 보세요.</p>
        <button type="button" className="btn btn-primary" onClick={() => setForm({ mode: 'create' })}>
          첫 프로젝트 만들기
        </button>
      </div>
    );
  } else {
    content = (
      <ul className="card-list">
        {projects.map((project) => (
          <li key={project.id} className="card project-card" data-testid="project-card">
            <a className="card-link" href={`#/projects/${encodeURIComponent(project.id)}`}>
              <div className="card-header">
                <h3 className="card-title">{project.name}</h3>
                <span className={`badge badge-${project.status}`}>{statusLabel(project.status)}</span>
              </div>
              <dl className="card-meta">
                <div>
                  <dt>기간</dt>
                  <dd>{formatDateRange(project.startDate, project.endDate)}</dd>
                </div>
                <div>
                  <dt>공종 수</dt>
                  <dd>{formatNumber(project.taskCount)}개</dd>
                </div>
              </dl>
              <ProgressBar label="계획 누계" value={project.plannedToDate} kind="planned" />
              <ProgressBar label="실적 누계" value={project.actualToDate} kind="actual" />
            </a>
            <div className="card-actions">
              <button
                type="button"
                className="btn btn-small"
                aria-label={`${project.name} 수정`}
                onClick={() => setForm({ mode: 'edit', project })}
              >
                수정
              </button>
              <button
                type="button"
                className="btn btn-small btn-danger"
                aria-label={`${project.name} 삭제`}
                onClick={() => setDeleteTarget(project)}
              >
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="page">
      <div className="page-header">
        <h2 className="page-title">프로젝트 목록</h2>
        <button type="button" className="btn btn-primary" onClick={() => setForm({ mode: 'create' })}>
          새 프로젝트
        </button>
      </div>

      {content}

      {form && (
        <ProjectForm
          project={form.mode === 'edit' ? form.project : undefined}
          onSaved={handleSaved}
          onCancel={closeForm}
        />
      )}

      {deleteTarget && (
        <div className="dialog-backdrop">
          <div className="dialog dialog-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="dialog-header">
              <h2 className="dialog-title" id="delete-title">
                프로젝트 삭제
              </h2>
            </div>
            <div className="dialog-body">
              <p>'{deleteTarget.name}' 프로젝트를 삭제할까요?</p>
              <p>소속된 공종과 실적 기록도 함께 삭제되며 되돌릴 수 없습니다.</p>
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
