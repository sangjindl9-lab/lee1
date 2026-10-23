import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Layout from './components/Layout'
import ProjectHome from './pages/ProjectHome'
import FilesPage from './pages/FilesPage'
import EstimatePage from './pages/EstimatePage'
import ClaimsPage from './pages/ClaimsPage'
import ClaimEditor from './pages/ClaimEditor'
import ChangesPage from './pages/ChangesPage'
import ChangeEditor from './pages/ChangeEditor'
import CostRulesPage from './pages/CostRulesPage'
import UnitPricesPage from './pages/UnitPricesPage'
import AdminPage from './pages/AdminPage'
import AuditPage from './pages/AuditPage'

function Private({ children }: { children: React.ReactNode }) {
  return localStorage.getItem('token') ? <>{children}</> : <Navigate to="/login" replace />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Private><Layout /></Private>}>
          <Route index element={<Dashboard />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="projects/:pid" element={<ProjectHome />} />
          <Route path="projects/:pid/files" element={<FilesPage />} />
          <Route path="projects/:pid/estimate" element={<EstimatePage />} />
          <Route path="projects/:pid/claims" element={<ClaimsPage />} />
          <Route path="projects/:pid/claims/:cid" element={<ClaimEditor />} />
          <Route path="projects/:pid/changes" element={<ChangesPage />} />
          <Route path="projects/:pid/changes/:cid" element={<ChangeEditor />} />
          <Route path="projects/:pid/cost-rules" element={<CostRulesPage />} />
          <Route path="projects/:pid/unit-prices" element={<UnitPricesPage />} />
          <Route path="projects/:pid/audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
