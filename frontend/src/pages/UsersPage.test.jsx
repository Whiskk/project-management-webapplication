import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { usersApi } from '../services/usersApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import UsersPage from './UsersPage';

const ROWS = [
  { ...TEST_USERS.admin, salary: 120000, is_active: true, manager_name: null },
  { ...TEST_USERS.manager, salary: 110000, is_active: true, manager_name: null },
  { ...TEST_USERS.employee, salary: 90000, is_active: true, manager_name: 'Morgan Manager' },
];

function renderAs(role) {
  return renderWithProviders(<UsersPage />, { auth: fakeAuth({ user: TEST_USERS[role] }) });
}

beforeEach(() => {
  vi.spyOn(usersApi, 'list').mockResolvedValue({ items: ROWS, total: ROWS.length });
});

describe('UsersPage', () => {
  it('lists users with roles, managers and salaries', async () => {
    renderAs('admin');
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByText('Eli Employee')).toBeInTheDocument();
    expect(within(table).getByText('Morgan Manager', { selector: 'td' })).toBeInTheDocument();
    expect(within(table).getByText('$90,000')).toBeInTheDocument();
  });

  it('shows a retryable error when loading fails', async () => {
    usersApi.list.mockRejectedValueOnce(new ApiError(500, 'internal_error', 'Something went wrong.'));
    renderAs('admin');
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Eli Employee')).toBeInTheDocument();
  });

  it('sends search and filters to the API, resetting to page 1', async () => {
    renderAs('admin');
    await screen.findByText('Eli Employee');
    await userEvent.type(screen.getByLabelText('Search'), 'eli');
    await waitFor(() => expect(usersApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'eli', page: 1, status: 'active' }), expect.anything(),
    ));
  });

  it('lets admins create a user and shows the one-time password', async () => {
    vi.spyOn(usersApi, 'create').mockResolvedValue({
      user: { ...TEST_USERS.employee, id: 9, employee_id: 'NN4F7R', first_name: 'Nia', last_name: 'Newhire' },
      temporary_password: 'Ab3dE9',
    });
    renderAs('admin');
    await screen.findByText('Eli Employee');

    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/First name/), 'Nia');
    await userEvent.type(within(dialog).getByLabelText(/Last name/), 'Newhire');
    await userEvent.type(within(dialog).getByLabelText(/Email/), 'nia@example.com');
    await userEvent.type(within(dialog).getByLabelText(/Annual salary/), '80000');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Manager/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Morgan Manager (MM4R8T)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(usersApi.create).toHaveBeenCalledWith({
      first_name: 'Nia', last_name: 'Newhire', email: 'nia@example.com', job_title: '',
      role: 'employee', salary: 80000, manager_id: TEST_USERS.manager.id,
    });
    expect(await screen.findByTestId('temporary-password')).toHaveTextContent('Ab3dE9');
    expect(screen.getByText('This password will not be shown again.')).toBeInTheDocument();
  });

  it('deactivates a user after confirmation', async () => {
    vi.spyOn(usersApi, 'deactivate').mockResolvedValue({});
    renderAs('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Eli Employee' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(usersApi.deactivate).toHaveBeenCalledWith(TEST_USERS.employee.id);
    expect(await screen.findByText('Eli Employee deactivated')).toBeInTheDocument();
  });

  it('shows the API error when an action is refused', async () => {
    vi.spyOn(usersApi, 'deactivate').mockRejectedValue(
      new ApiError(409, 'conflict', 'Cannot deactivate: they still have 1 direct report(s)'),
    );
    renderAs('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Morgan Manager' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Deactivate' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText(/still have 1 direct report/)).toBeInTheDocument();
  });

  it('does not offer admins actions on themselves that would lock them out', async () => {
    renderAs('admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Alex Admin' }));
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('limits managers to editing their direct reports', async () => {
    renderAs('manager');
    await screen.findByText('Eli Employee');
    expect(screen.queryByRole('button', { name: 'New user' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Eli Employee' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Alex Admin' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Eli Employee' }));
    expect(screen.queryByRole('menuitem', { name: 'Reset password' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/Annual salary/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: /^Role/ })).not.toBeInTheDocument();
  });

  it('filters managers to their direct reports', async () => {
    renderAs('manager');
    await screen.findByText('Eli Employee');
    await userEvent.click(screen.getByLabelText('My direct reports'));
    await waitFor(() => expect(usersApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ manager_id: TEST_USERS.manager.id }), expect.anything(),
    ));
  });
});
