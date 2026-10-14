import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import { auditApi } from '../services/auditApi';
import { renderWithProviders } from '../test/render';
import AuditLogPage from './AuditLogPage';

const ENTRIES = [
  {
    id: 2, occurred_at: '2026-10-14T13:05:00Z', actor_id: null, actor_employee_id: 'NOPE01', actor_name: null,
    actor_role: null, action: 'auth.login', entity_type: 'user', entity_id: null, project_id: null,
    project_name: null, summary: 'Failed sign-in for NOPE01', changes: {}, outcome: 'denied',
  },
  {
    id: 1, occurred_at: '2026-10-14T13:00:00Z', actor_id: 2, actor_employee_id: 'MM4R8T', actor_name: 'Morgan Manager',
    actor_role: 'manager', action: 'project.update', entity_type: 'project', entity_id: 7, project_id: 7,
    project_name: 'Apollo', summary: 'Updated project Apollo: budget',
    changes: { budget: { from: 50000, to: 60000 } }, outcome: 'success',
  },
];

function renderPage(route = '/audit') {
  return renderWithProviders(
    <Routes><Route path="/audit" element={<AuditLogPage />} /></Routes>,
    { route },
  );
}

beforeEach(() => {
  vi.spyOn(auditApi, 'list').mockResolvedValue({ items: ENTRIES, total: 2 });
  vi.spyOn(auditApi, 'actions').mockResolvedValue({ items: ['auth.login', 'project.update'] });
});

describe('AuditLogPage', () => {
  it('lists entries with who, what and outcome', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(within(table).getByText('Updated project Apollo: budget')).toBeInTheDocument();
    expect(within(table).getByText('MM4R8T · Manager')).toBeInTheDocument();
    expect(within(table).getByText('Unknown (not signed in)')).toBeInTheDocument();
    expect(within(table).getByText('Denied')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/7');
  });

  it('expands a row to show field-by-field changes', async () => {
    renderPage();
    const [, second] = await screen.findAllByRole('button', { name: 'Show details' });
    await userEvent.click(second);
    const changes = await screen.findByRole('table', { name: 'Field changes' });
    expect(within(changes).getByText('budget')).toBeInTheDocument();
    expect(within(changes).getByText('50000')).toBeInTheDocument();
    expect(within(changes).getByText('60000')).toBeInTheDocument();
  });

  it('sends filters to the API and resets to the first page', async () => {
    renderPage();
    await screen.findByText('Updated project Apollo: budget');
    await userEvent.click(screen.getByRole('combobox', { name: /^Outcome/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Denied' }));
    await waitFor(() => expect(auditApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: 'denied', page: 1 }), expect.anything(),
    ));
    await userEvent.click(screen.getByRole('combobox', { name: /^Action/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'project.update' }));
    await waitFor(() => expect(auditApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'project.update', outcome: 'denied' }), expect.anything(),
    ));
  });

  it('filters by project from the URL and can clear it', async () => {
    renderPage('/audit?project_id=7');
    await screen.findByText('Updated project Apollo: budget');
    expect(auditApi.list).toHaveBeenCalledWith(expect.objectContaining({ project_id: '7' }), expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(auditApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ project_id: '' }), expect.anything(),
    ));
  });

  it('shows a retryable error', async () => {
    auditApi.list.mockRejectedValueOnce(new ApiError(500, 'internal_error', 'Something went wrong.'));
    renderPage();
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Updated project Apollo: budget')).toBeInTheDocument();
  });
});
