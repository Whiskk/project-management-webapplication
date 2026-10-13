import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { projectsApi } from '../../services/projectsApi';
import { usersApi } from '../../services/usersApi';
import { makeProject } from '../../test/fixtures';
import { renderWithProviders, TEST_USERS } from '../../test/render';
import ProjectFormDialog from './ProjectFormDialog';

function renderDialog(props) {
  vi.spyOn(usersApi, 'list').mockResolvedValue({ items: [TEST_USERS.manager], total: 1 });
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  renderWithProviders(<ProjectFormDialog open project={null} editorRole="admin" {...handlers} {...props} />);
  return handlers;
}

describe('ProjectFormDialog', () => {
  it('validates required fields and date order', async () => {
    const create = vi.spyOn(projectsApi, 'create');
    renderDialog();
    await userEvent.type(screen.getByLabelText(/Start date/), '2026-11-10');
    await userEvent.type(screen.getByLabelText(/Predicted end date/), '2026-11-01');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByText('Project name is required')).toBeInTheDocument();
    expect(screen.getByText('Must be on or after the start date')).toBeInTheDocument();
    expect(screen.getByText('Enter a budget of 0 or more')).toBeInTheDocument();
    expect(screen.getByText('Every project needs a manager')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('limits managers to schedule, budget, status and description', async () => {
    const update = vi.spyOn(projectsApi, 'update').mockResolvedValue(makeProject({ budget: 65000 }));
    const { onSaved } = renderDialog({ project: makeProject(), editorRole: 'manager' });
    expect(screen.queryByLabelText(/Project name/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Project manager/ })).not.toBeInTheDocument();

    const budget = screen.getByLabelText(/Budget/);
    await userEvent.clear(budget);
    await userEvent.type(budget, '65000');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith(7, { budget: 65000 });
    expect(onSaved).toHaveBeenCalled();
  });

  it('closes without saving when nothing changed', async () => {
    const update = vi.spyOn(projectsApi, 'update');
    const { onClose } = renderDialog({ project: makeProject() });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
