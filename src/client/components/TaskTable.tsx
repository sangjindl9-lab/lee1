import { useState } from 'react';
import type { Schedule, ScheduleRow } from '../../shared/types';
import { api, errorMessage } from '../api';
import { formatDate, formatNumber, formatPercent, weightBasisLabel } from '../format';

export const NO_TASKS_MESSAGE = '등록된 공종이 없습니다.';

interface TaskTableProps {
  /** schedule API 응답. 표의 모든 값(보할, 현재 진척률, 합계)을 여기서 가져옵니다. */
  schedule: Schedule;
  onProgress: (row: ScheduleRow) => void;
  onEdit: (row: ScheduleRow) => void;
  onDelete: (row: ScheduleRow) => void;
  /** 순서를 바꾼 뒤 호출합니다. 받은 쪽에서 데이터를 다시 불러옵니다. */
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}

/** 공종 관리 표: 공종별 금액(가중치)·보할·기간·현재 진척률과 합계 행 */
export default function TaskTable({ schedule, onProgress, onEdit, onDelete, onChanged, onError }: TaskTableProps) {
  const [moving, setMoving] = useState(false);
  const { rows, totals, project } = schedule;
  const weightLabel = weightBasisLabel(project.weightBasis);

  async function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (moving || target < 0 || target >= rows.length) return;

    const taskIds = rows.map((row) => row.taskId);
    [taskIds[index], taskIds[target]] = [taskIds[target], taskIds[index]];

    setMoving(true);
    try {
      await api.reorderTasks(project.id, taskIds);
      await onChanged();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="table-wrap">
      <table className="task-table">
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">공종명</th>
            <th scope="col" className="num">
              {weightLabel}
            </th>
            <th scope="col" className="num">
              보할(%)
            </th>
            <th scope="col">시작일</th>
            <th scope="col">종료일</th>
            <th scope="col" className="num">
              현재 진척률
            </th>
            <th scope="col">동작</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="table-empty">
                {NO_TASKS_MESSAGE}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.taskId} data-testid="task-row">
              <td>{row.category}</td>
              <th scope="row">{row.name}</th>
              <td className="num">{formatNumber(row.weightValue)}</td>
              <td className="num">{formatPercent(row.bohal)}</td>
              <td>{formatDate(row.startDate)}</td>
              <td>{formatDate(row.endDate)}</td>
              <td className="num">{formatPercent(row.currentPercent)}</td>
              <td className="actions">
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`${row.name} 위로`}
                  disabled={moving || index === 0}
                  onClick={() => void move(index, -1)}
                >
                  위로
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`${row.name} 아래로`}
                  disabled={moving || index === rows.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  아래로
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`${row.name} 실적 입력`}
                  onClick={() => onProgress(row)}
                >
                  실적 입력
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`${row.name} 수정`}
                  onClick={() => onEdit(row)}
                >
                  수정
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  aria-label={`${row.name} 삭제`}
                  onClick={() => onDelete(row)}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="task-total-row">
            <th scope="row" colSpan={2}>
              합계
            </th>
            <td className="num">{formatNumber(totals.weightValue)}</td>
            <td className="num">{formatPercent(totals.bohal)}</td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
