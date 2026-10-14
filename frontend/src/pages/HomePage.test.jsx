import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../services/api';
import { projectsApi } from '../services/projectsApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import HomePage from './HomePage';

const OVER_BUDGET = { code: 'over_budget', severity: 'error', message: 'Projected labour cost is $500.00 over budget.' };

function renderAs(role, dashboard) {
  vi.spyOn(projectsApi, 'dashboard').mockResolvedValue(dashboard);
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'ok', database: 'ok', schema_version: 3 });
  return renderWithProviders(<HomePage />, { auth: fakeAuth({ user: TEST_USERS[role] }) });
}

describe('HomePage dashboards', () => {
  it('shows admins organisation totals, attention list and system status', async () => {
    renderAs('admin', {
      role: 'admin',
      stats: {
        active_projects: 4, over_budget: 1, needing_attention: 2, pending_requests: 3,
        people: { admin: 1, manager: 2, employee: 9 }, total_budget: 200000, total_projected_cost: 150000,
      },
      attention: [{
        id: 7, name: 'Apollo', manager_name: 'Morgan Manager', predicted_end_date: '2026-11-30',
        insights: [OVER_BUDGET, { code: 'no_milestones', severity: 'info', message: 'No milestones yet.' }],
      }],
    });
    expect(await screen.findByText('Requests to review')).toBeInTheDocument();
    expect(screen.getByText('$150,000')).toBeInTheDocument();
    const attention = screen.getByRole('list', { name: 'Projects needing attention' });
    expect(within(attention).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/7');
    expect(within(attention).getByText('Over budget')).toBeInTheDocument();
    expect(within(attention).queryByText('No milestones')).not.toBeInTheDocument(); // info insights left out
    expect(await screen.findByText('Schema v3')).toBeInTheDocument();
  });

  it('shows managers their team load and waiting decisions', async () => {
    renderAs('manager', {
      role: 'manager',
      stats: { my_projects: 2, needing_attention: 0, approvals_waiting: 1, my_pending_requests: 0 },
      attention: [],
      projects: [],
      team: [{ id: 3, first_name: 'Eli', last_name: 'Employee', hours_this_week: 30, capacity: 40, available: 10 }],
    });
    expect(await screen.findByText('Your projects are on budget and on schedule.')).toBeInTheDocument();
    expect(screen.getByText('30 h of 40 h')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Approvals waiting/ })).toHaveAttribute('href', '/approvals');
  });

  it('shows employees their week, projects and upcoming milestones', async () => {
    renderAs('employee', {
      role: 'employee',
      stats: { hours_this_week: 25, hours_awaiting_approval: 5, capacity: 40, my_projects: 2 },
      projects: [
        { id: 7, name: 'Apollo', predicted_end_date: '2026-11-30', my_hours_per_week: 25, milestones: { total: 4, completed: 1 } },
        { id: 8, name: 'Gemini', predicted_end_date: '2026-12-18', my_hours_per_week: null, milestones: { total: 0, completed: 0 } },
      ],
      upcoming_milestones: [{ id: 1, title: 'Design sign-off', project_name: 'Apollo', due_date: '2026-11-06', overdue: true }],
    });
    expect(await screen.findByText('5 h more awaiting your manager\'s approval')).toBeInTheDocument();
    expect(screen.getByText('25 h/week')).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    const milestones = screen.getByRole('list', { name: 'Upcoming milestones' });
    expect(within(milestones).getByText('Design sign-off')).toBeInTheDocument();
    expect(within(milestones).getByText('Overdue')).toBeInTheDocument();
  });

  it('shows a retryable error if the dashboard fails to load', async () => {
    const dashboard = vi.spyOn(projectsApi, 'dashboard')
      .mockRejectedValueOnce(new ApiError(0, 'network_error', 'Unable to reach the server.'))
      .mockResolvedValueOnce({
        role: 'employee', stats: { hours_this_week: 0, hours_awaiting_approval: 0, capacity: 40, my_projects: 0 },
        projects: [], upcoming_milestones: [],
      });
    renderWithProviders(<HomePage />, { auth: fakeAuth({ user: TEST_USERS.employee }) });
    expect(await screen.findByText('Unable to reach the server.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('You are not assigned to any projects yet.')).toBeInTheDocument();
    expect(dashboard).toHaveBeenCalledTimes(2);
  });
});
