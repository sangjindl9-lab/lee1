import type { PeriodUnit } from '../../shared/types';
import { scheduleCsvUrl } from '../api';

const UNITS: { key: PeriodUnit; label: string }[] = [
  { key: 'month', label: '월' },
  { key: 'week', label: '주' },
];

interface ScheduleToolbarProps {
  projectId: string;
  unit: PeriodUnit;
  /** 기준일(YYYY-MM-DD). 입력란을 비우면 빈 문자열입니다. */
  asOf: string;
  onUnitChange: (unit: PeriodUnit) => void;
  onAsOfChange: (asOf: string) => void;
}

/** 보할 공정표 도구 모음: 기간 단위 전환, 기준일 선택, CSV 내려받기, 인쇄 */
export default function ScheduleToolbar({ projectId, unit, asOf, onUnitChange, onAsOfChange }: ScheduleToolbarProps) {
  return (
    <div className="schedule-toolbar no-print">
      <div className="segmented" role="group" aria-label="기간 단위">
        {UNITS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`btn segmented-item${unit === key ? ' segmented-active' : ''}`}
            aria-pressed={unit === key}
            onClick={() => {
              if (unit !== key) onUnitChange(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="toolbar-field">
        <span className="toolbar-label">기준일</span>
        <input
          type="date"
          className="input"
          value={asOf}
          onChange={(event) => onAsOfChange(event.target.value)}
        />
      </label>

      <div className="toolbar-actions">
        {/* 지금 화면에 보이는 기간 단위와 기준일 그대로 내려받습니다. */}
        <a className="btn" href={scheduleCsvUrl(projectId, { unit, asOf })} download>
          CSV 내려받기
        </a>
        <button type="button" className="btn" onClick={() => window.print()}>
          인쇄
        </button>
      </div>
    </div>
  );
}
