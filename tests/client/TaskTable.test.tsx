import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TaskTable from '../../src/client/components/TaskTable';
import ProjectDetailPage from '../../src/client/pages/ProjectDetailPage';
import {
  errorResponse,
  exampleData,
  fakeServer,
  makeProject,
  makeSchedule,
  makeTask,
  mockFetch,
  type FakeData,
} from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTable(data: FakeData, handlers: Partial<Parameters<typeof TaskTable>[0]> = {}) {
  const props = {
    schedule: makeSchedule(data),
    onProgress: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onChanged: vi.fn(),
    onError: vi.fn(),
    ...handlers,
  };
  render(<TaskTable {...props} />);
  return props;
}

function rowTexts() {
  return screen.getAllByTestId('task-row').map((row) => within(row).getByRole('rowheader').textContent);
}

describe('TaskTable', () => {
  it('예제 프로젝트의 열 머리글, 공종별 보할, 합계 행을 표시한다 (AC-F3-1)', () => {
    mockFetch(() => undefined);
    renderTable(exampleData());

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['구분', '공종명', '금액', '보할(%)', '시작일', '종료일', '현재 진척률', '동작']);

    const [rowA, rowB] = screen.getAllByTestId('task-row');
    expect(within(rowA).getByText('토목')).toBeInTheDocument();
    expect(within(rowA).getByText('공종 A')).toBeInTheDocument();
    expect(within(rowA).getByText('60,000,000')).toBeInTheDocument();
    expect(within(rowA).getByText('60.00%')).toBeInTheDocument();
    expect(within(rowA).getByText('2026.01.01')).toBeInTheDocument();
    expect(within(rowA).getByText('2026.01.31')).toBeInTheDocument();
    // 실적 기록이 없으면 현재 진척률은 0%이다. (AC-F5-8)
    expect(within(rowA).getByText('0.00%')).toBeInTheDocument();
    expect(within(rowB).getByText('40.00%')).toBeInTheDocument();

    for (const name of ['위로', '아래로', '실적 입력', '수정', '삭제']) {
      expect(within(rowA).getByRole('button', { name: `공종 A ${name}` })).toBeInTheDocument();
    }

    const total = within(screen.getByTestId('task-total-row'));
    expect(total.getByText('합계')).toBeInTheDocument();
    expect(total.getByText('100,000,000')).toBeInTheDocument();
    expect(total.getByText('100.00%')).toBeInTheDocument();
  });

  it('금액이 1, 1, 1인 공종 3개는 각각 33.33%, 합계는 100.00%로 표시한다 (AC-F3-2)', () => {
    mockFetch(() => undefined);
    renderTable({
      project: makeProject(),
      tasks: [0, 1, 2].map((order) => makeTask({ id: `t${order}`, name: `공종 ${order + 1}`, order })),
      progress: [],
    });

    const rows = screen.getAllByTestId('task-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(within(row).getByText('33.33%')).toBeInTheDocument();
    expect(within(screen.getByTestId('task-total-row')).getByText('100.00%')).toBeInTheDocument();
  });

  it('가중치 기준 프로젝트에서는 열 이름을 "가중치"로 표시한다 (AC-F2-7)', () => {
    mockFetch(() => undefined);
    renderTable({
      project: makeProject({ weightBasis: 'manual' }),
      tasks: [makeTask({ id: 'x', name: '가', weightValue: 2, order: 0 }), makeTask({ id: 'y', name: '나', weightValue: 6, order: 1 })],
      progress: [],
    });

    expect(screen.getByRole('columnheader', { name: '가중치' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '금액' })).not.toBeInTheDocument();
    // 가중치 2와 6의 보할은 25.00%와 75.00%이다. (AC-F3-5)
    const [first, second] = screen.getAllByTestId('task-row');
    expect(within(first).getByText('25.00%')).toBeInTheDocument();
    expect(within(second).getByText('75.00%')).toBeInTheDocument();
  });

  it('공종이 없으면 안내 문구와 합계 0.00%를 표시한다 (AC-F6-8, AC-F3-4)', () => {
    mockFetch(() => undefined);
    renderTable({ project: makeProject(), tasks: [], progress: [] });

    expect(screen.getByText('등록된 공종이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('task-total-row')).getByText('0.00%')).toBeInTheDocument();
  });

  it('"아래로"를 누르면 다음 공종과 자리를 바꾼 순서를 PUT tasks/order로 보낸다 (AC-F2-6)', async () => {
    const data = exampleData();
    const calls = mockFetch(fakeServer(data));
    const { onChanged } = renderTable(data);

    // 첫 공종은 위로, 마지막 공종은 아래로 옮길 수 없다.
    expect(screen.getByRole('button', { name: '공종 A 위로' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '공종 B 아래로' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '공종 A 아래로' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: 'PUT', url: '/api/projects/p1/tasks/order', body: { taskIds: ['b', 'a'] } }]);
  });

  it('"위로"는 앞 공종과 자리를 바꾸고, 실패하면 서버 메시지를 onError로 알린다', async () => {
    const data = exampleData();
    const calls = mockFetch(() => errorResponse(400, 'VALIDATION_ERROR', '공종 순서가 올바르지 않습니다.'));
    const { onChanged, onError } = renderTable(data);

    fireEvent.click(screen.getByRole('button', { name: '공종 B 위로' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('공종 순서가 올바르지 않습니다.'));
    expect(calls[0].body).toEqual({ taskIds: ['b', 'a'] });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('실적 입력, 수정, 삭제 버튼은 해당 공종 행을 넘겨 준다', () => {
    mockFetch(() => undefined);
    const { onProgress, onEdit, onDelete } = renderTable(exampleData());

    fireEvent.click(screen.getByRole('button', { name: '공종 B 실적 입력' }));
    fireEvent.click(screen.getByRole('button', { name: '공종 B 수정' }));
    fireEvent.click(screen.getByRole('button', { name: '공종 B 삭제' }));

    for (const handler of [onProgress, onEdit, onDelete]) {
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'b', name: '공종 B' }));
    }
  });
});

describe('ProjectDetailPage 공종 관리 탭', () => {
  async function renderPage(data: FakeData) {
    const calls = mockFetch(fakeServer(data));
    const notify = vi.fn();
    render(<ProjectDetailPage projectId={data.project.id} notify={notify} />);
    await screen.findByRole('heading', { level: 2, name: data.project.name });
    return { calls, notify };
  }

  it("'공종 관리'와 '보할 공정표' 탭을 표시하고 공종 관리 탭을 먼저 연다", async () => {
    await renderPage(exampleData());

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['공종 관리', '보할 공정표']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByTestId('task-row')).toHaveLength(2);

    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('task-row')).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: '보할 공정표' })).toBeInTheDocument();
  });

  it('순서를 바꾸면 데이터를 다시 불러와 바뀐 순서로 표시한다 (AC-F2-6)', async () => {
    const { calls } = await renderPage(exampleData());
    expect(rowTexts()).toEqual(['공종 A', '공종 B']);

    fireEvent.click(screen.getByRole('button', { name: '공종 A 아래로' }));

    await waitFor(() => expect(rowTexts()).toEqual(['공종 B', '공종 A']));
    const afterOrder = calls.slice(calls.findIndex((call) => call.url.endsWith('/tasks/order')) + 1);
    expect(afterOrder.map((call) => call.url)).toEqual(
      expect.arrayContaining(['/api/projects/p1', '/api/projects/p1/schedule']),
    );
  });

  it('공종을 추가하면 마지막 행에 나타나고 보할이 다시 계산된다 (AC-F2-1, AC-F3-3)', async () => {
    const { calls, notify } = await renderPage(exampleData());

    fireEvent.click(screen.getByRole('button', { name: '공종 추가' }));
    const dialog = within(screen.getByRole('dialog', { name: '공종 추가' }));
    fireEvent.change(dialog.getByLabelText('공종명'), { target: { value: '공종 C' } });
    fireEvent.change(dialog.getByLabelText('금액'), { target: { value: '100,000,000' } });
    fireEvent.click(dialog.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(rowTexts()).toEqual(['공종 A', '공종 B', '공종 C']));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const [rowA, rowB, rowC] = screen.getAllByTestId('task-row');
    expect(within(rowA).getByText('30.00%')).toBeInTheDocument();
    expect(within(rowB).getByText('20.00%')).toBeInTheDocument();
    expect(within(rowC).getByText('50.00%')).toBeInTheDocument();
    expect(within(screen.getByTestId('task-total-row')).getByText('100.00%')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ name: '공종 C', weightValue: 100_000_000 });
    expect(notify).toHaveBeenCalledWith('success', "'공종 C' 공종을 추가했습니다.");
  });

  it('공종을 수정하면 수정한 값과 새 보할을 표시한다 (AC-F2-5)', async () => {
    const { calls } = await renderPage(exampleData());

    fireEvent.click(screen.getByRole('button', { name: '공종 B 수정' }));
    const dialog = within(screen.getByRole('dialog', { name: '공종 수정' }));
    expect(dialog.getByLabelText('공종명')).toHaveValue('공종 B');
    fireEvent.change(dialog.getByLabelText('금액'), { target: { value: '60000000' } });
    fireEvent.click(dialog.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getAllByText('50.00%')).toHaveLength(2));
    expect(calls.find((call) => call.method === 'PUT')?.url).toBe('/api/projects/p1/tasks/b');
  });

  it('삭제 확인 뒤 DELETE를 보내고 행을 지운다 (AC-F2-5)', async () => {
    const { calls } = await renderPage(exampleData());

    fireEvent.click(screen.getByRole('button', { name: '공종 A 삭제' }));
    const confirm = within(screen.getByRole('alertdialog'));
    expect(confirm.getByText("'공종 A' 공종을 삭제할까요?")).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    fireEvent.click(confirm.getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(rowTexts()).toEqual(['공종 B']));
    expect(calls.find((call) => call.method === 'DELETE')?.url).toBe('/api/projects/p1/tasks/a');
    expect(within(screen.getAllByTestId('task-row')[0]).getByText('100.00%')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
