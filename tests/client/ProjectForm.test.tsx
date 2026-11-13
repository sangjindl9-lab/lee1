import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectForm from '../../src/client/components/ProjectForm';
import { errorResponse, jsonResponse, makeProject, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
}

describe('ProjectForm', () => {
  it('이름, 설명, 시작일, 종료일, 보할 기준 입력란을 가진 대화상자를 표시한다', () => {
    mockFetch(() => undefined);
    render(<ProjectForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '새 프로젝트' })).toBeInTheDocument();
    expect(screen.getByLabelText('프로젝트 이름')).toHaveValue('');
    expect(screen.getByLabelText('설명')).toBeInTheDocument();
    expect(screen.getByLabelText('시작일')).toBeInTheDocument();
    expect(screen.getByLabelText('종료일')).toBeInTheDocument();
    // 보할 기준을 고르지 않으면 금액 기준이다. (AC-F1-4)
    expect(screen.getByLabelText('보할 기준')).toHaveValue('amount');
  });

  it('이름이 비어 있으면 입력란 아래에 오류를 표시하고 API를 호출하지 않는다 (AC-F1-2)', () => {
    const calls = mockFetch(() => undefined);
    const onSaved = vi.fn();
    render(<ProjectForm onSaved={onSaved} onCancel={vi.fn()} />);

    fill('프로젝트 이름', '   ');
    fill('시작일', '2026-01-01');
    fill('종료일', '2026-06-30');
    save();

    const nameInput = screen.getByLabelText('프로젝트 이름');
    const message = screen.getByText('프로젝트 이름을 입력하세요.');
    expect(message).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', message.id);
    expect(nameInput.parentElement).toContainElement(message);
    expect(calls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('종료일이 시작일보다 이르면 종료일 아래에 오류를 표시하고 API를 호출하지 않는다 (AC-F1-3)', () => {
    const calls = mockFetch(() => undefined);
    render(<ProjectForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    fill('프로젝트 이름', '신축 공사');
    fill('시작일', '2026-06-30');
    fill('종료일', '2026-01-01');
    save();

    const message = screen.getByText('종료일은 시작일보다 빠를 수 없습니다.');
    expect(screen.getByLabelText('종료일').parentElement).toContainElement(message);
    expect(screen.getByLabelText('종료일')).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toHaveLength(0);
  });

  it('날짜를 입력하지 않으면 각 입력란 아래에 오류를 표시한다', () => {
    const calls = mockFetch(() => undefined);
    render(<ProjectForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    fill('프로젝트 이름', '신축 공사');
    save();

    expect(screen.getByText('시작일을 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('종료일을 입력하세요.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('정상 입력을 저장하면 POST /api/projects에 입력한 본문을 보내고 onSaved를 호출한다', async () => {
    const created = makeProject({ id: 'new-id', name: '신축 공사', description: '본관 신축', weightBasis: 'manual' });
    const calls = mockFetch(({ method, url }) =>
      method === 'POST' && url === '/api/projects' ? jsonResponse(created, 201) : undefined,
    );
    const onSaved = vi.fn();
    render(<ProjectForm onSaved={onSaved} onCancel={vi.fn()} />);

    fill('프로젝트 이름', '  신축 공사  ');
    fill('설명', '본관 신축');
    fill('시작일', '2026-01-01');
    fill('종료일', '2026-06-30');
    fill('보할 기준', 'manual');
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/projects',
        body: {
          name: '신축 공사',
          description: '본관 신축',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
          weightBasis: 'manual',
        },
      },
    ]);
  });

  it('수정할 때는 기존 값을 채워 보여 주고 PUT /api/projects/:id로 저장한다', async () => {
    const project = makeProject({ id: 'p1', name: '신축 공사', description: '설명' });
    const updated = { ...project, name: '증축 공사' };
    const calls = mockFetch(({ method, url }) =>
      method === 'PUT' && url === '/api/projects/p1' ? jsonResponse(updated) : undefined,
    );
    const onSaved = vi.fn();
    render(<ProjectForm project={project} onSaved={onSaved} onCancel={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '프로젝트 수정' })).toBeInTheDocument();
    expect(screen.getByLabelText('프로젝트 이름')).toHaveValue('신축 공사');
    expect(screen.getByLabelText('시작일')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('종료일')).toHaveValue('2026-06-30');

    fill('프로젝트 이름', '증축 공사');
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toEqual({
      name: '증축 공사',
      description: '설명',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      weightBasis: 'amount',
    });
  });

  it('서버가 400으로 거부하면 서버 메시지를 대화상자와 해당 입력란 아래에 표시한다', async () => {
    const message = '프로젝트 기간은 등록된 공종의 기간을 모두 포함해야 합니다.';
    mockFetch(() => errorResponse(400, 'VALIDATION_ERROR', message, { endDate: message }));
    const onSaved = vi.fn();
    render(<ProjectForm project={makeProject()} onSaved={onSaved} onCancel={vi.fn()} />);

    fill('종료일', '2026-03-31');
    save();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    const endInput = screen.getByLabelText('종료일');
    expect(endInput).toHaveAttribute('aria-invalid', 'true');
    expect(endInput.parentElement).toHaveTextContent(message);
    expect(onSaved).not.toHaveBeenCalled();
    // 실패한 뒤에도 다시 저장할 수 있다.
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();
  });

  it('서버에 연결하지 못하면 한국어 안내를 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<ProjectForm project={makeProject()} onSaved={vi.fn()} onCancel={vi.fn()} />);

    save();

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다.');
  });

  it('취소 버튼과 Esc 키로 닫는다', () => {
    mockFetch(() => undefined);
    const onCancel = vi.fn();
    render(<ProjectForm onSaved={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
