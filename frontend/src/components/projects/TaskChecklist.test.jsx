import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { projectsApi } from '../../services/projectsApi';
import { makeProject } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import TaskChecklist from './TaskChecklist';

const PROJECT = makeProject({ id: 7 });

function makeTask(overrides = {}) {
  return {
    id: 1,
    milestone_id: 2,
    title: 'Write release notes',
    description: '',
    assignee: { id: 3, name: 'Eli Employee', employee_id: 'EE3H9W' },
    done: false,
    completed_at: null,
    completed_by_name: null,
    can_tick: true,
    waiting_on: [],
    ...overrides,
  };
}

function renderChecklist({ tasks = [makeTask()], canEdit = false, status = 'in_progress' } = {}) {
  const onChanged = vi.fn();
  const milestone = { id: 2, title: 'Launch', status, tasks };
  renderWithProviders(<TaskChecklist project={PROJECT} milestone={milestone} canEdit={canEdit} onChanged={onChanged} />);
  return { onChanged };
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'completeTask').mockResolvedValue(makeTask({ done: true }));
  vi.spyOn(projectsApi, 'reopenTask').mockResolvedValue(makeTask());
  vi.spyOn(projectsApi, 'deleteTask').mockResolvedValue(null);
  vi.spyOn(projectsApi, 'team').mockResolvedValue({ items: [] });
});

describe('TaskChecklist', () => {
  it('lets the assignee tick a task off', async () => {
    const { onChanged } = renderChecklist();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Write release notes' }));
    expect(projectsApi.completeTask).toHaveBeenCalledWith(7, 1);
    expect(await screen.findByText("Completed 'Write release notes'")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('unticking a done task reopens it', async () => {
    renderChecklist({ tasks: [makeTask({ done: true, completed_by_name: 'Eli Employee' })] });
    const box = screen.getByRole('checkbox', { name: 'Write release notes' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(projectsApi.reopenTask).toHaveBeenCalledWith(7, 1);
  });

  it.each([
    ['someone else\'s task', { can_tick: false }],
    ['a task waiting on an earlier milestone', { waiting_on: ['Design'] }],
  ])('disables the checkbox for %s', (_label, overrides) => {
    renderChecklist({ tasks: [makeTask(overrides)] });
    expect(screen.getByRole('checkbox', { name: 'Write release notes' })).toBeDisabled();
  });

  it('keeps done tasks locked while the milestone is completed', () => {
    renderChecklist({ tasks: [makeTask({ done: true })], canEdit: true, status: 'completed' });
    expect(screen.getByRole('checkbox', { name: 'Write release notes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
  });

  it('shows who each task is assigned to', () => {
    renderChecklist({ tasks: [makeTask(), makeTask({ id: 2, title: 'Announce', assignee: null })] });
    const list = screen.getByRole('list', { name: 'Tasks in Launch' });
    expect(within(list).getByText('Eli Employee')).toBeInTheDocument();
    expect(within(list).getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows an error and stays unchanged when the server refuses', async () => {
    projectsApi.completeTask.mockRejectedValueOnce(
      new ApiError(409, 'conflict', "Tasks in 'Launch' can't be ticked off until these are completed: Design"),
    );
    const { onChanged } = renderChecklist();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Write release notes' }));
    expect(await screen.findByText(/can't be ticked off until these are completed: Design/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('hides add, edit and delete from people who cannot plan the project', () => {
    renderChecklist();
    expect(screen.queryByRole('button', { name: 'Add task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit task Write release notes' })).not.toBeInTheDocument();
  });

  it('managers delete a task after confirming', async () => {
    const { onChanged } = renderChecklist({ canEdit: true });
    await userEvent.click(screen.getByRole('button', { name: 'Delete task Write release notes' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(projectsApi.deleteTask).toHaveBeenCalledWith(7, 1);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('managers open the task dialog to add or edit', async () => {
    renderChecklist({ canEdit: true });
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByRole('dialog', { name: 'New task in Launch' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit task Write release notes' }));
    expect(screen.getByRole('dialog', { name: 'Edit Write release notes' })).toBeInTheDocument();
  });

  it('says so when a milestone has no tasks', () => {
    renderChecklist({ tasks: [] });
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
  });
});
