import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import RequireAuth from '../auth/RequireAuth';
import { api, ApiError } from '../services/api';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import ChangePasswordPage from './ChangePasswordPage';

const NEW_HIRE = { ...TEST_USERS.employee, must_change_password: true };

function renderApp(auth, route) {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/" element={<p>Dashboard page</p>} />
        <Route path="/projects" element={<p>Projects page</p>} />
      </Route>
    </Routes>,
    { auth, route },
  );
}

async function fillForm({ current = 'Tmp4x9', next = 'Sunny2026', confirm = next } = {}) {
  await userEvent.type(screen.getByLabelText(/Temporary password/), current);
  await userEvent.type(screen.getByLabelText(/^New password/), next);
  await userEvent.type(screen.getByLabelText(/Confirm new password/), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Set password and continue' }));
}

describe('forced password change', () => {
  it('holds a user with a temporary password on the change-password page', () => {
    renderApp(fakeAuth({ user: NEW_HIRE }), '/projects');
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.queryByText('Projects page')).not.toBeInTheDocument();
  });

  it('lets everyone else straight through', () => {
    renderApp(fakeAuth({ user: TEST_USERS.employee }), '/change-password');
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('checks the password rules before submitting', async () => {
    const post = vi.spyOn(api, 'post');
    renderApp(fakeAuth({ user: NEW_HIRE }), '/change-password');
    await fillForm({ next: 'short', confirm: 'different' });
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('requires a letter and a number', async () => {
    renderApp(fakeAuth({ user: NEW_HIRE }), '/change-password');
    await fillForm({ next: 'onlyletters' });
    expect(screen.getByText('Must contain at least one letter and one number')).toBeInTheDocument();
  });

  it('changes the password and continues to the dashboard', async () => {
    const auth = fakeAuth({ user: NEW_HIRE, updateUser: vi.fn() });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...NEW_HIRE, must_change_password: false });
    renderApp(auth, '/change-password');
    await fillForm();
    expect(post).toHaveBeenCalledWith('auth', '/change-password', { current_password: 'Tmp4x9', new_password: 'Sunny2026' });
    expect(auth.updateUser).toHaveBeenCalledWith({ must_change_password: false });
  });

  it('shows the server error next to the field', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(
      400, 'validation_error', 'Validation failed', { current_password: 'Current password is incorrect' },
    ));
    renderApp(fakeAuth({ user: NEW_HIRE }), '/change-password');
    await fillForm();
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
  });

  it('can sign out instead', async () => {
    const auth = fakeAuth({ user: NEW_HIRE });
    renderApp(auth, '/change-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalled();
  });
});
