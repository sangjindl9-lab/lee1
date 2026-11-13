import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScheduleToolbar from '../../src/client/components/ScheduleToolbar';
import type { PeriodUnit } from '../../src/shared/types';

afterEach(() => {
  vi.restoreAllMocks();
});

function renderToolbar(overrides: { projectId?: string; unit?: PeriodUnit; asOf?: string } = {}) {
  const props = {
    projectId: 'p1',
    unit: 'month' as PeriodUnit,
    asOf: '2026-02-28',
    onUnitChange: vi.fn(),
    onAsOfChange: vi.fn(),
    ...overrides,
  };
  render(<ScheduleToolbar {...props} />);
  return props;
}

describe('ScheduleToolbar', () => {
  it('기간 단위 버튼, 기준일 입력란, CSV 내려받기, 인쇄를 표시한다', () => {
    renderToolbar();

    const group = screen.getByRole('group', { name: '기간 단위' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '월' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '주' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('기준일')).toHaveValue('2026-02-28');
    expect(screen.getByLabelText('기준일')).toHaveAttribute('type', 'date');
    expect(screen.getByRole('link', { name: 'CSV 내려받기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '인쇄' })).toBeInTheDocument();
  });

  it('"주"를 누르면 week로, 이미 선택된 단위를 누르면 아무것도 알리지 않는다 (AC-F6-4)', () => {
    const { onUnitChange } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: '월' }));
    expect(onUnitChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '주' }));
    expect(onUnitChange).toHaveBeenCalledTimes(1);
    expect(onUnitChange).toHaveBeenCalledWith('week');
  });

  it('주 단위가 선택된 상태에서 "월"을 누르면 month를 알린다', () => {
    const { onUnitChange } = renderToolbar({ unit: 'week' });

    expect(screen.getByRole('button', { name: '주' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '월' }));
    expect(onUnitChange).toHaveBeenCalledWith('month');
  });

  it('기준일을 바꾸면 새 날짜를 알린다 (AC-F6-5)', () => {
    const { onAsOfChange } = renderToolbar();

    fireEvent.change(screen.getByLabelText('기준일'), { target: { value: '2026-01-31' } });
    expect(onAsOfChange).toHaveBeenCalledWith('2026-01-31');
  });

  it('CSV 링크는 현재 unit과 asOf를 쿼리로 전달한다 (AC-F8-1)', () => {
    const { unmount } = render(
      <ScheduleToolbar projectId="p1" unit="month" asOf="2026-02-28" onUnitChange={vi.fn()} onAsOfChange={vi.fn()} />,
    );
    const link = screen.getByRole('link', { name: 'CSV 내려받기' });
    expect(link).toHaveAttribute('href', '/api/projects/p1/schedule.csv?unit=month&asOf=2026-02-28');
    expect(link).toHaveAttribute('download');
    unmount();

    renderToolbar({ projectId: 'a/b', unit: 'week', asOf: '2026-01-07' });
    expect(screen.getByRole('link', { name: 'CSV 내려받기' })).toHaveAttribute(
      'href',
      '/api/projects/a%2Fb/schedule.csv?unit=week&asOf=2026-01-07',
    );
  });

  it('기준일이 비어 있으면 CSV 링크에서 asOf를 뺀다', () => {
    renderToolbar({ asOf: '' });

    expect(screen.getByRole('link', { name: 'CSV 내려받기' })).toHaveAttribute(
      'href',
      '/api/projects/p1/schedule.csv?unit=month',
    );
  });

  it('인쇄 버튼을 누르면 window.print를 호출한다', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: '인쇄' }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
