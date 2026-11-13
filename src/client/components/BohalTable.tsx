import type { CSSProperties } from 'react';
import { diffDays, inclusiveDays, overlapDays } from '../../shared/dates';
import type { Period, Schedule, ScheduleRow } from '../../shared/types';
import { formatDate, formatNumber, formatPercent, formatRate, weightBasisLabel } from '../format';
import { NO_TASKS_MESSAGE } from './TaskTable';

/** 기준일이 속한 기간 열에 붙는 강조 클래스 */
export const AS_OF_CLASS = 'bohal-asof';

/** 기간 열 앞에 오는 고정 열 수 */
const FIXED_COLUMN_COUNT = 7;

interface BohalTableProps {
  schedule: Schedule;
}

/** 기간 칸 안에서 공종이 작업하는 날짜 범위만큼 막대의 위치와 길이를 정합니다. */
function barStyle(row: ScheduleRow, period: Period): CSSProperties {
  const periodDays = inclusiveDays(period.start, period.end);
  const offsetDays = Math.max(0, diffDays(period.start, row.startDate));
  const workDays = overlapDays(row.startDate, row.endDate, period.start, period.end);
  return {
    // 스타일시트가 없어도 막대가 보이도록 기본 모양을 함께 지정합니다.
    display: 'block',
    height: '0.5rem',
    borderRadius: '2px',
    background: 'var(--color-bar, #2563eb)',
    marginLeft: `${(offsetDays / periodDays) * 100}%`,
    width: `${(workDays / periodDays) * 100}%`,
  };
}

/**
 * 보할 공정표: 왼쪽 고정 열(구분~진척률)과 기간 열을 가진 가로 스크롤 표입니다.
 * 작업 기간에 해당하는 칸에는 막대와 계획값을, 하단에는 기간·누계의 계획과 실적 4행을 표시합니다.
 */
export default function BohalTable({ schedule }: BohalTableProps) {
  const { rows, periods, totals, project, asOfPeriodIndex } = schedule;

  if (rows.length === 0) {
    return <p className="state state-empty">{NO_TASKS_MESSAGE}</p>;
  }

  const periodClass = (index: number, base: string) =>
    `${base}${index === asOfPeriodIndex ? ` ${AS_OF_CLASS}` : ''}`;

  const totalRows: { label: string; values: (number | null)[] }[] = [
    { label: '기간 계획', values: totals.periodPlanned },
    { label: '누계 계획', values: totals.cumulativePlanned },
    { label: '기간 실적', values: totals.periodActual },
    { label: '누계 실적', values: totals.cumulativeActual },
  ];

  return (
    <div className="table-wrap bohal-wrap">
      <table className="bohal-table">
        <caption className="visually-hidden">
          보할 공정표 ({schedule.unit === 'week' ? '주' : '월'} 단위, 기준일 {formatDate(schedule.asOf)})
        </caption>
        <thead>
          <tr>
            <th scope="col" className="bohal-fixed bohal-fixed-category">
              구분
            </th>
            <th scope="col" className="bohal-fixed bohal-fixed-name">
              공종명
            </th>
            <th scope="col" className="num">
              {weightBasisLabel(project.weightBasis)}
            </th>
            <th scope="col" className="num">
              보할(%)
            </th>
            <th scope="col">시작일</th>
            <th scope="col">종료일</th>
            <th scope="col" className="num">
              진척률
            </th>
            {periods.map((period, index) => (
              <th
                key={period.key}
                scope="col"
                className={periodClass(index, 'bohal-period')}
                data-testid="bohal-period-header"
                aria-current={index === asOfPeriodIndex ? 'date' : undefined}
                title={`${formatDate(period.start)} ~ ${formatDate(period.end)}`}
              >
                {period.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.taskId} data-testid="bohal-row">
              <td className="bohal-fixed bohal-fixed-category">{row.category}</td>
              <th scope="row" className="bohal-fixed bohal-fixed-name">
                {row.name}
              </th>
              <td className="num">{formatNumber(row.weightValue)}</td>
              <td className="num">{formatPercent(row.bohal)}</td>
              <td>{formatDate(row.startDate)}</td>
              <td>{formatDate(row.endDate)}</td>
              <td className="num">{formatPercent(row.currentPercent)}</td>
              {periods.map((period, index) => {
                const planned = row.planned[index] ?? null;
                return (
                  <td key={period.key} className={periodClass(index, 'bohal-cell')} data-testid="bohal-cell">
                    {planned !== null && (
                      <>
                        <span className="bohal-bar" data-testid="bohal-bar" style={barStyle(row, period)} />
                        <span className="bohal-value">{formatRate(planned)}</span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {totalRows.map(({ label, values }) => (
            <tr key={label} data-testid="bohal-total-row">
              <th scope="row" colSpan={FIXED_COLUMN_COUNT} className="bohal-fixed bohal-total-label">
                {label}
              </th>
              {periods.map((period, index) => (
                <td key={period.key} className={periodClass(index, 'bohal-cell num')}>
                  {formatRate(values[index])}
                </td>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
