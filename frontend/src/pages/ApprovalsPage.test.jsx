import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { projectsApi } from '../services/projectsApi';
import { fakeAuth, renderWithProviders, TEST_USERS } from '../test/render';
import ApprovalsPage from './ApprovalsPage';

function makeRequest(overrides = {}) {
  return {
    assignment_id: 31,
    project_id: 7,
    project_name: 'Apollo',
    project_manager_name: 'Pat Projectlead',
    start_date: '2026-11-02',
    predicted_end_date: '2026-11-13',
    user_id: 3,
    employee_id: 'EE3H9W',
    first_name: 'Eli',
    last_name: 'Employee',
    job_title: 'Software Engineer',
    kind: 'new',
    current_hours: null,
    requested_hours: 10,
    requested_by_name: 'Pat Projectlead',
    requested_at: '2026-10-13T10:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(<ApprovalsPage />, { auth: fakeAuth({ user: TEST_USERS.manager }) });
}

beforeEach(() => {
  vi.spyOn(projectsApi, 'approvals').mockResolvedValue({
    items: [makeRequest(), makeRequest({ assignment_id: 32, project_name: 'Gemini', kind: 'increase', current_hours: 10, requested_hours: 15 })],
    total: 2,
  });
});

describe('ApprovalsPage', () => {
  it('lists new assignments and increases with who asked', async () => {
    renderPage();
    const first = await screen.findByRole('article', { name: 'Request for Eli Employee on Apollo' });
    expect(within(first).getByText('10 h per week (new assignment)')).toBeInTheDocument();
    expect(within(first).getByText(/Requested by Pat Projectlead/)).toBeInTheDocument();
    expect(screen.getByText('10 h → 15 h per week')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/7');
  });

  it('approves a request and refreshes the list', async () => {
    vi.spyOn(projectsApi, 'approve').mockResolvedValue({});
    renderPage();
    const [first] = await screen.findAllByRole('article');
    await userEvent.click(within(first).getByRole('button', { name: 'Approve' }));
    expect(projectsApi.approve).toHaveBeenCalledWith(7, 31);
    expect(await screen.findByText('Approved Eli Employee on Apollo')).toBeInTheDocument();
    expect(projectsApi.approvals).toHaveBeenCalledTimes(3); // initial load, list reload, badge refresh
  });

  it('rejects with an optional reason', async () => {
    vi.spyOn(projectsApi, 'reject').mockResolvedValue({ removed: false });
    renderPage();
    const articles = await screen.findAllByRole('article');
    await userEvent.click(within(articles[1]).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Eli Employee stays at 10 h per week on Gemini.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Needed on our release');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(projectsApi.reject).toHaveBeenCalledWith(7, 32, 'Needed on our release');
  });

  it('shows the server error if a decision fails', async () => {
    vi.spyOn(projectsApi, 'approve').mockRejectedValue(new ApiError(409, 'conflict', 'This project has been archived.'));
    renderPage();
    const [first] = await screen.findAllByRole('article');
    await userEvent.click(within(first).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This project has been archived.')).toBeInTheDocument();
  });

  it('shows an all-clear message when nothing is waiting', async () => {
    projectsApi.approvals.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByText(/You're all caught up/)).toBeInTheDocument();
  });
});
