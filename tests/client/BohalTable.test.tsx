import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BohalTable, { AS_OF_CLASS } from '../../src/client/components/BohalTable';
import { todayString } from '../../src/client/format';
import ProjectDetailPage from '../../src/client/pages/ProjectDetailPage';
import { buildSchedule } from '../../src/shared/bohal';
import type { PeriodUnit, ProgressRecord, Schedule } from '../../src/shared/types';
import {
  errorResponse,
  exampleData,
  fakeServer,
  jsonResponse,
  makeProject,
  makeTask,
  mockFetch,
  type FakeData,
  type MockHandler,
} from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function schedule(data: FakeData, unit: PeriodUnit, asOf: string): Schedule {
  const tasks = [...data.tasks].sort((x, y) => x.order - y.order);
  return buildSchedule(data.project, tasks, data.progress, unit, asOf);
}

/** AC-F5-6의 상태: 공종 A 2026-01-31 100%, 공종 B 2026-02-28 50% */
function exampleWithProgress(): FakeData {
  const data = exampleData();
  const progress: ProgressRecord[] = [
    { id: 'r1', taskId: 'a', date: '2026-01-31', percent: 100 },
    { id: 'r2', taskId: 'b', date: '2026-02-28', percent: 50 },
  ];
  return { ...data, progress };
}

function headerTexts() {
  return screen.getAllByRole('columnheader').map((cell) => cell.textContent);
}

function cellsOf(row: HTMLElement) {
  return within(row).getAllByTestId('bohal-cell');
}

/** 하단 행을 [행 이름, 기간별 값...] 배열로 읽습니다. */
function totalRows() {
  return screen.getAllByTestId('bohal-total-row').map((row) => [
    within(row).getByRole('rowheader').textContent,
    ...within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ]);
}

function highlighted() {
  return [...document.querySelectorAll(`.${AS_OF_CLASS}`)];
}

describe('BohalTable', () => {
  it('고정 열과 기간 열 머리글을 표시한다 (AC-F6-1, AC-F4-4)', () => {
    render(<BohalTable schedule={schedule(exampleData(), 'month', '2026-02-28')} />);

    expect(headerTexts()).toEqual([
      '구분',
      '공종명',
      '금액',
      '보할(%)',
      '시작일',
      '종료일',
      '진척률',
      '2026년 1월',
      '2026년 2월',
      '2026년 3월',
    ]);
  });

  it('가중치 기준 프로젝트는 세 번째 열 이름이 "가중치"이다 (AC-F2-7)', () => {
    const data: FakeData = {
      project: makeProject({ weightBasis: 'manual' }),
      tasks: [makeTask({ id: 'x', name: '가', weightValue: 2 })],
      progress: [],
    };
    render(<BohalTable schedule={schedule(data, 'month', '2026-01-15')} />);

    expect(headerTexts()[2]).toBe('가중치');
  });

  it('공종 행에 고정 열 값을 금액은 천 단위, 비율은 소수 둘째 자리로 표시한다 (AC-F6-7)', () => {
    render(<BohalTable schedule={schedule(exampleWithProgress(), 'month', '2026-02-28')} />);

    const [rowA, rowB] = screen.getAllByTestId('bohal-row');
    const fixedA = within(rowA)
      .getAllByRole('cell')
      .slice(0, 6)
      .map((cell) => cell.textContent);
    expect(fixedA).toEqual(['토목', '60,000,000', '60.00%', '2026.01.01', '2026.01.31', '100.00%']);
    expect(within(rowA).getByRole('rowheader')).toHaveTextContent('공종 A');

    const fixedB = within(rowB)
      .getAllByRole('cell')
      .slice(0, 6)
      .map((cell) => cell.textContent);
    expect(fixedB).toEqual(['건축', '40,000,000', '40.00%', '2026.02.01', '2026.03.31', '50.00%']);
  });

  it('작업 기간 셀에 막대와 계획값을 표시하고 그 외 셀은 비운다 (AC-F6-2, AC-F4-1, AC-F4-3)', () => {
    render(<BohalTable schedule={schedule(exampleData(), 'month', '2026-02-28')} />);

    const [rowA, rowB] = screen.getAllByTestId('bohal-row');
    expect(cellsOf(rowA).map((cell) => cell.textContent)).toEqual(['60.00', '', '']);
    expect(cellsOf(rowB).map((cell) => cell.textContent)).toEqual(['', '18.98', '21.02']);

    const bars = (row: HTMLElement) => cellsOf(row).map((cell) => within(cell).queryAllByTestId('bohal-bar').length);
    expect(bars(rowA)).toEqual([1, 0, 0]);
    expect(bars(rowB)).toEqual([0, 1, 1]);
    // 빈 셀에는 아무 요소도 없다.
    expect(cellsOf(rowA)[1]).toBeEmptyDOMElement();
  });

  it('막대는 기간 안에서 작업하는 날짜만큼의 위치와 길이를 가진다', () => {
    const data: FakeData = {
      project: makeProject({ startDate: '2026-01-01', endDate: '2026-01-31' }),
      tasks: [makeTask({ id: 'x', startDate: '2026-01-11', endDate: '2026-01-20' })],
      progress: [],
    };
    render(<BohalTable schedule={schedule(data, 'month', '2026-01-15')} />);

    const bar = screen.getByTestId('bohal-bar');
    expect(parseFloat(bar.style.marginLeft)).toBeCloseTo((10 / 31) * 100, 2);
    expect(parseFloat(bar.style.width)).toBeCloseTo((10 / 31) * 100, 2);
  });

  it('하단 4행을 순서대로 표시하고 기준일 뒤 기간의 실적은 빈칸이다 (AC-F6-3, AC-F5-6)', () => {
    render(<BohalTable schedule={schedule(exampleWithProgress(), 'month', '2026-02-28')} />);

    expect(totalRows()).toEqual([
      ['기간 계획', '60.00', '18.98', '21.02'],
      ['누계 계획', '60.00', '78.98', '100.00'],
      ['기간 실적', '60.00', '20.00', ''],
      ['누계 실적', '60.00', '80.00', ''],
    ]);
  });

  it('기준일을 2026-01-31로 하면 2월 실적도 빈칸이다 (AC-F5-7)', () => {
    render(<BohalTable schedule={schedule(exampleWithProgress(), 'month', '2026-01-31')} />);

    const rows = totalRows();
    expect(rows[2]).toEqual(['기간 실적', '60.00', '', '']);
    expect(rows[3]).toEqual(['누계 실적', '60.00', '', '']);
  });

  it('기준일이 속한 기간 열의 머리글과 모든 셀을 강조한다 (AC-F6-6)', () => {
    render(<BohalTable schedule={schedule(exampleData(), 'month', '2026-02-10')} />);

    const periodHeaders = screen.getAllByTestId('bohal-period-header');
    expect(periodHeaders.map((cell) => cell.classList.contains(AS_OF_CLASS))).toEqual([false, true, false]);
    expect(periodHeaders[1]).toHaveAttribute('aria-current', 'date');

    for (const row of screen.getAllByTestId('bohal-row')) {
      expect(cellsOf(row).map((cell) => cell.classList.contains(AS_OF_CLASS))).toEqual([false, true, false]);
    }
    for (const row of screen.getAllByTestId('bohal-total-row')) {
      const cells = within(row).getAllByRole('cell');
      expect(cells.map((cell) => cell.classList.contains(AS_OF_CLASS))).toEqual([false, true, false]);
    }
    // 머리글 1 + 공종 2 + 하단 4
    expect(highlighted()).toHaveLength(7);
  });

  it('기준일이 프로젝트 기간 밖이면 강조되는 열이 없다 (AC-F6-6)', () => {
    const { unmount } = render(<BohalTable schedule={schedule(exampleData(), 'month', '2026-04-01')} />);
    expect(highlighted()).toHaveLength(0);
    unmount();

    render(<BohalTable schedule={schedule(exampleData(), 'month', '2025-12-31')} />);
    expect(highlighted()).toHaveLength(0);
  });

  it('주 단위 공정표는 주 기간 열과 주별 계획값을 표시한다 (AC-F4-6)', () => {
    const data: FakeData = {
      project: makeProject({ startDate: '2026-01-01', endDate: '2026-01-14' }),
      tasks: [makeTask({ id: 'x', startDate: '2026-01-01', endDate: '2026-01-14' })],
      progress: [],
    };
    render(<BohalTable schedule={schedule(data, 'week', '2026-01-07')} />);

    expect(screen.getAllByTestId('bohal-period-header')).toHaveLength(3);
    expect(cellsOf(screen.getByTestId('bohal-row')).map((cell) => cell.textContent)).toEqual(['28.57', '50.00', '21.43']);
    expect(totalRows()[1]).toEqual(['누계 계획', '28.57', '78.57', '100.00']);
  });

  it('공종이 없으면 표 대신 안내 문구를 표시한다 (AC-F6-8)', () => {
    render(<BohalTable schedule={schedule({ project: makeProject(), tasks: [], progress: [] }, 'month', '2026-01-15')} />);

    expect(screen.getByText('등록된 공종이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('ProjectDetailPage 보할 공정표 탭', () => {
  /** 공정표 조회만 쿼리의 unit과 asOf대로 계산해 돌려주는 모의 서버 */
  function scheduleServer(data: FakeData): MockHandler {
    const fallback = fakeServer(data);
    return (call) => {
      const [path, query = ''] = call.url.split('?');
      if (call.method === 'GET' && path === `/api/projects/${data.project.id}/schedule` && query !== '') {
        const params = new URLSearchParams(query);
        const unit = params.get('unit') === 'week' ? 'week' : 'month';
        return jsonResponse(schedule(data, unit, params.get('asOf') ?? '2026-02-28'));
      }
      return fallback(call);
    };
  }

  async function openScheduleTab(data: FakeData, handler: MockHandler = scheduleServer(data)) {
    const calls = mockFetch(handler);
    render(<ProjectDetailPage projectId={data.project.id} notify={vi.fn()} />);
    await screen.findByRole('heading', { level: 2, name: data.project.name });
    fireEvent.click(screen.getByRole('tab', { name: '보할 공정표' }));
    return calls;
  }

  function scheduleQueries(calls: { url: string }[]) {
    return calls.filter((call) => call.url.includes('/schedule?')).map((call) => call.url.split('?')[1]);
  }

  it('탭을 열면 월 단위, 오늘 기준일로 공정표를 조회해 표시한다 (AC-F6-5)', async () => {
    const calls = await openScheduleTab(exampleData());

    await screen.findByRole('table');
    expect(scheduleQueries(calls)).toEqual([`unit=month&asOf=${todayString()}`]);
    expect(screen.getByLabelText('기준일')).toHaveValue(todayString());
    expect(screen.getAllByTestId('bohal-period-header').map((cell) => cell.textContent)).toEqual([
      '2026년 1월',
      '2026년 2월',
      '2026년 3월',
    ]);
    expect(totalRows()[1]).toEqual(['누계 계획', '60.00', '78.98', '100.00']);
  });

  it('기준일을 바꾸면 asOf로 다시 조회해 실적 행과 강조 열을 갱신한다 (AC-F6-5, AC-F5-6, AC-F5-7)', async () => {
    const calls = await openScheduleTab(exampleWithProgress());
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('기준일'), { target: { value: '2026-02-28' } });
    await waitFor(() => expect(totalRows()[3]).toEqual(['누계 실적', '60.00', '80.00', '']));
    expect(scheduleQueries(calls).at(-1)).toBe('unit=month&asOf=2026-02-28');
    expect(screen.getAllByTestId('bohal-period-header').map((cell) => cell.classList.contains(AS_OF_CLASS))).toEqual([
      false,
      true,
      false,
    ]);

    fireEvent.change(screen.getByLabelText('기준일'), { target: { value: '2026-01-31' } });
    await waitFor(() => expect(totalRows()[3]).toEqual(['누계 실적', '60.00', '', '']));
    expect(scheduleQueries(calls).at(-1)).toBe('unit=month&asOf=2026-01-31');
    expect(screen.getAllByTestId('bohal-period-header').map((cell) => cell.classList.contains(AS_OF_CLASS))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('기간 단위를 "주"로 바꾸면 unit=week로 조회한 주 단위 열을 그린다 (AC-F6-4)', async () => {
    const data = exampleData();
    const calls = await openScheduleTab(data);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('기준일'), { target: { value: '2026-02-28' } });
    await waitFor(() => expect(scheduleQueries(calls).at(-1)).toBe('unit=month&asOf=2026-02-28'));

    fireEvent.click(screen.getByRole('button', { name: '주' }));

    const expected = schedule(data, 'week', '2026-02-28');
    await waitFor(() =>
      expect(screen.getAllByTestId('bohal-period-header').map((cell) => cell.textContent)).toEqual(
        expected.periods.map((period) => period.label),
      ),
    );
    expect(scheduleQueries(calls).at(-1)).toBe('unit=week&asOf=2026-02-28');
    expect(screen.getByRole('button', { name: '주' })).toHaveAttribute('aria-pressed', 'true');
    expect(totalRows()[1].at(-1)).toBe('100.00');
    // CSV 링크도 화면과 같은 단위와 기준일을 가리킨다.
    expect(screen.getByRole('link', { name: 'CSV 내려받기' })).toHaveAttribute(
      'href',
      '/api/projects/p1/schedule.csv?unit=week&asOf=2026-02-28',
    );

    fireEvent.click(screen.getByRole('button', { name: '월' }));
    await waitFor(() => expect(screen.getAllByTestId('bohal-period-header')).toHaveLength(3));
    expect(scheduleQueries(calls).at(-1)).toBe('unit=month&asOf=2026-02-28');
  });

  it('기준일을 비우면 다시 조회하지 않고 안내를 표시한다', async () => {
    const calls = await openScheduleTab(exampleData());
    await screen.findByRole('table');
    const before = scheduleQueries(calls).length;

    fireEvent.change(screen.getByLabelText('기준일'), { target: { value: '' } });

    expect(await screen.findByText('기준일을 선택하세요.')).toBeInTheDocument();
    expect(scheduleQueries(calls)).toHaveLength(before);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('공종이 없으면 "등록된 공종이 없습니다."를 표시한다 (AC-F6-8)', async () => {
    await openScheduleTab({ project: makeProject(), tasks: [], progress: [] });

    expect(await screen.findByText('등록된 공종이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('공정표 조회가 실패하면 서버 메시지를 보여 주고 다시 시도할 수 있다', async () => {
    const data = exampleData();
    const ok = scheduleServer(data);
    let fail = true;
    await openScheduleTab(data, (call) => {
      if (fail && call.url.includes('/schedule?')) {
        return errorResponse(400, 'VALIDATION_ERROR', '기준일 형식이 올바르지 않습니다.');
      }
      return ok(call);
    });

    expect(await screen.findByText('기준일 형식이 올바르지 않습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
