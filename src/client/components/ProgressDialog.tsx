import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ProgressRecord } from '../../shared/types';
import { validateProgress, type FieldErrors } from '../../shared/validation';
import { ApiError, api, errorMessage, type ProgressPayload } from '../api';
import { formatDate, formatPercent, todayString } from '../format';
import { parseNumberInput } from './TaskForm';

interface ProgressDialogProps {
  projectId: string;
  task: { taskId: string; name: string };
  /** 이 공종의 실적 기록 */
  records: ProgressRecord[];
  /** 저장·삭제 뒤 호출합니다. 받은 쪽에서 데이터를 다시 불러와 records를 새로 내려 줍니다. */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}

/** 실적 입력 대화상자: 선택한 공종의 실적 기록 목록과 새 기록(날짜, 누계 진척률) 입력 */
export default function ProgressDialog({ projectId, task, records, onChanged, onClose }: ProgressDialogProps) {
  const [date, setDate] = useState(() => todayString());
  const [percentText, setPercentText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = useId();
  const percentRef = useRef<HTMLInputElement>(null);
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

  useEffect(() => {
    percentRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const payload: ProgressPayload = { date, percent: parseNumberInput(percentText) };

    // 서버와 같은 규칙으로 먼저 검사하고, 오류가 있으면 요청을 보내지 않습니다.
    const found = validateProgress(payload, records);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await api.saveProgress(projectId, task.taskId, payload);
      setPercentText('');
      await onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
      if (error instanceof ApiError) setErrors(error.fields);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(record: ProgressRecord) {
    if (busy) return;
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await api.deleteProgress(projectId, task.taskId, record.date);
      await onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
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
        <div className="dialog-header">
          <h2 className="dialog-title" id={`${id}-title`}>
            실적 입력 — {task.name}
          </h2>
        </div>

        <div className="dialog-body">
          {formError && (
            <p className="alert alert-error" role="alert">
              {formError}
            </p>
          )}

          {sorted.length === 0 ? (
            <p className="table-empty">등록된 실적 기록이 없습니다.</p>
          ) : (
            <table className="progress-table">
              <thead>
                <tr>
                  <th scope="col">날짜</th>
                  <th scope="col" className="num">
                    누계 진척률
                  </th>
                  <th scope="col">동작</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((record) => (
                  <tr key={record.date} data-testid="progress-row">
                    <td>{formatDate(record.date)}</td>
                    <td className="num">{formatPercent(record.percent)}</td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-small btn-danger"
                        aria-label={`${formatDate(record.date)} 실적 삭제`}
                        disabled={busy}
                        onClick={() => void handleDelete(record)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form className="form" onSubmit={handleSubmit} noValidate>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-date`}>날짜</label>
                <input
                  {...fieldProps('date')}
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
                {fieldError('date')}
              </div>

              <div className="field">
                <label htmlFor={`${id}-percent`}>누계 진척률(%)</label>
                <input
                  {...fieldProps('percent')}
                  ref={percentRef}
                  type="text"
                  inputMode="decimal"
                  value={percentText}
                  onChange={(event) => setPercentText(event.target.value)}
                />
                {fieldError('percent')}
              </div>
            </div>
            <p className="form-hint">
              그 날짜까지의 누계 진척률을 0~100으로 입력합니다. 같은 날짜로 다시 저장하면 값이 바뀝니다. 공종 표의
              현재 진척률은 오늘까지의 기록으로 계산합니다.
            </p>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                실적 저장
              </button>
            </div>
          </form>
        </div>

        <div className="dialog-footer">
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
