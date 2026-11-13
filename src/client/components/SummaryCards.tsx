import type { CSSProperties } from 'react';
import type { Schedule } from '../../shared/types';
import { formatDate, formatPercent, formatVariance, statusLabel } from '../format';

interface SummaryCardsProps {
  summary: Schedule['summary'];
  /** 기준일(YYYY-MM-DD). 주면 제목 옆에 함께 표시합니다. */
  asOf?: string;
}

// 스타일시트가 없어도 카드가 한 줄로 나란히 보이도록 기본 배치를 함께 지정합니다.
const listStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: '0.75rem',
  margin: '0.75rem 0',
};

const cardStyle: CSSProperties = {
  border: '1px solid var(--color-border, #d1d5db)',
  borderRadius: '6px',
  padding: '0.75rem 1rem',
};

const valueStyle: CSSProperties = {
  margin: '0.25rem 0 0',
  fontSize: '1.375rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

/** 진도 요약 카드: 기준일 현재 계획 누계, 실적 누계, 편차(실적 − 계획), 상태 배지 */
export default function SummaryCards({ summary, asOf }: SummaryCardsProps) {
  const { plannedToDate, actualToDate, variance, status } = summary;

  return (
    <section className="summary-cards" aria-label="진도 요약">
      {asOf && <p className="summary-asof">{formatDate(asOf)} 현재</p>}
      <dl className="summary-list" style={listStyle}>
        <div className="summary-card" style={cardStyle} data-testid="summary-planned">
          <dt>계획 누계</dt>
          <dd className="summary-value" style={valueStyle}>
            {formatPercent(plannedToDate)}
          </dd>
        </div>
        <div className="summary-card" style={cardStyle} data-testid="summary-actual">
          <dt>실적 누계</dt>
          <dd className="summary-value" style={valueStyle}>
            {formatPercent(actualToDate)}
          </dd>
        </div>
        <div className="summary-card" style={cardStyle} data-testid="summary-variance">
          <dt>편차(실적 − 계획)</dt>
          <dd className="summary-value" style={valueStyle}>
            {formatVariance(variance)}
          </dd>
        </div>
        <div className="summary-card" style={cardStyle} data-testid="summary-status">
          <dt>상태</dt>
          <dd className="summary-value" style={valueStyle}>
            <span className={`badge badge-${status}`}>{statusLabel(status)}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
