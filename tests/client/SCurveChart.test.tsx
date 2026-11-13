import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SCurveChart, {
  CHART,
  curvePoints,
  toPolyline,
  xForIndex,
  xLabelIndexes,
  yForPercent,
} from '../../src/client/components/SCurveChart';
import ProjectDetailPage from '../../src/client/pages/ProjectDetailPage';
import { buildSchedule } from '../../src/shared/bohal';
import type { PeriodUnit, ProgressRecord, Schedule } from '../../src/shared/types';
import { exampleData, fakeServer, jsonResponse, makeProject, makeTask, mockFetch, type FakeData } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function schedule(data: FakeData, unit: PeriodUnit, asOf: string): Schedule {
  const tasks = [...data.tasks].sort((x, y) => x.order - y.order);
  return buildSchedule(data.project, tasks, data.progress, unit, asOf);
}

/** AC-F5-6의 상태: 공종 A 2026-01-31 100%, 공종 B 2026-02-28 50% */
function exampleWithProgress(): FakeData {
  const progress: ProgressRecord[] = [
    { id: 'r1', taskId: 'a', date: '2026-01-31', percent: 100 },
    { id: 'r2', taskId: 'b', date: '2026-02-28', percent: 50 },
  ];
  return { ...exampleData(), progress };
}

/** polyline의 points 속성을 좌표 배열로 읽습니다. */
function polylinePoints(testId: string): { x: number; y: number }[] {
  const value = screen.getByTestId(testId).getAttribute('points') ?? '';
  return value
    .split(' ')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
}

const Y_0 = CHART.height - CHART.bottom;
const Y_100 = CHART.top;

describe('S-Curve 좌표 계산', () => {
  it('세로 좌표는 0%가 아래 끝, 100%가 위 끝이고 범위 밖 값은 끝에 붙는다', () => {
    expect(yForPercent(0)).toBe(Y_0);
    expect(yForPercent(100)).toBe(Y_100);
    expect(yForPercent(50)).toBeCloseTo((Y_0 + Y_100) / 2, 6);
    expect(yForPercent(120)).toBe(Y_100);
    expect(yForPercent(-5)).toBe(Y_0);
    expect(yForPercent(Number.NaN)).toBe(Y_0);
  });

  it('가로 좌표는 기간 칸의 가운데이고 왼쪽에서 오른쪽으로 같은 간격으로 늘어난다', () => {
    const xs = [0, 1, 2, 3].map((index) => xForIndex(index, 4));
    const band = (CHART.width - CHART.left - CHART.right) / 4;

    expect(xs[0]).toBeCloseTo(CHART.left + band / 2, 6);
    expect(xs[3]).toBeCloseTo(CHART.width - CHART.right - band / 2, 6);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeCloseTo(band, 6);
  });

  it('기간이 1개 이하이면 가로 좌표가 그래프 영역 가운데로 유한하다', () => {
    const center = CHART.left + (CHART.width - CHART.left - CHART.right) / 2;

    expect(xForIndex(0, 1)).toBe(center);
    expect(xForIndex(0, 0)).toBe(center);
  });

  it('null인 기간은 점을 만들지 않고 나머지는 기간 순번을 유지한다', () => {
    const points = curvePoints([10, null, 30, null], 4);

    expect(points.map((point) => point.index)).toEqual([0, 2]);
    expect(points.map((point) => point.value)).toEqual([10, 30]);
    expect(points[1].x).toBe(xForIndex(2, 4));
    expect(points[1].y).toBe(yForPercent(30));
    expect(toPolyline(points).split(' ')).toHaveLength(2);
    expect(curvePoints([], 0)).toEqual([]);
    expect(toPolyline([])).toBe('');
  });

  it('가로축 이름은 최대 개수를 넘지 않게 일정한 간격으로 고른다', () => {
    expect(xLabelIndexes(0)).toEqual([]);
    expect(xLabelIndexes(3)).toEqual([0, 1, 2]);
    expect(xLabelIndexes(60, 8)).toEqual([0, 8, 16, 24, 32, 40, 48, 56]);
    expect(xLabelIndexes(260, 8).length).toBeLessThanOrEqual(8);
  });
});

describe('SCurveChart', () => {
  it('"계획"과 "실적" 범례가 있는 곡선 2개를 그리고 계획 곡선의 점 개수는 기간 수와 같다 (AC-F7-4)', () => {
    const view = schedule(exampleWithProgress(), 'month', '2026-02-28');
    render(<SCurveChart schedule={view} />);

    const legend = within(screen.getByTestId('scurve-legend'));
    expect(legend.getByText('계획')).toBeInTheDocument();
    expect(legend.getByText('실적')).toBeInTheDocument();
    expect(screen.getByTestId('scurve-plan').tagName.toLowerCase()).toBe('polyline');
    expect(screen.getByTestId('scurve-actual').tagName.toLowerCase()).toBe('polyline');
    expect(polylinePoints('scurve-plan')).toHaveLength(view.periods.length);
    expect(polylinePoints('scurve-plan')).toHaveLength(3);
  });

  it('주 단위에서도 계획 곡선의 점 개수는 기간 수와 같다 (AC-F7-4)', () => {
    const view = schedule(exampleData(), 'week', '2026-02-28');
    render(<SCurveChart schedule={view} />);

    expect(view.periods.length).toBeGreaterThan(10);
    expect(polylinePoints('scurve-plan')).toHaveLength(view.periods.length);
    // 기간이 많아도 가로축 이름은 일부만 적는다.
    expect(screen.getAllByTestId('scurve-x-tick').length).toBeLessThanOrEqual(8);
  });

  it('실적 곡선의 점 개수는 실적이 null이 아닌 기간 수와 같다 (AC-F7-5)', () => {
    const view = schedule(exampleWithProgress(), 'month', '2026-02-28');
    render(<SCurveChart schedule={view} />);

    expect(view.totals.cumulativeActual).toEqual([60, 80, null]);
    expect(polylinePoints('scurve-actual')).toHaveLength(2);
    expect(screen.getAllByTestId('scurve-actual-point')).toHaveLength(2);
    // 실적 점은 누계 60%, 80% 높이에 있다.
    const ys = screen.getAllByTestId('scurve-actual-point').map((point) => Number(point.getAttribute('cy')));
    expect(ys[0]).toBeCloseTo(yForPercent(60), 1);
    expect(ys[1]).toBeCloseTo(yForPercent(80), 1);
  });

  it('기준일이 프로젝트 시작 전이면 실적 곡선과 점을 그리지 않는다 (AC-F7-5)', () => {
    const view = schedule(exampleWithProgress(), 'month', '2025-12-31');
    render(<SCurveChart schedule={view} />);

    expect(screen.queryByTestId('scurve-actual')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('scurve-actual-point')).toHaveLength(0);
    expect(polylinePoints('scurve-plan')).toHaveLength(3);
    expect(screen.queryByTestId('scurve-asof')).not.toBeInTheDocument();
  });

  it('계획 곡선의 마지막 점은 세로축 100% 위치에 있고 곡선은 내려가지 않는다 (AC-F7-6)', () => {
    render(<SCurveChart schedule={schedule(exampleData(), 'month', '2026-02-28')} />);

    const points = polylinePoints('scurve-plan');
    expect(points.at(-1)?.y).toBeCloseTo(Y_100, 1);
    expect(points[0].y).toBeCloseTo(yForPercent(60), 1);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].y).toBeLessThanOrEqual(points[i - 1].y);
      expect(points[i].x).toBeGreaterThan(points[i - 1].x);
    }
  });

  it('세로축 0~100% 눈금, 가로축 기간 이름, 기준일 세로선을 표시한다', () => {
    const view = schedule(exampleData(), 'month', '2026-02-28');
    render(<SCurveChart schedule={view} />);

    expect(screen.getAllByTestId('scurve-y-tick').map((tick) => tick.textContent)).toEqual([
      '0%',
      '25%',
      '50%',
      '75%',
      '100%',
    ]);
    expect(screen.getAllByTestId('scurve-x-tick').map((tick) => tick.textContent)).toEqual([
      '2026년 1월',
      '2026년 2월',
      '2026년 3월',
    ]);
    const asOf = screen.getByTestId('scurve-asof');
    expect(asOf).toHaveTextContent('기준일 2026.02.28');
    const line = asOf.querySelector('line');
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo(xForIndex(1, 3), 6);
    expect(Number(line?.getAttribute('x1'))).toBeCloseTo(polylinePoints('scurve-plan')[1].x, 1);
    expect(Number(line?.getAttribute('y1'))).toBe(Y_100);
    expect(Number(line?.getAttribute('y2'))).toBe(Y_0);
  });

  it('접근성용 제목과 설명을 가진 이미지로 노출된다', () => {
    render(<SCurveChart schedule={schedule(exampleWithProgress(), 'month', '2026-02-28')} />);

    const chart = screen.getByRole('img', { name: /S-Curve/ });
    expect(chart.querySelector('title')).toHaveTextContent('S-Curve (계획·실적 누계 그래프)');
    const desc = chart.querySelector('desc');
    expect(desc).toHaveTextContent('월 단위 기간 3개');
    expect(desc).toHaveTextContent('계획 누계 78.98%');
    expect(desc).toHaveTextContent('실적 누계 80.00%');
    expect(chart.getAttribute('aria-labelledby')?.split(' ')).toEqual([
      chart.querySelector('title')?.id,
      desc?.id,
    ]);
  });

  it('기간이 0개여도 오류 없이 축과 범례만 그린다', () => {
    const base = schedule(exampleData(), 'month', '2026-02-28');
    const empty: Schedule = {
      ...base,
      periods: [],
      asOfPeriodIndex: null,
      rows: [],
      totals: {
        weightValue: 0,
        bohal: 0,
        periodPlanned: [],
        cumulativePlanned: [],
        periodActual: [],
        cumulativeActual: [],
      },
      summary: { plannedToDate: 0, actualToDate: 0, variance: 0, status: 'onTrack' },
    };
    render(<SCurveChart schedule={empty} />);

    const chart = screen.getByTestId('scurve');
    expect(within(chart).getByText('계획')).toBeInTheDocument();
    expect(within(chart).getByText('실적')).toBeInTheDocument();
    expect(screen.getAllByTestId('scurve-y-tick')).toHaveLength(5);
    expect(screen.queryByTestId('scurve-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scurve-actual')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('scurve-x-tick')).toHaveLength(0);
    expect(chart.innerHTML).not.toContain('NaN');
    expect(screen.getAllByText('표시할 기간이 없습니다.').length).toBeGreaterThan(0);
  });

  it('기간이 1개여도 오류 없이 점 하나씩을 그린다', () => {
    const data: FakeData = {
      project: makeProject({ startDate: '2026-01-01', endDate: '2026-01-31' }),
      tasks: [makeTask({ id: 'a', startDate: '2026-01-01', endDate: '2026-01-31' })],
      progress: [{ id: 'r1', taskId: 'a', date: '2026-01-10', percent: 40 }],
    };
    const view = schedule(data, 'month', '2026-01-15');
    render(<SCurveChart schedule={view} />);

    expect(view.periods).toHaveLength(1);
    const plan = polylinePoints('scurve-plan');
    expect(plan).toHaveLength(1);
    expect(plan[0].x).toBeCloseTo(xForIndex(0, 1), 1);
    expect(plan[0].y).toBeCloseTo(Y_100, 1);
    expect(screen.getAllByTestId('scurve-actual-point')).toHaveLength(1);
    expect(Number(screen.getByTestId('scurve-actual-point').getAttribute('cy'))).toBeCloseTo(yForPercent(40), 1);
    expect(screen.getByTestId('scurve').innerHTML).not.toContain('NaN');
    expect(screen.getAllByTestId('scurve-x-tick')).toHaveLength(1);
  });
});

describe('ProjectDetailPage 진도 요약과 S-Curve', () => {
  /** 공정표 조회를 쿼리의 unit과 asOf대로 계산해 돌려주는 모의 서버 */
  function scheduleServer(data: FakeData) {
    const fallback = fakeServer(data);
    return mockFetch((call) => {
      const [path, query = ''] = call.url.split('?');
      if (call.method === 'GET' && path === `/api/projects/${data.project.id}/schedule` && query !== '') {
        const params = new URLSearchParams(query);
        const unit = params.get('unit') === 'week' ? 'week' : 'month';
        return jsonResponse(schedule(data, unit, params.get('asOf') ?? '2026-02-28'));
      }
      return fallback(call);
    });
  }

  async function renderPage(data: FakeData) {
    scheduleServer(data);
    render(<ProjectDetailPage projectId={data.project.id} notify={vi.fn()} />);
    await screen.findByRole('heading', { level: 2, name: data.project.name });
  }

  function openScheduleTab() {
    fireEvent.click(screen.getByRole('tab', { name: '보할 공정표' }));
  }

  function setAsOf(value: string) {
    fireEvent.change(screen.getByLabelText('기준일'), { target: { value } });
  }

  function summaryText(testId: string) {
    return screen.getByTestId(testId).textContent;
  }

  it('도구 모음 아래에 요약 카드를, 표 아래에 S-Curve를 배치하고 인쇄에서 빼지 않는다', async () => {
    await renderPage(exampleWithProgress());
    openScheduleTab();
    setAsOf('2026-02-28');

    await waitFor(() => expect(summaryText('summary-variance')).toContain('+1.02%p'));
    const cards = screen.getByRole('region', { name: '진도 요약' });
    const table = screen.getByRole('table');
    const chart = screen.getByTestId('scurve');
    const toolbar = screen.getByLabelText('기준일');

    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(toolbar, cards)).toBe(true);
    expect(follows(cards, table)).toBe(true);
    expect(follows(table, chart)).toBe(true);
    expect(cards.closest('.no-print')).toBeNull();
    expect(chart.closest('.no-print')).toBeNull();
  });

  it('기준일을 바꾸면 요약 수치와 실적 곡선이 갱신된다 (AC-F7-1, AC-F7-2, AC-F7-5)', async () => {
    await renderPage(exampleWithProgress());
    openScheduleTab();
    setAsOf('2026-02-28');

    await waitFor(() => expect(summaryText('summary-planned')).toContain('78.98%'));
    expect(summaryText('summary-actual')).toContain('80.00%');
    expect(summaryText('summary-status')).toContain('앞섬');
    expect(screen.getAllByTestId('scurve-actual-point')).toHaveLength(2);
    expect(polylinePoints('scurve-plan')).toHaveLength(3);

    setAsOf('2026-01-16');

    await waitFor(() => expect(summaryText('summary-planned')).toContain('30.97%'));
    expect(summaryText('summary-actual')).toContain('0.00%');
    expect(summaryText('summary-status')).toContain('지연');
    expect(screen.getAllByTestId('scurve-actual-point')).toHaveLength(1);
    expect(screen.getByTestId('scurve-asof')).toHaveTextContent('기준일 2026.01.16');
  });

  it('실적을 입력한 뒤 탭을 열면 요약 수치와 실적 곡선에 반영된다', async () => {
    await renderPage(exampleData());
    openScheduleTab();
    setAsOf('2026-01-16');
    await waitFor(() => expect(summaryText('summary-status')).toContain('지연'));
    expect(Number(screen.getByTestId('scurve-actual-point').getAttribute('cy'))).toBeCloseTo(yForPercent(0), 1);

    fireEvent.click(screen.getByRole('tab', { name: '공종 관리' }));
    fireEvent.click(screen.getByRole('button', { name: '공종 A 실적 입력' }));
    const dialog = within(screen.getByRole('dialog', { name: '실적 입력 — 공종 A' }));
    fireEvent.change(dialog.getByLabelText('날짜'), { target: { value: '2026-01-16' } });
    fireEvent.change(dialog.getByLabelText('누계 진척률(%)'), { target: { value: '52' } });
    fireEvent.click(dialog.getByRole('button', { name: '실적 저장' }));
    await waitFor(() => expect(dialog.getAllByTestId('progress-row')).toHaveLength(1));
    fireEvent.click(dialog.getByRole('button', { name: '닫기' }));

    openScheduleTab();

    await waitFor(() => expect(summaryText('summary-actual')).toContain('31.20%'));
    expect(summaryText('summary-variance')).toContain('+0.23%p');
    expect(summaryText('summary-status')).toContain('정상');
    expect(Number(screen.getByTestId('scurve-actual-point').getAttribute('cy'))).toBeCloseTo(yForPercent(31.2), 1);
  });

  it('공종이 없으면 요약 카드와 S-Curve 대신 안내만 표시한다', async () => {
    await renderPage({ project: makeProject(), tasks: [], progress: [] });
    openScheduleTab();

    expect(await screen.findByText('등록된 공종이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('scurve')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '진도 요약' })).not.toBeInTheDocument();
  });
});
