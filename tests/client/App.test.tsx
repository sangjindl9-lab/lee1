import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { parseRoute } from '../../src/client/App';
import { jsonResponse, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('App', () => {
  it("제품명 '프로젝트일정표'를 공통 머리말에 표시하고 첫 화면으로 프로젝트 목록을 연다", async () => {
    mockFetch(() => jsonResponse([]));
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: '프로젝트일정표' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '프로젝트 목록' })).toBeInTheDocument();
    expect(await screen.findByText('아직 등록된 프로젝트가 없습니다.')).toBeInTheDocument();
  });

  it('jsdom 환경에서 실행된다', () => {
    expect(typeof window).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });
});

describe('parseRoute', () => {
  it('해시를 화면으로 바꾼다', () => {
    expect(parseRoute('')).toEqual({ page: 'list' });
    expect(parseRoute('#')).toEqual({ page: 'list' });
    expect(parseRoute('#/')).toEqual({ page: 'list' });
    expect(parseRoute('#/projects/abc-123')).toEqual({ page: 'detail', projectId: 'abc-123' });
    expect(parseRoute('#/projects/abc-123/')).toEqual({ page: 'detail', projectId: 'abc-123' });
    expect(parseRoute('#/projects')).toEqual({ page: 'notFound' });
    expect(parseRoute('#/projects/a/b')).toEqual({ page: 'notFound' });
    expect(parseRoute('#/elsewhere')).toEqual({ page: 'notFound' });
  });
});
