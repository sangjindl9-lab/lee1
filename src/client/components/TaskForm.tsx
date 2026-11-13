import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Project, Task } from '../../shared/types';
import { validateTask, type FieldErrors } from '../../shared/validation';
import { ApiError, api, errorMessage, type TaskPayload } from '../api';
import { formatDateRange, weightBasisLabel } from '../format';

/** 수정 대화상자를 채우는 데 필요한 공종 값 */
export type TaskFormValue = Pick<Task, 'id' | 'category' | 'name' | 'weightValue' | 'startDate' | 'endDate'>;

interface TaskFormProps {
  /** 공종이 속한 프로젝트. 기간 검증과 금액/가중치 입력란 이름에 씁니다. */
  project: Project;
  /** 수정할 공종. 없으면 새 공종을 추가합니다. */
  task?: TaskFormValue;
  onSaved: (task: Task) => void;
  onCancel: () => void;
}

/** "1,000,000"처럼 쉼표를 넣어 입력해도 숫자로 읽습니다. 숫자가 아니면 NaN입니다. */
export function parseNumberInput(text: string): number {
  const cleaned = text.replace(/,/g, '').trim();
  return cleaned === '' ? Number.NaN : Number(cleaned);
}

/** 공종 추가·수정 대화상자 */
export default function TaskForm({ project, task, onSaved, onCancel }: TaskFormProps) {
  const isEdit = task !== undefined;
  const [category, setCategory] = useState(task?.category ?? '');
  const [name, setName] = useState(task?.name ?? '');
  const [weightText, setWeightText] = useState(task ? String(task.weightValue) : '');
  const [startDate, setStartDate] = useState(task?.startDate ?? project.startDate);
  const [endDate, setEndDate] = useState(task?.endDate ?? project.endDate);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const weightLabel = weightBasisLabel(project.weightBasis);

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

    const payload: TaskPayload = {
      category: category.trim(),
      name: name.trim(),
      weightValue: parseNumberInput(weightText),
      startDate,
      endDate,
    };

    // 서버와 같은 규칙으로 먼저 검사하고, 오류가 있으면 요청을 보내지 않습니다.
    const found = validateTask(payload, project);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const saved = isEdit
        ? await api.updateTask(project.id, task.id, payload)
        : await api.createTask(project.id, payload);
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
              {isEdit ? '공종 수정' : '공종 추가'}
            </h2>
          </div>

          <div className="dialog-body">
            {formError && (
              <p className="alert alert-error" role="alert">
                {formError}
              </p>
            )}

            <p className="form-hint">프로젝트 기간: {formatDateRange(project.startDate, project.endDate)}</p>

            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-category`}>구분</label>
                <input
                  {...fieldProps('category')}
                  type="text"
                  value={category}
                  maxLength={100}
                  onChange={(event) => setCategory(event.target.value)}
                />
                {fieldError('category')}
              </div>

              <div className="field">
                <label htmlFor={`${id}-name`}>공종명</label>
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
            </div>

            <div className="field">
              <label htmlFor={`${id}-weightValue`}>{weightLabel}</label>
              <input
                {...fieldProps('weightValue')}
                type="text"
                inputMode="decimal"
                value={weightText}
                onChange={(event) => setWeightText(event.target.value)}
              />
              {fieldError('weightValue')}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-startDate`}>시작일</label>
                <input
                  {...fieldProps('startDate')}
                  type="date"
                  value={startDate}
                  min={project.startDate}
                  max={project.endDate}
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
                  min={project.startDate}
                  max={project.endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                {fieldError('endDate')}
              </div>
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
