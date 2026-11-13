import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Project, WeightBasis } from '../../shared/types';
import { validateProject, type FieldErrors } from '../../shared/validation';
import { ApiError, api, errorMessage, type ProjectPayload } from '../api';

interface ProjectFormProps {
  /** 수정할 프로젝트. 없으면 새 프로젝트를 만듭니다. */
  project?: Project;
  onSaved: (project: Project) => void;
  onCancel: () => void;
}

/** 프로젝트 생성·수정 대화상자 */
export default function ProjectForm({ project, onSaved, onCancel }: ProjectFormProps) {
  const isEdit = project !== undefined;
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [endDate, setEndDate] = useState(project?.endDate ?? '');
  const [weightBasis, setWeightBasis] = useState<WeightBasis>(project?.weightBasis ?? 'amount');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const payload: ProjectPayload = {
      name: name.trim(),
      description,
      startDate,
      endDate,
      weightBasis,
    };

    // 서버와 같은 규칙으로 먼저 검사하고, 오류가 있으면 요청을 보내지 않습니다.
    const found = validateProject(payload);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const saved = isEdit ? await api.updateProject(project.id, payload) : await api.createProject(payload);
      onSaved(saved);
    } catch (error) {
      setSaving(false);
      setFormError(errorMessage(error));
      if (error instanceof ApiError) setErrors(error.fields);
    }
  }

  function fieldProps(field: string) {
    const message = errors[field];
    return {
      id: `${id}-${field}`,
      'aria-invalid': message ? true : undefined,
      'aria-describedby': message ? `${id}-${field}-error` : undefined,
    };
  }

  function fieldError(field: string) {
    const message = errors[field];
    if (!message) return null;
    return (
      <p className="field-error" id={`${id}-${field}-error`}>
        {message}
      </p>
    );
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="dialog-header">
            <h2 className="dialog-title" id={`${id}-title`}>
              {isEdit ? '프로젝트 수정' : '새 프로젝트'}
            </h2>
          </div>

          <div className="dialog-body">
            {formError && (
              <p className="alert alert-error" role="alert">
                {formError}
              </p>
            )}

            <div className="field">
              <label htmlFor={`${id}-name`}>프로젝트 이름</label>
              <input
                {...fieldProps('name')}
                ref={nameRef}
                type="text"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
              {fieldError('name')}
            </div>

            <div className="field">
              <label htmlFor={`${id}-description`}>설명</label>
              <textarea
                {...fieldProps('description')}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {fieldError('description')}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-startDate`}>시작일</label>
                <input
                  {...fieldProps('startDate')}
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
                {fieldError('startDate')}
              </div>

              <div className="field">
                <label htmlFor={`${id}-endDate`}>종료일</label>
                <input
                  {...fieldProps('endDate')}
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                {fieldError('endDate')}
              </div>
            </div>

            <div className="field">
              <label htmlFor={`${id}-weightBasis`}>보할 기준</label>
              <select
                {...fieldProps('weightBasis')}
                value={weightBasis}
                onChange={(event) => setWeightBasis(event.target.value === 'manual' ? 'manual' : 'amount')}
              >
                <option value="amount">금액 (공종 금액의 비율로 보할 계산)</option>
                <option value="manual">가중치 (직접 입력한 가중치의 비율로 보할 계산)</option>
              </select>
              {fieldError('weightBasis')}
            </div>
          </div>

          <div className="dialog-footer">
            <button type="button" className="btn" onClick={onCancel} disabled={saving}>
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
