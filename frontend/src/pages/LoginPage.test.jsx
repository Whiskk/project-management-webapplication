import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { fakeAuth, renderWithProviders } from '../test/render';
import LoginPage from './LoginPage';

function renderLogin(auth, route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<p>Dashboard page</p>} />
      <Route path="/projects" element={<p>Projects page</p>} />
    </Routes>,
    { auth, route },
  );
}

const anonymous = (overrides) => fakeAuth({ status: 'anonymous', user: null, ...overrides });

describe('LoginPage', () => {
  it('shows field errors and does not submit when empty', async () => {
    const auth = anonymous();
    renderLogin(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Employee ID is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('signs in and returns to the page the user originally requested', async () => {
    const auth = anonymous({ login: vi.fn().mockResolvedValue({}) });
    renderLogin(auth, { pathname: '/login', state: { from: { pathname: '/projects' } } });
    await userEvent.type(screen.getByLabelText(/Employee ID/), ' emp001 ');
    await userEvent.type(screen.getByLabelText(/Password/), 'Empl01');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.login).toHaveBeenCalledWith('emp001', 'Empl01');
    expect(await screen.findByText('Projects page')).toBeInTheDocument();
  });

  it('shows the server error and re-enables the form on failure', async () => {
    const auth = anonymous({
      login: vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'Invalid employee ID or password')),
    });
    renderLogin(auth);
    await userEvent.type(screen.getByLabelText(/Employee ID/), 'EMP001');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid employee ID or password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('redirects users who are already signed in', () => {
    renderLogin(fakeAuth());
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });
});
