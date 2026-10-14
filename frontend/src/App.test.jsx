import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './services/api';
import { projectsApi } from './services/projectsApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from './test/render';

const ADMIN_DASHBOARD = {
  role: 'admin',
  stats: {
    active_projects: 0, over_budget: 0, needing_attention: 0, pending_requests: 0,
    people: { admin: 1, manager: 1, employee: 1 }, total_budget: 0, total_projected_cost: 0,
  },
  attention: [],
};
const healthy = () => {
  vi.spyOn(projectsApi, 'dashboard').mockResolvedValue(ADMIN_DASHBOARD);
  return vi.spyOn(api, 'get').mockResolvedValue({ status: 'ok', database: 'ok', schema_version: 1 });
};

describe('App routing and layout', () => {
  it('renders the dashboard with a mobile navigation drawer', async () => {
    // jsdom has no viewport width, so the shell renders its mobile layout.
    healthy();
    renderWithProviders(<App />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('API online')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveClass('active');
  });

  it('greets the signed-in user with their role', async () => {
    healthy();
    projectsApi.dashboard.mockResolvedValue({
      role: 'manager',
      stats: { my_projects: 0, needing_attention: 0, approvals_waiting: 0, my_pending_requests: 0 },
      attention: [], projects: [], team: [],
    });
    vi.spyOn(projectsApi, 'approvals').mockResolvedValue({ items: [], total: 0 });
    renderWithProviders(<App />, { auth: fakeAuth({ user: TEST_USERS.manager }) });
    expect(screen.getByText('Welcome back, Morgan. You are signed in as Manager.')).toBeInTheDocument();
    expect(await screen.findByText('My team this week')).toBeInTheDocument();
  });

  it('shows managers an Approvals link with a pending count', async () => {
    healthy();
    projectsApi.dashboard.mockResolvedValue({
      role: 'manager',
      stats: { my_projects: 0, needing_attention: 0, approvals_waiting: 2, my_pending_requests: 0 },
      attention: [], projects: [], team: [],
    });
    vi.spyOn(projectsApi, 'approvals').mockResolvedValue({ items: [], total: 2 });
    renderWithProviders(<App />, { auth: fakeAuth({ user: TEST_USERS.manager }) });
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('link', { name: /Approvals/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('2 awaiting approval')).toBeInTheDocument();
  });

  it('does not show Approvals to admins or employees', async () => {
    healthy();
    projectsApi.dashboard.mockResolvedValue({
      role: 'employee', stats: { hours_this_week: 0, hours_awaiting_approval: 0, capacity: 40, my_projects: 0 },
      projects: [], upcoming_milestones: [],
    });
    const approvals = vi.spyOn(projectsApi, 'approvals');
    renderWithProviders(<App />, { auth: fakeAuth({ user: TEST_USERS.employee }) });
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.queryByRole('link', { name: /Approvals/ })).not.toBeInTheDocument();
    expect(approvals).not.toHaveBeenCalled();
  });

  it('signs out from the account menu', async () => {
    healthy();
    const auth = fakeAuth();
    renderWithProviders(<App />, { auth });
    await userEvent.click(screen.getByRole('button', { name: 'Account menu for Alex Admin' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it('sends anonymous visitors to the login page', () => {
    renderWithProviders(<App />, { auth: fakeAuth({ status: 'anonymous', user: null }) });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a not-found page with a link back to the dashboard', async () => {
    healthy();
    renderWithProviders(<App />, { route: '/does-not-exist' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to dashboard' }));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
