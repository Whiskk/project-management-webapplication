import { Route, Routes } from 'react-router';
import RequireAuth from './auth/RequireAuth';
import RequirePermission from './auth/RequirePermission';
import AppShell from './components/layout/AppShell';
import ApprovalsPage from './pages/ApprovalsPage';
import AuditLogPage from './pages/AuditLogPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import ProfilePage from './pages/ProfilePage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ProjectsPage from './pages/ProjectsPage';
import RequestsPage from './pages/RequestsPage';
import UsersPage from './pages/UsersPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
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
