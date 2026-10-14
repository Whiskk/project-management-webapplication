import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { projectsApi } from '../../services/projectsApi';
import { makeProject } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import TaskDialog from './TaskDialog';

const PROJECT = makeProject({ id: 7 });
const MILESTONE = { id: 2, title: 'Launch' };
const TEAM = [
  { user_id: 3, first_name: 'Eli', last_name: 'Employee', status: 'approved' },
  { user_id: 4, first_name: 'Tia', last_name: 'Test', status: 'approved' },
  { user_id: 5, first_name: 'Pia', last_name: 'Pending', status: 'pending' },
];

function renderDialog(task = null) {
  const onSaved = vi.fn();
  renderWithProviders(<TaskDialog project={PROJECT} milestone={MILESTONE} task={task} onClose={vi.fn()} onSaved={onSaved} />);
  return { onSaved };
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'team').mockResolvedValue({ items: TEAM });
  vi.spyOn(projectsApi, 'createTask').mockResolvedValue({ id: 1, title: 'Write release notes' });
  vi.spyOn(projectsApi, 'updateTask').mockResolvedValue({ id: 1, title: 'Write release notes' });
});

describe('TaskDialog', () => {
  it('requires a title before saving', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(projectsApi.createTask).not.toHaveBeenCalled();
  });

  it('offers only approved team members as assignees and creates the task', async () => {
    const { onSaved } = renderDialog();
    await userEvent.type(screen.getByLabelText(/^Title/), '  Write release notes ');
    await userEvent.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Unassigned', 'Eli Employee', 'Tia Test']);
    await userEvent.click(screen.getByRole('option', { name: 'Tia Test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(projectsApi.createTask).toHaveBeenCalledWith(7, 2, {
      title: 'Write release notes', description: '', assignee_id: 4,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('edits a task and can unassign it', async () => {
    renderDialog({ id: 1, title: 'Write release notes', description: 'v1', assignee: { id: 3, name: 'Eli Employee' } });
    await screen.findByRole('combobox', { name: /^Assignee/ });
    await userEvent.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Unassigned' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(projectsApi.updateTask).toHaveBeenCalledWith(7, 1, {
      title: 'Write release notes', description: 'v1', assignee_id: null,
    });
  });

  it('keeps a former team member selectable on a task they finished', async () => {
    renderDialog({ id: 1, title: 'Old work', description: '', assignee: { id: 99, name: 'Lee Left' } });
    await userEvent.click(screen.getByRole('combobox', { name: /^Assignee/ }));
    expect(await screen.findByRole('option', { name: 'Lee Left (not on the team)' })).toBeInTheDocument();
  });

  it('shows the server\'s field errors', async () => {
    projectsApi.createTask.mockRejectedValueOnce(new ApiError(400, 'validation_error', 'Validation failed', {
      assignee_id: "Must be an approved member of this project's team",
    }));
    renderDialog();
    await userEvent.type(screen.getByLabelText(/^Title/), 'Write release notes');
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText("Must be an approved member of this project's team")).toBeInTheDocument();
    expect(within(dialog).getByText('Validation failed')).toBeInTheDocument();
  });
});
