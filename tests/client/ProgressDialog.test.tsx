import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProgressDialog from '../../src/client/components/ProgressDialog';
import ProjectDetailPage from '../../src/client/pages/ProjectDetailPage';
import type { ProgressRecord } from '../../src/shared/types';
import { emptyResponse, errorResponse, exampleData, fakeServer, jsonResponse, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BELOW_EARLIER = '진척률은 이전 기록보다 작을 수 없습니다.';
const task = { taskId: 'a', name: '공종 A' };

function record(date: string, percent: number): ProgressRecord {
  return { id: `r-${date}`, taskId: 'a', date, percent };
}

function renderDialog(records: ProgressRecord[] = []) {
  const props = { onChanged: vi.fn(), onClose: vi.fn() };
  render(<ProgressDialog projectId="p1" task={task} records={records} {...props} />);
  return props;
}

function enter(date: string, percent: string) {
  fireEvent.change(screen.getByLabelText('날짜'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('누계 진척률(%)'), { target: { value: percent } });
  fireEvent.click(screen.getByRole('button', { name: '실적 저장' }));
}

describe('ProgressDialog', () => {
  it('선택한 공종의 실적 기록을 날짜순으로 표시하고 날짜·누계 진척률 입력란을 제공한다', () => {
    mockFetch(() => undefined);
    renderDialog([record('2026-01-20', 80), record('2026-01-10', 30.5)]);

    expect(screen.getByRole('dialog', { name: '실적 입력 — 공종 A' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('progress-row');
    expect(rows.map((row) => row.textContent)).toEqual(['2026.01.1030.50%삭제', '2026.01.2080.00%삭제']);
    expect(screen.getByLabelText('날짜')).toBeInTheDocument();
    expect(screen.getByLabelText('누계 진척률(%)')).toHaveValue('');
  });

  it('기록이 없으면 안내 문구를 표시한다', () => {
    mockFetch(() => undefined);
    renderDialog();

    expect(screen.getByText('등록된 실적 기록이 없습니다.')).toBeInTheDocument();
  });

  it('날짜와 진척률을 저장하면 PUT progress에 본문을 보내고 onChanged를 호출한다 (AC-F5-1)', async () => {
    const calls = mockFetch(({ method }) => (method === 'PUT' ? jsonResponse(record('2026-01-15', 50)) : undefined));
    const { onChanged } = renderDialog();

    enter('2026-01-15', '50');

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      { method: 'PUT', url: '/api/projects/p1/tasks/a/progress', body: { date: '2026-01-15', percent: 50 } },
    ]);
    // 저장한 뒤에는 다음 기록을 바로 입력할 수 있게 진척률 입력란을 비운다.
    expect(screen.getByLabelText('누계 진척률(%)')).toHaveValue('');
  });

  it('서버가 400으로 거부하면 서버 메시지를 대화상자와 입력란 아래에 표시한다 (AC-F5-4)', async () => {
    // 화면이 가진 기록 목록에는 없지만 서버에는 2026-01-15, 50% 기록이 있는 경우
    mockFetch(() => errorResponse(400, 'VALIDATION_ERROR', BELOW_EARLIER, { percent: BELOW_EARLIER }));
    const { onChanged } = renderDialog();

    enter('2026-01-20', '40');

    expect(await screen.findByRole('alert')).toHaveTextContent(BELOW_EARLIER);
    const input = screen.getByLabelText('누계 진척률(%)');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.parentElement).toHaveTextContent(BELOW_EARLIER);
    expect(input).toHaveValue('40');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '실적 저장' })).toBeEnabled();
  });

  it('이전 기록보다 작은 값은 요청을 보내기 전에 오류로 표시한다 (AC-F5-4)', () => {
    const calls = mockFetch(() => undefined);
    renderDialog([record('2026-01-15', 50)]);

    enter('2026-01-20', '40');

    expect(screen.getByLabelText('누계 진척률(%)').parentElement).toHaveTextContent(BELOW_EARLIER);
    expect(calls).toHaveLength(0);
  });

  it.each(['-1', '100.5', 'abc', ''])('진척률이 "%s"이면 오류를 표시하고 요청을 보내지 않는다 (AC-F5-3)', (value) => {
    const calls = mockFetch(() => undefined);
    renderDialog();

    enter('2026-01-15', value);

    expect(screen.getByText('진척률은 0부터 100 사이의 숫자로 입력하세요.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('날짜를 비우면 날짜 입력란 아래에 오류를 표시한다', () => {
    const calls = mockFetch(() => undefined);
    renderDialog();

    enter('', '10');

    expect(screen.getByLabelText('날짜').parentElement).toHaveTextContent('날짜를 입력하세요.');
    expect(calls).toHaveLength(0);
  });

  it('기록의 삭제 버튼을 누르면 DELETE progress/:date를 보내고 onChanged를 호출한다 (AC-F5-9)', async () => {
    const calls = mockFetch(({ method }) => (method === 'DELETE' ? emptyResponse(204) : undefined));
    const { onChanged } = renderDialog([record('2026-01-10', 30), record('2026-01-20', 80)]);

    fireEvent.click(screen.getByRole('button', { name: '2026.01.20 실적 삭제' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      { method: 'DELETE', url: '/api/projects/p1/tasks/a/progress/2026-01-20', body: undefined },
    ]);
  });

  it('삭제에 실패하면 서버 메시지를 표시한다', async () => {
    mockFetch(() => errorResponse(404, 'NOT_FOUND', '실적 기록을 찾을 수 없습니다.'));
    const { onChanged } = renderDialog([record('2026-01-10', 30)]);

    fireEvent.click(screen.getByRole('button', { name: '2026.01.10 실적 삭제' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('실적 기록을 찾을 수 없습니다.');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('닫기 버튼과 Esc 키로 닫는다', () => {
    mockFetch(() => undefined);
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('ProjectDetailPage 실적 입력', () => {
  it('실적을 저장하면 기록 목록과 현재 진척률이 바뀌고, 삭제하면 되돌아간다 (AC-F5-1, AC-F5-9)', async () => {
    const data = exampleData();
    mockFetch(fakeServer(data, '2026-02-28'));
    render(<ProjectDetailPage projectId="p1" notify={vi.fn()} />);

    const rowA = () => screen.getAllByTestId('task-row')[0];
    await screen.findByRole('heading', { level: 2, name: '예제 프로젝트' });
    expect(within(rowA()).getByText('0.00%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '공종 A 실적 입력' }));
    const dialog = within(screen.getByRole('dialog', { name: '실적 입력 — 공종 A' }));
    expect(dialog.getByText('등록된 실적 기록이 없습니다.')).toBeInTheDocument();

    enter('2026-01-15', '50');

    await waitFor(() => expect(dialog.getAllByTestId('progress-row')).toHaveLength(1));
    expect(dialog.getByTestId('progress-row')).toHaveTextContent('2026.01.15');
    expect(dialog.getByTestId('progress-row')).toHaveTextContent('50.00%');
    expect(within(rowA()).getByText('50.00%')).toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: '2026.01.15 실적 삭제' }));

    await waitFor(() => expect(dialog.queryByTestId('progress-row')).not.toBeInTheDocument());
    expect(within(rowA()).getByText('0.00%')).toBeInTheDocument();
  });
});
