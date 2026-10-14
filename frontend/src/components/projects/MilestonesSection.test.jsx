import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { projectsApi } from '../../services/projectsApi';
import { makeProject } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import MilestonesSection from './MilestonesSection';

const PROJECT = makeProject({ start_date: '2026-11-02', predicted_end_date: '2026-11-30' });

function makeMilestone(overrides = {}) {
  return {
    id: 1,
    title: 'Design',
    description: '',
    start_date: '2026-11-02',
    due_date: '2026-11-06',
    status: 'completed',
    completed_at: '2026-11-06T10:00:00Z',
    depends_on: [],
    dependents: [],
    blocked_by: [],
    can_start: true,
    overdue: false,
    past_project_end: false,
    tasks: [],
    tasks_total: 0,
    tasks_done: 0,
    ...overrides,
  };
}

const DESIGN = makeMilestone({ dependents: [{ id: 2, title: 'Build' }] });
const BUILD = makeMilestone({
  id: 2, title: 'Build', start_date: '2026-11-09', due_date: '2026-12-04', status: 'not_started', completed_at: null,
  depends_on: [{ id: 1, title: 'Design' }], overdue: true, past_project_end: true,
});

function renderSection(props = {}) {
  renderWithProviders(<MilestonesSection project={PROJECT} canEdit {...props} />);
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'milestones').mockResolvedValue({
    items: [DESIGN, BUILD],
    summary: { total: 2, completed: 1, overdue: 1, percent_complete: 50 },
  });
});

describe('MilestonesSection', () => {
  it('shows progress, statuses, dependencies and risk flags', async () => {
    renderSection();
    expect(await screen.findByText('1 of 2 completed (50%) · 1 overdue')).toBeInTheDocument();
    const build = screen.getByRole('listitem', { name: 'Build' });
    expect(within(build).getByText(/after Design/)).toBeInTheDocument();
    expect(within(build).getByText('Overdue')).toBeInTheDocument();
    expect(within(build).getByText('After project end')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Design' })).getByText('Completed')).toBeInTheDocument();
  });

  it('is read-only without edit rights', async () => {
    renderSection({ canEdit: false });
    await screen.findByText('Build');
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Build' })).not.toBeInTheDocument();
  });

  it('cannot delete a milestone others depend on', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: 'Delete Design' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Build' })).toBeEnabled();
  });

  it('adds a milestone with a dependency', async () => {
    const create = vi.spyOn(projectsApi, 'createMilestone').mockResolvedValue(makeMilestone({ id: 3, title: 'Launch' }));
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Add milestone' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Launch');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Depends on/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Design/ }));
    await userEvent.type(within(dialog).getByLabelText(/Start date/), '2026-11-09');
    await userEvent.type(within(dialog).getByLabelText(/Due date/), '2026-11-13');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add milestone' }));
    expect(create).toHaveBeenCalledWith(PROJECT.id, expect.objectContaining({
      title: 'Launch', depends_on: [1], start_date: '2026-11-09', due_date: '2026-11-13', status: 'not_started',
    }));
    expect(await screen.findByText("Milestone 'Launch' added")).toBeInTheDocument();
  });

  it('checks the schedule against dependencies before submitting', async () => {
    const create = vi.spyOn(projectsApi, 'createMilestone');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Add milestone' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Too early');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Depends on/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Build/ }));
    await userEvent.type(within(dialog).getByLabelText(/Start date/), '2026-11-10');
    await userEvent.type(within(dialog).getByLabelText(/Due date/), '2026-11-09');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /^Status/ }));
    await userEvent.click(screen.getByRole('option', { name: 'In progress' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add milestone' }));

    expect(within(dialog).getByText("Must be on or after Dec 4, 2026, when 'Build' is due")).toBeInTheDocument();
    expect(within(dialog).getByText('Must be on or after the start date')).toBeInTheDocument();
    expect(within(dialog).getByText('Waiting on: Build')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows server conflicts such as circular dependencies', async () => {
    vi.spyOn(projectsApi, 'updateMilestone').mockRejectedValue(
      new ApiError(409, 'conflict', 'That would create a circular dependency: Design → Build → Design'),
    );
    renderSection();
    // Valid as far as the dialog can tell, so the request reaches the server, which refuses it.
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Build' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), ' phase');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText(/circular dependency/)).toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    const remove = vi.spyOn(projectsApi, 'deleteMilestone').mockResolvedValue(null);
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Build' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith(PROJECT.id, 2);
    expect(await screen.findByText("Milestone 'Build' deleted")).toBeInTheDocument();
  });

  it('invites the first milestone when there are none', async () => {
    projectsApi.milestones.mockResolvedValue({ items: [], summary: { total: 0, completed: 0, overdue: 0, percent_complete: 0 } });
    renderSection();
    expect(await screen.findByText(/No milestones yet\. Add the first one/)).toBeInTheDocument();
  });

  it('opens a milestone\'s task checklist from its toggle and shows task progress', async () => {
    const task = {
      id: 9, milestone_id: 2, title: 'Implement API', description: '', done: false, completed_at: null,
      completed_by_name: null, can_tick: true, waiting_on: ['Design'],
      assignee: { id: 3, name: 'Eli Employee', employee_id: 'EE3H9W' },
    };
    projectsApi.milestones.mockResolvedValue({
      items: [DESIGN, { ...BUILD, tasks: [task], tasks_total: 1, tasks_done: 0 }],
      summary: { total: 2, completed: 1, overdue: 1, percent_complete: 50, tasks_total: 1, tasks_done: 0 },
    });
    renderSection();
    expect(await screen.findByText(/0 of 1 tasks done/)).toBeInTheDocument();
    const build = screen.getByRole('listitem', { name: 'Build' });
    const toggle = within(build).getByRole('button', { name: 'Tasks 0/1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const checklist = within(build).getByRole('list', { name: 'Tasks in Build' });
    expect(within(checklist).getByRole('checkbox', { name: 'Implement API' })).toBeDisabled(); // waiting on Design
    await userEvent.click(toggle);
    expect(within(build).queryByRole('list', { name: 'Tasks in Build' })).not.toBeInTheDocument();
  });
});
