import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { usersApi } from '../../services/usersApi';
import { renderWithProviders, TEST_USERS } from '../../test/render';
import UserFormDialog from './UserFormDialog';

const EMPLOYEE = { ...TEST_USERS.employee, salary: 90000, is_active: true };

function renderDialog(props) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  renderWithProviders(<UserFormDialog open editorRole="admin" user={null} {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => {
  vi.spyOn(usersApi, 'list').mockResolvedValue({ items: [{ ...TEST_USERS.manager }], total: 1 });
});

describe('UserFormDialog', () => {
  it('validates required fields before submitting', async () => {
    const create = vi.spyOn(usersApi, 'create');
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(screen.getByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter an annual salary of 0 or more')).toBeInTheDocument();
    expect(screen.getByText('Employees must have a manager')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('hides the manager field for non-employee roles', async () => {
    renderDialog();
    expect(screen.getByRole('combobox', { name: /^Manager/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: /^Role/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Manager' }));
    // MUI includes the selected value in a select's name, so match the label prefix.
    expect(screen.queryByRole('combobox', { name: /^Manager/ })).not.toBeInTheDocument();
  });

  it('sends only changed fields when editing', async () => {
    const update = vi.spyOn(usersApi, 'update').mockResolvedValue({ ...EMPLOYEE, job_title: 'Lead' });
    const { onSaved } = renderDialog({ user: EMPLOYEE });
    const jobTitle = screen.getByLabelText(/Job title/);
    await userEvent.clear(jobTitle);
    await userEvent.type(jobTitle, 'Lead');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith(EMPLOYEE.id, { job_title: 'Lead' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('closes without a request when nothing changed', async () => {
    const update = vi.spyOn(usersApi, 'update');
    const { onClose } = renderDialog({ user: EMPLOYEE });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows server validation errors next to the field', async () => {
    vi.spyOn(usersApi, 'update').mockRejectedValue(
      new ApiError(400, 'validation_error', 'Validation failed', { email: 'This email is already in use' }),
    );
    renderDialog({ user: EMPLOYEE });
    const email = screen.getByLabelText(/Email/);
    await userEvent.clear(email);
    await userEvent.type(email, 'taken@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This email is already in use')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('only offers basic fields to managers', () => {
    renderDialog({ user: EMPLOYEE, editorRole: 'manager' });
    expect(screen.getByLabelText(/First name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Annual salary/)).not.toBeInTheDocument();
    expect(usersApi.list).not.toHaveBeenCalled();
  });
});
