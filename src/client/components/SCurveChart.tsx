import { useId } from 'react';
import type { Schedule } from '../../shared/types';
import { formatDate, formatPercent } from '../format';

/** SVG 좌표계(viewBox) 크기와 그래프 영역 둘레의 여백 */
export const CHART = {
  width: 720,
  height: 340,
  left: 48,
  right: 16,
  top: 40,
  bottom: 40,
} as const;

/** 세로축 눈금(%) */
export const Y_TICKS = [0, 25, 50, 75, 100] as const;

/** 가로축에 적는 기간 이름의 최대 개수. 기간이 더 많으면 일정한 간격으로 건너뜁니다. */
const MAX_X_LABELS = 8;

export interface ChartPoint {
  /** 기간 순번(0부터) */
  index: number;
  /** 누계 값(%) */
  value: number;
  x: number;
  y: number;
}

const plotWidth = CHART.width - CHART.left - CHART.right;
const plotHeight = CHART.height - CHART.top - CHART.bottom;
const plotBottom = CHART.top + plotHeight;
const plotRight = CHART.left + plotWidth;

/**
 * 기간 순번의 가로 좌표. 그래프 영역을 기간 수만큼 같은 폭으로 나눈 칸의 가운데입니다.
 * 기간이 1개 이하이면 그래프 영역 한가운데를 돌려줍니다.
 */
export function xForIndex(index: number, periodCount: number): number {
  if (periodCount <= 1) return CHART.left + plotWidth / 2;
  return CHART.left + (plotWidth * (index + 0.5)) / periodCount;
}

/** 비율(%)의 세로 좌표. 0%가 그래프 영역 아래 끝, 100%가 위 끝이며 범위를 벗어난 값은 끝에 붙입니다. */
export function yForPercent(percent: number): number {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  return CHART.top + plotHeight * (1 - clamped / 100);
}

/** 누계 값 배열을 곡선의 점으로 바꿉니다. null인 기간은 점을 만들지 않습니다. */
export function curvePoints(values: readonly (number | null)[], periodCount: number): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (let index = 0; index < periodCount; index += 1) {
    const value = values[index];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    points.push({ index, value, x: xForIndex(index, periodCount), y: yForPercent(value) });
  }
  return points;
}

/** 점 목록을 polyline의 points 속성 문자열로 바꿉니다. */
export function toPolyline(points: readonly ChartPoint[]): string {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(' ');
}

/** 가로축 이름을 적을 기간 순번. 최대 개수를 넘지 않게 일정한 간격으로 고릅니다. */
export function xLabelIndexes(periodCount: number, maxLabels: number = MAX_X_LABELS): number[] {
  if (periodCount <= 0) return [];
  const step = Math.max(1, Math.ceil(periodCount / Math.max(1, maxLabels)));
  const indexes: number[] = [];
  for (let index = 0; index < periodCount; index += step) indexes.push(index);
  return indexes;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const PLAN_COLOR = 'var(--color-plan, #2563eb)';
const ACTUAL_COLOR = 'var(--color-actual, #c2410c)';
const AXIS_COLOR = 'var(--color-axis, #6b7280)';
const GRID_COLOR = 'var(--color-grid, #e5e7eb)';
const TEXT_COLOR = 'var(--color-text-muted, #4b5563)';
const SURFACE_COLOR = 'var(--color-surface, #ffffff)';

interface SCurveChartProps {
  schedule: Schedule;
}

/**
 * S-Curve: 가로축은 기간, 세로축은 0~100%인 누계 그래프입니다.
 * 계획 누계는 실선으로, 실적 누계는 다른 색 실선과 점으로 그리고 기준일이 속한 기간에 세로선을 긋습니다.
 */
export default function SCurveChart({ schedule }: SCurveChartProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  const { periods, totals, summary, asOf, asOfPeriodIndex, unit } = schedule;
  const count = periods.length;
  const plan = curvePoints(totals.cumulativePlanned, count);
  const actual = curvePoints(totals.cumulativeActual, count);
  const asOfX =
    asOfPeriodIndex !== null && asOfPeriodIndex >= 0 && asOfPeriodIndex < count
      ? xForIndex(asOfPeriodIndex, count)
      : null;

  const unitLabel = unit === 'week' ? '주' : '월';
  const description =
    count === 0
      ? '표시할 기간이 없습니다.'
      : `가로축은 ${unitLabel} 단위 기간 ${count}개, 세로축은 0%부터 100%까지의 누계 공정률입니다. ` +
        `기준일 ${formatDate(asOf)} 현재 계획 누계 ${formatPercent(summary.plannedToDate)}, ` +
        `실적 누계 ${formatPercent(summary.actualToDate)}입니다.`;

  // 기준일 이름표가 그래프 밖으로 나가지 않게 양 끝에서는 정렬 방향을 바꿉니다.
  const asOfAnchor = asOfX === null ? 'middle' : asOfX < CHART.left + 40 ? 'start' : asOfX > plotRight - 40 ? 'end' : 'middle';

  return (
    <figure className="scurve" style={{ margin: '1rem 0' }}>
      <svg
        className="scurve-svg"
        data-testid="scurve"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        style={{ display: 'block', width: '100%', maxWidth: '60rem', height: 'auto' }}
        fontFamily="inherit"
        fontSize="11"
      >
        <title id={titleId}>S-Curve (계획·실적 누계 그래프)</title>
        <desc id={descId}>{description}</desc>

        {/* 범례 */}
        <g className="scurve-legend" data-testid="scurve-legend">
          <line x1={CHART.left} y1={16} x2={CHART.left + 24} y2={16} stroke={PLAN_COLOR} strokeWidth={2} />
          <text x={CHART.left + 30} y={20} fill={TEXT_COLOR} fontSize="12">
            계획
          </text>
          <line x1={CHART.left + 72} y1={16} x2={CHART.left + 96} y2={16} stroke={ACTUAL_COLOR} strokeWidth={2} />
          <circle cx={CHART.left + 84} cy={16} r={4} fill={ACTUAL_COLOR} stroke={SURFACE_COLOR} strokeWidth={1.5} />
          <text x={CHART.left + 102} y={20} fill={TEXT_COLOR} fontSize="12">
            실적
          </text>
        </g>

        {/* 세로축 눈금과 가로 격자선 */}
        {Y_TICKS.map((tick) => {
          const y = yForPercent(tick);
          return (
            <g key={tick} data-testid="scurve-y-tick">
              <line x1={CHART.left} y1={y} x2={plotRight} y2={y} stroke={tick === 0 ? AXIS_COLOR : GRID_COLOR} strokeWidth={1} />
              <text x={CHART.left - 8} y={y + 4} textAnchor="end" fill={TEXT_COLOR}>
                {tick}%
              </text>
            </g>
          );
        })}
        <line x1={CHART.left} y1={CHART.top} x2={CHART.left} y2={plotBottom} stroke={AXIS_COLOR} strokeWidth={1} />

        {/* 가로축 눈금 */}
        {xLabelIndexes(count).map((index) => {
          const x = xForIndex(index, count);
          return (
            <g key={periods[index].key} data-testid="scurve-x-tick">
              <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 5} stroke={AXIS_COLOR} strokeWidth={1} />
              <text x={x} y={plotBottom + 18} textAnchor="middle" fill={TEXT_COLOR}>
                {periods[index].label}
              </text>
            </g>
          );
        })}

        {/* 기준일이 속한 기간 */}
        {asOfX !== null && (
          <g className="scurve-asof" data-testid="scurve-asof">
            <line
              x1={asOfX}
              y1={CHART.top}
              x2={asOfX}
              y2={plotBottom}
              stroke={AXIS_COLOR}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text x={asOfX} y={CHART.top - 6} textAnchor={asOfAnchor} fill={TEXT_COLOR}>
              기준일 {formatDate(asOf)}
            </text>
          </g>
        )}

        {/* 계획 누계 */}
        {plan.length > 0 && (
          <polyline
            data-testid="scurve-plan"
            points={toPolyline(plan)}
            fill="none"
            stroke={PLAN_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* 점이 하나뿐이면 선이 보이지 않으므로 점으로 표시합니다. */}
        {plan.length === 1 && <circle cx={plan[0].x} cy={plan[0].y} r={3} fill={PLAN_COLOR} />}

        {/* 실적 누계 */}
        {actual.length > 0 && (
          <polyline
            data-testid="scurve-actual"
            points={toPolyline(actual)}
            fill="none"
            stroke={ACTUAL_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {actual.map((point) => (
          <circle
            key={point.index}
            data-testid="scurve-actual-point"
            cx={round(point.x)}
            cy={round(point.y)}
            r={4}
            fill={ACTUAL_COLOR}
            stroke={SURFACE_COLOR}
            strokeWidth={1.5}
          >
            <title>
              {periods[point.index].label} 실적 누계 {formatPercent(point.value)}
            </title>
          </circle>
        ))}
      </svg>
      {count === 0 && <figcaption className="state state-empty">표시할 기간이 없습니다.</figcaption>}
    </figure>
  );
}
