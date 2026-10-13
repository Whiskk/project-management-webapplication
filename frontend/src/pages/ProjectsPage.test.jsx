import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { projectsApi } from '../services/projectsApi';
import { usersApi } from '../services/usersApi';
import { makeProject } from '../test/fixtures';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import ProjectsPage from './ProjectsPage';

function renderAs(role) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:projectId" element={<p>Project detail page</p>} />
    </Routes>,
    { auth: fakeAuth({ user: TEST_USERS[role] }), route: '/projects' },
  );
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'list').mockResolvedValue({ items: [makeProject()], total: 1 });
});

describe('ProjectsPage', () => {
  it('lists projects with status, dates and budget', async () => {
    renderAs('admin');
    const table = await screen.findByRole('table', { name: 'Projects' });
    expect(within(table).getByText('Apollo')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByText('Nov 13, 2026')).toBeInTheDocument();
    expect(within(table).getByText('$50,000')).toBeInTheDocument();
  });

  it('opens a project when its row is clicked', async () => {
    renderAs('manager');
    await userEvent.click(await screen.findByText('Customer portal rebuild'));
    expect(screen.getByText('Project detail page')).toBeInTheDocument();
  });

  it('sends filters to the API', async () => {
    renderAs('admin');
    await screen.findByText('Apollo');
    await userEvent.click(screen.getByRole('combobox', { name: /^Show/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Archived' }));
    await waitFor(() => expect(projectsApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ archived: 'true', page: 1 }), expect.anything(),
    ));
  });

  it('shows employees their assigned projects without budgets or archive filter', async () => {
    projectsApi.list.mockResolvedValue({ items: [makeProject({ budget: null })], total: 1 });
    renderAs('employee');
    expect(await screen.findByText('Apollo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My projects' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Budget' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Show/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('shows a role-specific empty state', async () => {
    projectsApi.list.mockResolvedValue({ items: [], total: 0 });
    renderAs('employee');
    expect(await screen.findByText('You are not assigned to any projects yet.')).toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    projectsApi.list.mockRejectedValueOnce(new ApiError(0, 'network_error', 'Unable to reach the server.'));
    renderAs('admin');
    expect(await screen.findByText('Unable to reach the server.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Apollo')).toBeInTheDocument();
  });

  it('lets admins create a project and opens it', async () => {
    vi.spyOn(usersApi, 'list').mockResolvedValue({ items: [TEST_USERS.manager], total: 1 });
    const create = vi.spyOn(projectsApi, 'create').mockResolvedValue(makeProject({ id: 12, name: 'Gemini' }));
    renderAs('admin');
    await screen.findByText('Apollo');
    await userEvent.click(screen.getByRole('button', { name: 'New project' }));

    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Project name/), 'Gemini');
    await userEvent.type(within(dialog).getByLabelText(/Start date/), '2026-11-02');
    await userEvent.type(within(dialog).getByLabelText(/Predicted end date/), '2026-12-18');
    await userEvent.type(within(dialog).getByLabelText(/Budget/), '75000');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Project manager/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Morgan Manager (MGR001)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Gemini', start_date: '2026-11-02', predicted_end_date: '2026-12-18',
      budget: 75000, manager_id: TEST_USERS.manager.id, status: 'planned',
    }));
    expect(await screen.findByText('Project detail page')).toBeInTheDocument();
  });
});
