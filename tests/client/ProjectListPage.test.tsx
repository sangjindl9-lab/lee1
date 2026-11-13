import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import ProjectListPage from '../../src/client/pages/ProjectListPage';
import { emptyResponse, errorResponse, fakeServer, jsonResponse, makeProject, makeSummary, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const first = makeSummary({
  id: 'p1',
  name: '신축 공사',
  startDate: '2026-01-01',
  endDate: '2026-06-30',
  taskCount: 3,
  plannedToDate: 42.5,
  actualToDate: 38.125,
  status: 'behind',
});
const second = makeSummary({
  id: 'p2',
  name: '리모델링',
  startDate: '2026-03-01',
  endDate: '2026-04-15',
  taskCount: 0,
  plannedToDate: 0,
  actualToDate: 0,
  variance: 0,
  status: 'onTrack',
});

describe('ProjectListPage', () => {
  it('불러오는 동안 안내를 표시한 뒤 프로젝트 카드에 이름, 기간, 공종 수, 계획·실적 누계, 상태를 표시한다 (AC-F1-5)', async () => {
    const calls = mockFetch(({ method, url }) =>
      method === 'GET' && url === '/api/projects' ? jsonResponse([first, second]) : undefined,
    );
    render(<ProjectListPage notify={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('프로젝트 목록을 불러오는 중입니다');

    const cards = await screen.findAllByTestId('project-card');
    expect(cards).toHaveLength(2);
    expect(calls).toHaveLength(1);

    const card = within(cards[0]);
    expect(card.getByRole('heading', { name: '신축 공사' })).toBeInTheDocument();
    expect(card.getByText('2026.01.01 ~ 2026.06.30')).toBeInTheDocument();
    expect(card.getByText('3개')).toBeInTheDocument();
    expect(card.getByText('지연')).toBeInTheDocument();

    const planned = card.getByRole('progressbar', { name: '계획 누계' });
    expect(planned).toHaveAttribute('aria-valuenow', '42.5');
    expect(planned).toHaveAttribute('aria-valuetext', '42.50%');
    expect(card.getByText('42.50%')).toBeInTheDocument();
    const actual = card.getByRole('progressbar', { name: '실적 누계' });
    expect(actual).toHaveAttribute('aria-valuetext', '38.13%');
    expect(card.getByText('38.13%')).toBeInTheDocument();

    // 카드를 누르면 상세 화면 주소로 이동한다.
    expect(card.getByRole('link')).toHaveAttribute('href', '#/projects/p1');

    const other = within(cards[1]);
    expect(other.getByText('리모델링')).toBeInTheDocument();
    expect(other.getByText('0개')).toBeInTheDocument();
    expect(other.getByText('정상')).toBeInTheDocument();
  });

  it('프로젝트가 없으면 빈 상태 문구와 만들기 버튼을 표시한다', async () => {
    mockFetch(() => jsonResponse([]));
    render(<ProjectListPage notify={vi.fn()} />);

    expect(await screen.findByText('아직 등록된 프로젝트가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByTestId('project-card')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '첫 프로젝트 만들기' }));
    expect(screen.getByRole('dialog', { name: '새 프로젝트' })).toBeInTheDocument();
  });

  it('목록을 불러오지 못하면 서버 메시지를 표시하고 다시 시도할 수 있다', async () => {
    let attempt = 0;
    mockFetch(() => {
      attempt += 1;
      return attempt === 1
        ? errorResponse(500, 'INTERNAL_ERROR', '서버에서 오류가 발생했습니다.')
        : jsonResponse([first]);
    });
    render(<ProjectListPage notify={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('프로젝트 목록을 불러오지 못했습니다.');
    expect(alert).toHaveTextContent('서버에서 오류가 발생했습니다.');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(await screen.findByText('신축 공사')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('새 프로젝트를 저장하면 대화상자를 닫고 목록을 다시 불러오며 알림을 보낸다 (AC-F1-1)', async () => {
    const created = makeProject({ id: 'p3', name: '도로 포장' });
    let saved = false;
    const calls = mockFetch(({ method, url }) => {
      if (method === 'POST' && url === '/api/projects') {
        saved = true;
        return jsonResponse(created, 201);
      }
      if (method === 'GET' && url === '/api/projects') {
        return jsonResponse(saved ? [makeSummary({ ...created, taskCount: 0 })] : []);
      }
      return undefined;
    });
    const notify = vi.fn();
    render(<ProjectListPage notify={notify} />);
    await screen.findByText('아직 등록된 프로젝트가 없습니다.');

    fireEvent.click(screen.getByRole('button', { name: '새 프로젝트' }));
    fireEvent.change(screen.getByLabelText('프로젝트 이름'), { target: { value: '도로 포장' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('heading', { name: '도로 포장' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith('success', "'도로 포장' 프로젝트를 만들었습니다.");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/projects',
      'POST /api/projects',
      'GET /api/projects',
    ]);
  });

  it('수정 버튼을 누르면 기존 값이 채워진 대화상자가 열린다', async () => {
    mockFetch(() => jsonResponse([first]));
    render(<ProjectListPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '신축 공사 수정' }));

    expect(screen.getByRole('dialog', { name: '프로젝트 수정' })).toBeInTheDocument();
    expect(screen.getByLabelText('프로젝트 이름')).toHaveValue('신축 공사');
  });

  it('삭제 버튼을 누르면 확인 창이 뜨고, 확인하면 DELETE를 호출해 목록에서 지운다 (AC-F1-7)', async () => {
    const calls = mockFetch(({ method, url }) => {
      if (method === 'GET') return jsonResponse([first, second]);
      if (method === 'DELETE' && url === '/api/projects/p1') return emptyResponse(204);
      return undefined;
    });
    const notify = vi.fn();
    render(<ProjectListPage notify={notify} />);

    fireEvent.click(await screen.findByRole('button', { name: '신축 공사 삭제' }));

    const confirm = screen.getByRole('alertdialog', { name: '프로젝트 삭제' });
    expect(confirm).toHaveTextContent("'신축 공사' 프로젝트를 삭제할까요?");
    // 확인하기 전에는 삭제 요청을 보내지 않는다.
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(screen.queryByText('신축 공사')).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('리모델링')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
      { method: 'DELETE', url: '/api/projects/p1', body: undefined },
    ]);
    expect(notify).toHaveBeenCalledWith('success', "'신축 공사' 프로젝트를 삭제했습니다.");
  });

  it('삭제 확인 창에서 취소하면 DELETE를 호출하지 않는다', async () => {
    const calls = mockFetch(({ method }) => (method === 'GET' ? jsonResponse([first]) : undefined));
    render(<ProjectListPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '신축 공사 삭제' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('신축 공사')).toBeInTheDocument();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('삭제에 실패하면 오류 알림을 보내고 카드를 남긴다', async () => {
    mockFetch(({ method }) =>
      method === 'GET'
        ? jsonResponse([first])
        : errorResponse(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'),
    );
    const notify = vi.fn();
    render(<ProjectListPage notify={notify} />);

    fireEvent.click(await screen.findByRole('button', { name: '신축 공사 삭제' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith('error', '프로젝트를 찾을 수 없습니다.'));
    expect(screen.getByText('신축 공사')).toBeInTheDocument();
  });
});

describe('App 라우팅과 알림', () => {
  it('#/projects/:id 에서 프로젝트 이름과 기간, 목록으로 돌아가는 링크를 표시한다', async () => {
    const project = makeProject({ id: 'p1', name: '신축 공사', weightBasis: 'manual' });
    // 상세 화면은 프로젝트와 공정표 계산 결과를 함께 불러온다.
    const calls = mockFetch(fakeServer({ project, tasks: [], progress: [] }));
    window.location.hash = '#/projects/p1';
    render(<App />);

    expect(await screen.findByRole('heading', { level: 2, name: '신축 공사' })).toBeInTheDocument();
    expect(screen.getByText('2026.01.01 ~ 2026.06.30')).toBeInTheDocument();
    expect(screen.getByText('보할 기준').nextElementSibling).toHaveTextContent('가중치');
    expect(screen.getByRole('link', { name: /프로젝트 목록으로/ })).toHaveAttribute('href', '#/');
    expect(calls.map((call) => call.url).sort()).toEqual(['/api/projects/p1', '/api/projects/p1/schedule']);
  });

  it('없는 프로젝트의 상세 화면은 서버의 404 메시지를 표시한다', async () => {
    mockFetch(() => errorResponse(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'));
    window.location.hash = '#/projects/none';
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('프로젝트를 찾을 수 없습니다.');
  });

  it('해시가 바뀌면 목록에서 상세 화면으로 전환한다', async () => {
    const project = makeProject({ id: 'p1', name: '신축 공사' });
    const detailServer = fakeServer({ project, tasks: [], progress: [] });
    mockFetch((call) => (call.url === '/api/projects' ? jsonResponse([first]) : detailServer(call)));
    render(<App />);
    await screen.findByTestId('project-card');

    window.location.hash = '#/projects/p1';
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(await screen.findByRole('heading', { level: 2, name: '신축 공사' })).toBeInTheDocument();
    expect(screen.queryByTestId('project-card')).not.toBeInTheDocument();
  });

  it('알 수 없는 주소에서는 안내와 목록 링크를 표시한다', () => {
    mockFetch(() => undefined);
    window.location.hash = '#/unknown';
    render(<App />);

    expect(screen.getByText('찾으시는 화면이 없습니다.')).toBeInTheDocument();
  });

  it('삭제에 성공하면 상단 알림 영역에 결과를 표시하고 닫을 수 있다', async () => {
    mockFetch(({ method }) => (method === 'GET' ? jsonResponse([first]) : emptyResponse(204)));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '신축 공사 삭제' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }));

    expect(await screen.findByText("'신축 공사' 프로젝트를 삭제했습니다.")).toBeInTheDocument();
    expect(await screen.findByText('아직 등록된 프로젝트가 없습니다.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
    expect(screen.queryByText("'신축 공사' 프로젝트를 삭제했습니다.")).not.toBeInTheDocument();
  });
});
