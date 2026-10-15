import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { timeAgo } from '../../utils/format';
import WhatsNew from './WhatsNew';

const NOW = Date.parse('2026-10-15T12:00:00Z');

describe('WhatsNew', () => {
  it('lists changes, marks the new ones and links to the project', () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    renderWithProviders(
      <WhatsNew
        data={{
          since: '2026-10-14T09:00:00Z',
          window_days: 14,
          new_count: 1,
          items: [
            { id: 2, occurred_at: recent, kind: 'assignment', text: 'Morgan Manager changed your hours on Apollo from 10 h/week to 12 h/week', project_id: 7, project_name: 'Apollo', is_new: true },
            { id: 1, occurred_at: '2026-10-13T09:00:00Z', kind: 'milestone', text: "New milestone on Apollo: 'Design', due Nov 6, 2026", project_id: 7, project_name: 'Apollo', is_new: false },
          ],
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText('1 new')).toBeInTheDocument();
    expect(screen.getByText(/New since you last signed in \(Oct 14, 2026\)/)).toBeInTheDocument();
    const [first, second] = within(screen.getByRole('list', { name: "What's new" })).getAllByRole('listitem');
    expect(within(first).getByText('New')).toBeInTheDocument();
    expect(within(first).getByText('5 minutes ago')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Open Apollo' })).toHaveAttribute('href', '/projects/7');
    expect(within(second).queryByText('New')).not.toBeInTheDocument();
  });

  it('says when nothing has changed', () => {
    renderWithProviders(<WhatsNew data={{ since: null, window_days: 14, new_count: 0, items: [] }} />);
    expect(screen.getByText('Nothing has changed for you in the last 14 days.')).toBeInTheDocument();
  });
});

describe('timeAgo', () => {
  it.each([
    ['2026-10-15T11:59:30Z', 'just now'],
    ['2026-10-15T11:55:00Z', '5 minutes ago'],
    ['2026-10-15T09:00:00Z', '3 hours ago'],
    ['2026-10-14T12:00:00Z', 'yesterday'],
    ['2026-10-11T12:00:00Z', '4 days ago'],
    ['2026-10-01T12:00:00Z', 'Oct 1, 2026'],
  ])('%s -> %s', (value, expected) => {
    expect(timeAgo(value, NOW)).toBe(expected);
  });
});
