import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SummaryCards from '../../src/client/components/SummaryCards';
import type { ProgressRecord, Schedule } from '../../src/shared/types';
import { exampleData, makeSchedule } from './helpers';

function card(testId: string) {
  return within(screen.getByTestId(testId));
}

function renderSummary(progress: ProgressRecord[], asOf: string): Schedule {
  const schedule = makeSchedule({ ...exampleData(), progress }, asOf);
  render(<SummaryCards summary={schedule.summary} asOf={schedule.asOf} />);
  return schedule;
}

describe('SummaryCards', () => {
  it('계획 누계, 실적 누계, 편차, 상태 "앞섬"을 표시한다 (AC-F7-1)', () => {
    renderSummary(
      [
        { id: 'r1', taskId: 'a', date: '2026-01-31', percent: 100 },
        { id: 'r2', taskId: 'b', date: '2026-02-28', percent: 50 },
      ],
      '2026-02-28',
    );

    expect(screen.getByRole('region', { name: '진도 요약' })).toBeInTheDocument();
    expect(card('summary-planned').getByText('계획 누계')).toBeInTheDocument();
    expect(card('summary-planned').getByText('78.98%')).toBeInTheDocument();
    expect(card('summary-actual').getByText('실적 누계')).toBeInTheDocument();
    expect(card('summary-actual').getByText('80.00%')).toBeInTheDocument();
    expect(card('summary-variance').getByText('+1.02%p')).toBeInTheDocument();
    const badge = card('summary-status').getByText('앞섬');
    expect(badge).toHaveClass('badge', 'badge-ahead');
    expect(screen.getByText('2026.02.28 현재')).toBeInTheDocument();
  });

  it('실적 기록 없이 기준일이 2026-01-16이면 계획 30.97%, 실적 0.00%, 상태 "지연"이다 (AC-F7-2)', () => {
    renderSummary([], '2026-01-16');

    expect(card('summary-planned').getByText('30.97%')).toBeInTheDocument();
    expect(card('summary-actual').getByText('0.00%')).toBeInTheDocument();
    expect(card('summary-variance').getByText('-30.97%p')).toBeInTheDocument();
    expect(card('summary-status').getByText('지연')).toHaveClass('badge-behind');
  });

  it('편차가 -1%p 초과 +1%p 미만이면 상태가 "정상"이다 (AC-F7-3)', () => {
    // 계획 30.97%, 실적 60 × 52% = 31.20% → 편차 +0.23%p
    const schedule = renderSummary([{ id: 'r1', taskId: 'a', date: '2026-01-16', percent: 52 }], '2026-01-16');

    expect(Math.abs(schedule.summary.variance)).toBeLessThan(1);
    expect(card('summary-actual').getByText('31.20%')).toBeInTheDocument();
    expect(card('summary-variance').getByText('+0.23%p')).toBeInTheDocument();
    expect(card('summary-status').getByText('정상')).toHaveClass('badge-onTrack');
  });

  it('편차가 음수여도 1%p 미만이면 "정상"이고 부호를 표시한다 (AC-F7-3)', () => {
    // 계획 30.97%, 실적 60 × 51% = 30.60% → 편차 -0.37%p
    renderSummary([{ id: 'r1', taskId: 'a', date: '2026-01-16', percent: 51 }], '2026-01-16');

    expect(card('summary-variance').getByText('-0.37%p')).toBeInTheDocument();
    expect(card('summary-status').getByText('정상')).toBeInTheDocument();
  });

  it('편차가 0이면 부호 없이 0.00%p로 표시하고 기준일이 없으면 날짜 문구를 생략한다', () => {
    render(<SummaryCards summary={{ plannedToDate: 0, actualToDate: 0, variance: 0, status: 'onTrack' }} />);

    expect(card('summary-variance').getByText('0.00%p')).toBeInTheDocument();
    expect(screen.queryByText(/현재$/)).not.toBeInTheDocument();
  });
});
