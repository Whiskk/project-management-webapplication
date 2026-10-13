import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './services/api';
import { projectsApi } from './services/projectsApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from './test/render';

const healthy = () => vi.spyOn(api, 'get').mockResolvedValue({ status: 'ok', database: 'ok', schema_version: 1 });

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
    renderWithProviders(<App />, { auth: fakeAuth({ user: TEST_USERS.manager }) });
    expect(screen.getByText('Welcome back, Morgan. You are signed in as Manager.')).toBeInTheDocument();
    await screen.findByText('API online');
  });

  it('shows managers an Approvals link with a pending count', async () => {
    healthy();
    vi.spyOn(projectsApi, 'approvals').mockResolvedValue({ items: [], total: 2 });
    renderWithProviders(<App />, { auth: fakeAuth({ user: TEST_USERS.manager }) });
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('link', { name: /Approvals/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('2 awaiting approval')).toBeInTheDocument();
  });

  it('does not show Approvals to admins or employees', async () => {
    healthy();
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
