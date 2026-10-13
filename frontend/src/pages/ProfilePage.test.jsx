import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { usersApi } from '../services/usersApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import ProfilePage from './ProfilePage';

describe('ProfilePage', () => {
  it('shows read-only details and disables save until something changes', () => {
    renderWithProviders(<ProfilePage />, { auth: fakeAuth({ user: TEST_USERS.employee }) });
    expect(screen.getByText('EMP001')).toBeInTheDocument();
    expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('saves changed name/email and updates the signed-in user', async () => {
    const auth = fakeAuth({ user: TEST_USERS.employee, updateUser: vi.fn() });
    const updateMe = vi.spyOn(usersApi, 'updateMe').mockResolvedValue({
      ...TEST_USERS.employee, first_name: 'Elijah',
    });
    renderWithProviders(<ProfilePage />, { auth });

    const firstName = screen.getByLabelText(/First name/);
    await userEvent.clear(firstName);
    await userEvent.type(firstName, 'Elijah');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateMe).toHaveBeenCalledWith({ first_name: 'Elijah' });
    expect(auth.updateUser).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Elijah' }));
    expect(await screen.findByText('Profile updated')).toBeInTheDocument();
  });

  it('validates the email format', async () => {
    const updateMe = vi.spyOn(usersApi, 'updateMe');
    renderWithProviders(<ProfilePage />, { auth: fakeAuth({ user: TEST_USERS.employee, updateUser: vi.fn() }) });
    const email = screen.getByLabelText(/Email/);
    await userEvent.clear(email);
    await userEvent.type(email, 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(updateMe).not.toHaveBeenCalled();
  });
});
