import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TaskForm from '../../src/client/components/TaskForm';
import { errorResponse, jsonResponse, makeProject, makeTask, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const project = makeProject({ id: 'p1', startDate: '2026-01-01', endDate: '2026-03-31' });
const OUTSIDE_MESSAGE = '공종 기간은 프로젝트 기간 안에 있어야 합니다.';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
}

describe('TaskForm', () => {
  it('구분, 공종명, 금액, 시작일, 종료일 입력란을 표시하고 기간은 프로젝트 기간으로 채운다', () => {
    mockFetch(() => undefined);
    render(<TaskForm project={project} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '공종 추가' })).toBeInTheDocument();
    expect(screen.getByLabelText('구분')).toHaveValue('');
    expect(screen.getByLabelText('공종명')).toHaveValue('');
    expect(screen.getByLabelText('금액')).toHaveValue('');
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-03-31');
  });

  it('가중치 기준 프로젝트에서는 입력란 이름과 오류 문구가 "가중치"이다 (AC-F2-7)', () => {
    mockFetch(() => undefined);
    render(<TaskForm project={{ ...project, weightBasis: 'manual' }} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText('가중치')).toBeInTheDocument();
    expect(screen.queryByLabelText('금액')).not.toBeInTheDocument();

    fill('공종명', '골조');
    fill('가중치', '0');
    save();
    expect(screen.getByText('가중치는 0보다 큰 숫자로 입력하세요.')).toBeInTheDocument();
  });

  it.each(['0', '-5', 'abc', ''])(
    '금액이 "%s"이면 금액 입력란 아래에 오류를 표시하고 API를 호출하지 않는다 (AC-F2-2)',
    (value) => {
      const calls = mockFetch(() => undefined);
      const onSaved = vi.fn();
      render(<TaskForm project={project} onSaved={onSaved} onCancel={vi.fn()} />);

      fill('공종명', '골조');
      fill('금액', value);
      save();

      const input = screen.getByLabelText('금액');
      const message = screen.getByText('금액은 0보다 큰 숫자로 입력하세요.');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', message.id);
      expect(input.parentElement).toContainElement(message);
      expect(calls).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it('공종 기간이 프로젝트 기간을 벗어나면 오류를 표시하고 API를 호출하지 않는다 (AC-F2-4)', () => {
    const calls = mockFetch(() => undefined);
    render(<TaskForm project={project} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fill('공종명', '골조');
    fill('금액', '1000');
    fill('시작일', '2026-03-01');
    fill('종료일', '2026-04-15');
    save();

    const endInput = screen.getByLabelText('종료일');
    expect(endInput).toHaveAttribute('aria-invalid', 'true');
    expect(endInput.parentElement).toHaveTextContent(OUTSIDE_MESSAGE);
    expect(screen.getByLabelText('시작일')).not.toHaveAttribute('aria-invalid');
    expect(calls).toHaveLength(0);
  });

  it('시작일이 프로젝트 시작일보다 이르면 시작일 아래에 오류를 표시한다 (AC-F2-4)', () => {
    const calls = mockFetch(() => undefined);
    render(<TaskForm project={project} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fill('공종명', '골조');
    fill('금액', '1000');
    fill('시작일', '2025-12-15');
    fill('종료일', '2026-01-15');
    save();

    expect(screen.getByLabelText('시작일').parentElement).toHaveTextContent(OUTSIDE_MESSAGE);
    expect(calls).toHaveLength(0);
  });

  it('공종명이 없거나 종료일이 시작일보다 이르면 각 입력란 아래에 오류를 표시한다 (AC-F2-3)', () => {
    const calls = mockFetch(() => undefined);
    render(<TaskForm project={project} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fill('금액', '1000');
    fill('시작일', '2026-02-10');
    fill('종료일', '2026-02-01');
    save();

    expect(screen.getByLabelText('공종명').parentElement).toHaveTextContent('공종명을 입력하세요.');
    expect(screen.getByLabelText('종료일').parentElement).toHaveTextContent('종료일은 시작일보다 빠를 수 없습니다.');
    expect(calls).toHaveLength(0);
  });

  it('정상 입력을 저장하면 POST tasks에 입력한 본문을 보내고 onSaved를 호출한다 (AC-F2-1)', async () => {
    const created = makeTask({ id: 'new', name: '골조' });
    const calls = mockFetch(({ method }) => (method === 'POST' ? jsonResponse(created, 201) : undefined));
    const onSaved = vi.fn();
    render(<TaskForm project={project} onSaved={onSaved} onCancel={vi.fn()} />);

    fill('구분', ' 건축 ');
    fill('공종명', '  골조  ');
    fill('금액', '60,000,000');
    fill('시작일', '2026-01-10');
    fill('종료일', '2026-01-10');
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/projects/p1/tasks',
        body: {
          category: '건축',
          name: '골조',
          weightValue: 60_000_000,
          startDate: '2026-01-10',
          endDate: '2026-01-10',
        },
      },
    ]);
  });

  it('수정할 때는 기존 값을 채워 보여 주고 PUT tasks/:taskId로 저장한다', async () => {
    const task = makeTask({
      id: 't9',
      category: '토목',
      name: '터파기',
      weightValue: 1500.5,
      startDate: '2026-01-05',
      endDate: '2026-02-20',
    });
    const calls = mockFetch(({ method }) => (method === 'PUT' ? jsonResponse({ ...task, name: '흙막이' }) : undefined));
    const onSaved = vi.fn();
    render(<TaskForm project={project} task={task} onSaved={onSaved} onCancel={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '공종 수정' })).toBeInTheDocument();
    expect(screen.getByLabelText('구분')).toHaveValue('토목');
    expect(screen.getByLabelText('금액')).toHaveValue('1500.5');
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-01-05');

    fill('공종명', '흙막이');
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        method: 'PUT',
        url: '/api/projects/p1/tasks/t9',
        body: { category: '토목', name: '흙막이', weightValue: 1500.5, startDate: '2026-01-05', endDate: '2026-02-20' },
      },
    ]);
  });

  it('서버가 400으로 거부하면 서버 메시지를 대화상자와 해당 입력란 아래에 표시한다', async () => {
    mockFetch(() => errorResponse(400, 'VALIDATION_ERROR', OUTSIDE_MESSAGE, { endDate: OUTSIDE_MESSAGE }));
    const onSaved = vi.fn();
    render(<TaskForm project={project} onSaved={onSaved} onCancel={vi.fn()} />);

    fill('공종명', '골조');
    fill('금액', '1000');
    save();

    expect(await screen.findByRole('alert')).toHaveTextContent(OUTSIDE_MESSAGE);
    expect(screen.getByLabelText('종료일').parentElement).toHaveTextContent(OUTSIDE_MESSAGE);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
  });

  it('취소 버튼과 Esc 키로 닫는다', () => {
    mockFetch(() => undefined);
    const onCancel = vi.fn();
    render(<TaskForm project={project} onSaved={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
