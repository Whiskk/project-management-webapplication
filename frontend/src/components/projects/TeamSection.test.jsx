import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { projectsApi } from '../../services/projectsApi';
import { makeAssignment, makeProject, makeStaffingOption } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import TeamSection from './TeamSection';

// Budget $50,000 with $49,000 already committed -> $1,000 left ($100 per weekly hour).
const PROJECT = makeProject({ budget: 50000, projected_cost: 49000, remaining_budget: 1000 });

function renderTeam(props = {}) {
  const onChanged = vi.fn();
  renderWithProviders(<TeamSection project={PROJECT} canStaff showCosts onChanged={onChanged} {...props} />);
  return onChanged;
}

async function openAssignDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('combobox', { name: /Employee/ }));
  await userEvent.click(await screen.findByRole('option', { name: /Eli Employee/ }));
  return dialog;
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'team').mockResolvedValue({ items: [makeAssignment()] });
  vi.spyOn(projectsApi, 'staffingOptions').mockResolvedValue({ items: [makeStaffingOption()] });
});

describe('TeamSection', () => {
  it('lists the team with hours and costs', async () => {
    renderTeam();
    const table = await screen.findByRole('table', { name: 'Team' });
    expect(within(table).getByText('Eli Employee')).toBeInTheDocument();
    expect(within(table).getByText('10 h')).toBeInTheDocument();
    expect(within(table).getByText('$1,000')).toBeInTheDocument();
  });

  it('is read-only without staffing rights and hides costs', async () => {
    renderTeam({ canStaff: false, showCosts: false });
    await screen.findByText('Eli Employee');
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Cost' })).not.toBeInTheDocument();
  });

  it('previews cost and assigns within budget and hours', async () => {
    vi.spyOn(projectsApi, 'assign').mockResolvedValue(makeAssignment());
    const onChanged = renderTeam();
    const dialog = await openAssignDialog();
    expect(within(dialog).getByText('15 h available during this project')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/Hours per week/), '10');
    expect(within(dialog).getByText('$1,000')).toBeInTheDocument(); // cost of this assignment
    expect(within(dialog).getByText('$0')).toBeInTheDocument(); // remaining budget after
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    expect(projectsApi.assign).toHaveBeenCalledWith(PROJECT.id, { user_id: makeStaffingOption().user_id, hours_per_week: 10 });
    expect(await screen.findByText('Eli Employee assigned to Apollo')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('blocks assignments that exceed the employee\'s free hours', async () => {
    renderTeam();
    const dialog = await openAssignDialog();
    await userEvent.type(within(dialog).getByLabelText(/Hours per week/), '16');
    expect(within(dialog).getByText(/Only 15 h available/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('blocks assignments that exceed the budget', async () => {
    renderTeam();
    const dialog = await openAssignDialog();
    await userEvent.type(within(dialog).getByLabelText(/Hours per week/), '11');
    expect(within(dialog).getByText(/would exceed the project budget/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('shows the server message if the rules changed in the meantime', async () => {
    vi.spyOn(projectsApi, 'assign').mockRejectedValue(
      new ApiError(409, 'conflict', 'Eli Employee would be scheduled for 45 hours per week', { hours_per_week: 'At most 5 hours available' }),
    );
    renderTeam();
    const dialog = await openAssignDialog();
    await userEvent.type(within(dialog).getByLabelText(/Hours per week/), '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await within(dialog).findByText(/45 hours per week/)).toBeInTheDocument();
    expect(within(dialog).getByText('At most 5 hours available')).toBeInTheDocument();
  });

  it('lets reducing hours through even on an over-budget project', async () => {
    vi.spyOn(projectsApi, 'updateAssignment').mockResolvedValue(makeAssignment({ hours_per_week: 8 }));
    renderTeam({ project: makeProject({ budget: 1000, projected_cost: 2000, remaining_budget: -1000, over_budget: true }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Change hours for Eli Employee' }));
    const dialog = screen.getByRole('dialog');
    const hours = within(dialog).getByLabelText(/Hours per week/);
    await screen.findByText(/available during this project/);
    await userEvent.clear(hours);
    await userEvent.type(hours, '8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save hours' }));
    expect(projectsApi.updateAssignment).toHaveBeenCalledWith(PROJECT.id, 31, { hours_per_week: 8 });
  });

  it('removes a member after confirmation', async () => {
    vi.spyOn(projectsApi, 'removeAssignment').mockResolvedValue(null);
    const onChanged = renderTeam();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Eli Employee' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(projectsApi.removeAssignment).toHaveBeenCalledWith(PROJECT.id, 31);
    expect(await screen.findByText('Eli Employee removed from Apollo')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});
