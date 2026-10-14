import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { projectsApi } from '../services/projectsApi';
import { usersApi } from '../services/usersApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import RequestsPage from './RequestsPage';

function makeRequest(overrides = {}) {
  return {
    id: 5,
    name: 'Gemini',
    description: 'Payments platform',
    start_date: '2026-12-07',
    predicted_end_date: '2027-01-29',
    budget: 80000,
    justification: 'Needed for the Q1 launch',
    status: 'pending',
    requested_by: TEST_USERS.manager.id,
    requested_by_name: 'Morgan Manager',
    requested_by_employee_id: 'MM4R8T',
    created_at: '2026-10-14T09:00:00Z',
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: '',
    project_id: null,
    project_name: null,
    ...overrides,
  };
}

function renderAs(role) {
  return renderWithProviders(<RequestsPage />, { auth: fakeAuth({ user: TEST_USERS[role] }) });
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'requests').mockResolvedValue({ items: [makeRequest()], total: 1, pending: 1 });
  vi.spyOn(usersApi, 'list').mockResolvedValue({ items: [TEST_USERS.manager], total: 1 });
});

describe('RequestsPage as a manager', () => {
  it('submits a new request', async () => {
    const submit = vi.spyOn(projectsApi, 'submitRequest').mockResolvedValue(makeRequest({ id: 6, name: 'Apollo 2' }));
    renderAs('manager');
    await screen.findByText('Gemini');
    await userEvent.click(screen.getByRole('button', { name: 'New request' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    expect(within(dialog).getByText('Explain why this project is needed')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText(/Project name/), 'Apollo 2');
    await userEvent.type(within(dialog).getByLabelText(/Start date/), '2027-01-04');
    await userEvent.type(within(dialog).getByLabelText(/Predicted end date/), '2027-02-26');
    await userEvent.type(within(dialog).getByLabelText(/Budget/), '40000');
    await userEvent.type(within(dialog).getByLabelText(/Justification/), 'Follow-up phase');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    expect(submit).toHaveBeenCalledWith({
      name: 'Apollo 2', description: '', start_date: '2027-01-04', predicted_end_date: '2027-02-26',
      budget: 40000, justification: 'Follow-up phase',
    });
    expect(await screen.findByText("Request for 'Apollo 2' sent to the admins")).toBeInTheDocument();
  });

  it('withdraws a pending request and cannot approve', async () => {
    const withdraw = vi.spyOn(projectsApi, 'withdrawRequest').mockResolvedValue(makeRequest({ status: 'withdrawn' }));
    renderAs('manager');
    const card = await screen.findByRole('article', { name: 'Request for Gemini' });
    expect(within(card).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Withdraw' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
    expect(withdraw).toHaveBeenCalledWith(5);
  });

  it('shows the outcome and links to the created project', async () => {
    projectsApi.requests.mockResolvedValue({
      items: [
        makeRequest({ status: 'approved', reviewed_by_name: 'Alex Admin', project_id: 12, project_name: 'Gemini' }),
        makeRequest({ id: 6, name: 'Hermes', status: 'rejected', reviewed_by_name: 'Alex Admin', review_note: 'Budget frozen' }),
      ],
      total: 2,
      pending: 0,
    });
    renderAs('manager');
    expect(await screen.findByRole('link', { name: 'Gemini' })).toHaveAttribute('href', '/projects/12');
    expect(screen.getByText('Alex Admin: Budget frozen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });
});

describe('RequestsPage as an admin', () => {
  it('starts on pending requests and can switch filter', async () => {
    renderAs('admin');
    await screen.findByText('Gemini');
    expect(projectsApi.requests).toHaveBeenCalledWith({ status: 'pending' }, expect.anything());
    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(projectsApi.requests).toHaveBeenLastCalledWith({ status: '' }, expect.anything()));
  });

  it('approves with an adjusted budget, sending only what changed', async () => {
    const approve = vi.spyOn(projectsApi, 'approveRequest').mockResolvedValue(
      makeRequest({ status: 'approved', project_id: 12, project_name: 'Gemini' }),
    );
    renderAs('admin');
    const card = await screen.findByRole('article', { name: 'Request for Gemini' });
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    const budget = within(dialog).getByLabelText(/Budget/);
    await userEvent.clear(budget);
    await userEvent.type(budget, '60000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and create project' }));
    expect(approve).toHaveBeenCalledWith(5, { budget: 60000 });
    expect(await screen.findByText("Approved - project 'Gemini' created")).toBeInTheDocument();
  });

  it('requires a reason to reject', async () => {
    const reject = vi.spyOn(projectsApi, 'rejectRequest').mockResolvedValue(makeRequest({ status: 'rejected' }));
    renderAs('admin');
    const card = await screen.findByRole('article', { name: 'Request for Gemini' });
    await userEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(within(dialog).getByText('Give a reason so the manager knows why')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Budget frozen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(reject).toHaveBeenCalledWith(5, 'Budget frozen');
  });

  it('asks for a new manager if the requester is no longer one', async () => {
    vi.spyOn(projectsApi, 'approveRequest').mockRejectedValue(new ApiError(
      409, 'conflict', 'Morgan Manager is no longer an active manager. Choose who will manage this project.',
      { manager_id: 'Must be an active manager' },
    ));
    renderAs('admin');
    const card = await screen.findByRole('article', { name: 'Request for Gemini' });
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and create project' }));
    expect(await within(dialog).findByText(/no longer an active manager/)).toBeInTheDocument();
    expect(within(dialog).getByText('Must be an active manager')).toBeInTheDocument();
  });
});
