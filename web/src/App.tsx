import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client';
import { ErrorState, Loading } from './components/common';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './context/Auth';
import { BrandingProvider, BrandMark } from './context/Branding';
import { RealtimeProvider } from './context/Realtime';
import { AlarmsPage } from './pages/Alarms';
import { ApprovalsPage } from './pages/Approvals';
import { AuditPage } from './pages/Audit';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { MfaSetupPage } from './pages/MfaSetup';
import { SitesPage } from './pages/Sites';
import { SmartboxDetailPage } from './pages/SmartboxDetail';
import { UsersPage } from './pages/Users';

function Gate() {
  const { status, refresh, logout } = useAuth();
  if (status === 'loading') return <Loading text="세션 확인 중…" />;
  if (status === 'anon') return <LoginPage />;
  if (status === 'mfa_setup') return <MfaSetupPage />;
  if (status === 'unreachable')
    return (
      <div className="auth-page">
        <div className="auth-box">
          <BrandMark />
          <ErrorState error={new ApiError(0, 'NETWORK', '관제 서버에 연결할 수 없습니다.')} onRetry={() => void refresh()} />
          <button className="btn btn-block" onClick={() => void logout()}>
            로그인 화면으로
          </button>
        </div>
      </div>
    );
  return (
    <RealtimeProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="smartboxes/:id" element={<SmartboxDetailPage />} />
          <Route path="alarms" element={<AlarmsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="sites" element={<SitesPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </RealtimeProvider>
  );
}

export function App() {
  return (
    <BrandingProvider>
      <AuthProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </AuthProvider>
    </BrandingProvider>
  );
}
