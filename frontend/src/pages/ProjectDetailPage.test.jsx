import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { auditApi } from '../services/auditApi';
import { projectsApi } from '../services/projectsApi';
import { usersApi } from '../services/usersApi';
import { makeProject } from '../test/fixtures';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import ProjectDetailPage from './ProjectDetailPage';

function renderAs(role, project = makeProject()) {
  vi.spyOn(projectsApi, 'get').mockResolvedValue(project);
  vi.spyOn(projectsApi, 'team').mockResolvedValue({ items: [] });
  vi.spyOn(auditApi, 'list').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(projectsApi, 'milestones').mockResolvedValue({ items: [], summary: { total: 0, completed: 0, overdue: 0, percent_complete: 0 } });
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
    </Routes>,
    { auth: fakeAuth({ user: TEST_USERS[role] }), route: `/projects/${project.id}` },
  );
}

describe('ProjectDetailPage', () => {
  it('shows the project overview', async () => {
    renderAs('admin');
    expect(await screen.findByRole('heading', { name: 'Apollo' })).toBeInTheDocument();
    expect(screen.getByText('Managed by Morgan Manager (MGR001)')).toBeInTheDocument();
    expect(screen.getByText('80 h')).toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
    expect(screen.getByText('$3,000 projected labour · $47,000 left')).toBeInTheDocument();
    expect(screen.getByText('Customer portal rebuild')).toBeInTheDocument();
    expect(projectsApi.get).toHaveBeenCalledWith('7', expect.anything());
  });

  it('shows a friendly message for missing or hidden projects', async () => {
    vi.spyOn(projectsApi, 'get').mockRejectedValue(new ApiError(404, 'not_found', 'Project not found'));
    renderWithProviders(
      <Routes><Route path="/projects/:projectId" element={<ProjectDetailPage />} /></Routes>,
      { route: '/projects/999' },
    );
    expect(await screen.findByText('This project does not exist or you do not have access to it.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to projects' })).toBeInTheDocument();
  });

  it('gives admins edit and archive actions', async () => {
    renderAs('admin');
    await screen.findByRole('heading', { name: 'Apollo' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('lets the owning manager edit but not archive', async () => {
    renderAs('manager');
    await screen.findByRole('heading', { name: 'Apollo' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('is read-only for employees and shows their hours instead of the budget', async () => {
    renderAs('employee', makeProject({
      budget: null, projected_cost: undefined, remaining_budget: undefined, over_budget: undefined, my_hours_per_week: 10,
    }));
    await screen.findByRole('heading', { name: 'Apollo' });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    expect(screen.getByText('Your hours')).toBeInTheDocument();
    expect(screen.getByText('10 h')).toBeInTheDocument();
  });

  it('shows rule-based insights as alerts', async () => {
    renderAs('manager', makeProject({ insights: [
      { code: 'milestones_overdue', severity: 'error', message: '2 milestone(s) are overdue.' },
      { code: 'no_team', severity: 'warning', message: 'The project is active but nobody is assigned.' },
    ] }));
    const insights = await screen.findByLabelText('Project insights');
    expect(within(insights).getByText('2 milestone(s) are overdue.')).toBeInTheDocument();
    expect(within(insights).getByText('The project is active but nobody is assigned.')).toBeInTheDocument();
  });

  it('flags over-budget projects', async () => {
    renderAs('manager', makeProject({ projected_cost: 52000, remaining_budget: -2000, over_budget: true }));
    expect(await screen.findByText('Over budget')).toBeInTheDocument();
  });

  it('archives after confirmation and reloads', async () => {
    const archive = vi.spyOn(projectsApi, 'archive').mockResolvedValue({});
    renderAs('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith(7);
    expect(await screen.findByText('Apollo archived')).toBeInTheDocument();
    expect(projectsApi.get).toHaveBeenCalledTimes(2);
  });

  it('shows archived projects as read-only with a reactivate action', async () => {
    renderAs('admin', makeProject({ is_archived: true, archived_at: '2026-10-20T09:00:00Z' }));
    expect(await screen.findByText(/Archived on Oct 20, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('asks for a new manager when the old one is inactive', async () => {
    vi.spyOn(usersApi, 'list').mockResolvedValue({ items: [TEST_USERS.manager], total: 1 });
    const reactivate = vi.spyOn(projectsApi, 'reactivate')
      .mockRejectedValueOnce(new ApiError(409, 'conflict', 'The project\'s manager is no longer active.', { manager_id: 'Must be an active manager' }))
      .mockResolvedValueOnce(makeProject());
    renderAs('admin', makeProject({ is_archived: true, archived_at: '2026-10-20T09:00:00Z' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    expect(await within(dialog).findByText(/no longer active/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('combobox', { name: /^New project manager/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Morgan Manager (MGR001)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    expect(reactivate).toHaveBeenLastCalledWith(7, { manager_id: TEST_USERS.manager.id });
    expect(await screen.findByText('Apollo reactivated')).toBeInTheDocument();
  });
});
