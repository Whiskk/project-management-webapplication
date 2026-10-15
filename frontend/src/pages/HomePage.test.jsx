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

  it('lets admins run the budget check on demand', async () => {
    renderAs('admin', {
      role: 'admin',
      stats: {
        active_projects: 1, over_budget: 0, needing_attention: 0, pending_requests: 0,
        people: { admin: 1, manager: 1, employee: 1 }, total_budget: 1000, total_projected_cost: 900,
      },
      attention: [],
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      checked: 3, newly_over_budget: ['Apollo'], back_within_budget: [], still_over_budget: 0,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Run budget check now' }));
    expect(post).toHaveBeenCalledWith('monitor', '/run');
    expect(await screen.findByText('Budget check found changes - now over budget: Apollo')).toBeInTheDocument();
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

  it('shows employees their week, projects, schedule and upcoming milestones', async () => {
    renderAs('employee', {
      role: 'employee',
      stats: { hours_this_week: 25, hours_awaiting_approval: 5, capacity: 40, my_projects: 2 },
      projects: [
        { id: 7, name: 'Apollo', predicted_end_date: '2026-11-30', my_hours_per_week: 25, milestones: { total: 4, completed: 1 } },
        { id: 8, name: 'Gemini', predicted_end_date: '2026-12-18', my_hours_per_week: null, milestones: { total: 0, completed: 0 } },
      ],
      upcoming_milestones: [{ id: 1, title: 'Design sign-off', project_name: 'Apollo', due_date: '2026-11-06', overdue: true }],
      schedule: [{
        project_id: 7, name: 'Apollo', status: 'active', start_date: '2026-10-01', predicted_end_date: '2026-11-30',
        hours_per_week: 25, pending_hours: null, milestones: [],
      }],
    });
    expect(await screen.findByText('5 h more awaiting your manager\'s approval')).toBeInTheDocument();
    expect(screen.getByText('About 5 h a day of your 8-hour day')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'My projects' })).getByText('25 h/week · 5 h a day')).toBeInTheDocument();
    const schedule = screen.getByRole('list', { name: 'My projects over the next 12 weeks' });
    expect(within(schedule).getByRole('link', { name: 'Apollo' })).toBeInTheDocument();
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    const milestones = screen.getByRole('list', { name: 'Upcoming milestones' });
    expect(within(milestones).getByText('Design sign-off')).toBeInTheDocument();
    expect(within(milestones).getByText('Overdue')).toBeInTheDocument();
  });

  it('shows employees what changed for them', async () => {
    renderAs('employee', {
      role: 'employee',
      stats: { hours_this_week: 0, hours_awaiting_approval: 0, capacity: 40, my_projects: 0 },
      projects: [],
      upcoming_milestones: [],
      whats_new: {
        since: null, window_days: 14, new_count: 1,
        items: [{ id: 1, occurred_at: '2026-10-14T09:00:00Z', kind: 'assignment', text: 'Morgan Manager added you to Apollo for 10 h/week', project_id: 7, project_name: 'Apollo', is_new: true }],
      },
    });
    const list = await screen.findByRole('list', { name: "What's new" });
    expect(within(list).getByText('Morgan Manager added you to Apollo for 10 h/week')).toBeInTheDocument();
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

  it('lets employees tick off their tasks from the dashboard', async () => {
    const dashboard = {
      role: 'employee', stats: { hours_this_week: 20, hours_awaiting_approval: 0, capacity: 40, my_projects: 1, open_tasks: 2 },
      projects: [], upcoming_milestones: [],
      my_tasks: [
        { id: 4, title: 'Write release notes', milestone_title: 'Launch', due_date: '2026-11-20', project_id: 7, project_name: 'Apollo', waiting: false },
        { id: 5, title: 'Implement API', milestone_title: 'Build', due_date: '2026-11-27', project_id: 7, project_name: 'Apollo', waiting: true },
      ],
    };
    const load = vi.spyOn(projectsApi, 'dashboard').mockResolvedValue(dashboard);
    const complete = vi.spyOn(projectsApi, 'completeTask').mockResolvedValue({});
    renderWithProviders(<HomePage />, { auth: fakeAuth({ user: TEST_USERS.employee }) });
    const list = await screen.findByRole('list', { name: 'My tasks' });
    expect(within(list).getByText('Waiting on an earlier milestone to be completed')).toBeInTheDocument();
    expect(within(list).getByRole('checkbox', { name: 'Implement API' })).toBeDisabled();
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Write release notes' }));
    expect(complete).toHaveBeenCalledWith(7, 4);
    expect(await screen.findByText("Completed 'Write release notes'")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2); // reloaded after ticking
  });

  it('tells employees when they have no open tasks', async () => {
    renderAs('employee', {
      role: 'employee', stats: { hours_this_week: 0, hours_awaiting_approval: 0, capacity: 40, my_projects: 0, open_tasks: 0 },
      projects: [], upcoming_milestones: [], my_tasks: [],
    });
    expect(await screen.findByText('You have no open tasks.')).toBeInTheDocument();
  });
});
