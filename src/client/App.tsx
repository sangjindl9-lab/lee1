import { useCallback, useEffect, useState } from 'react';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ProjectListPage, { type Notify } from './pages/ProjectListPage';

export const PRODUCT_NAME = '프로젝트일정표';

/** 성공 알림이 저절로 사라지기까지의 시간(ms). 오류 알림은 닫을 때까지 남습니다. */
export const NOTICE_TIMEOUT_MS = 4000;

export type Route = { page: 'list' } | { page: 'detail'; projectId: string } | { page: 'notFound' };

/** 해시(#/, #/projects/:id)를 화면으로 바꿉니다. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '');
  if (path === '') return { page: 'list' };
  const match = /^\/projects\/([^/]+)$/.exec(path);
  if (match) {
    try {
      return { page: 'detail', projectId: decodeURIComponent(match[1]) };
    } catch {
      return { page: 'notFound' };
    }
  }
  return { page: 'notFound' };
}

interface Notice {
  id: number;
  type: 'success' | 'error';
  message: string;
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    function onHashChange() {
      setRoute(parseRoute(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const notify = useCallback<Notify>((type, message) => {
    setNotice({ id: Date.now() + Math.random(), type, message });
  }, []);

  useEffect(() => {
    if (!notice || notice.type !== 'success') return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  let page;
  if (route.page === 'list') {
    page = <ProjectListPage notify={notify} />;
  } else if (route.page === 'detail') {
    page = <ProjectDetailPage key={route.projectId} projectId={route.projectId} notify={notify} />;
  } else {
    page = (
      <section className="page">
        <div className="state state-error">
          <p>찾으시는 화면이 없습니다.</p>
          <a href="#/">프로젝트 목록으로</a>
        </div>
      </section>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <a href="#/">{PRODUCT_NAME}</a>
        </h1>
        <p className="app-subtitle">보할 방식 공정표</p>
      </header>

      <div className="notice-area" aria-live="polite">
        {notice && (
          <div
            key={notice.id}
            className={`alert alert-${notice.type}`}
            role={notice.type === 'error' ? 'alert' : 'status'}
          >
            <span>{notice.message}</span>
            <button type="button" className="alert-close" aria-label="알림 닫기" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}
      </div>

      <main className="app-main">{page}</main>
    </div>
  );
}
