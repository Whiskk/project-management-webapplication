import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import RequireAuth from './auth/RequireAuth';
import RequirePermission from './auth/RequirePermission';
import AppShell from './components/layout/AppShell';
import ChangePasswordPage from './pages/ChangePasswordPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';

// Pages most visits don't need are loaded on first use, keeping the initial bundle small
// (AppShell shows a spinner in the content area while one loads).
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const RequestsPage = lazy(() => import('./pages/RequestsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="change-password" element={<ChangePasswordPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route element={<RequirePermission permission="approvals.review" />}>
            <Route path="approvals" element={<ApprovalsPage />} />
          </Route>
          <Route element={<RequirePermission permission="audit.view" />}>
            <Route path="audit" element={<AuditLogPage />} />
          </Route>
          <Route element={<RequirePermission permission="requests.view" />}>
            <Route path="requests" element={<RequestsPage />} />
          </Route>
          <Route element={<RequirePermission permission="users.view" />}>
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
