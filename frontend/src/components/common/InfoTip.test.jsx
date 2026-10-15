import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import InfoTip from './InfoTip';

describe('InfoTip', () => {
  it('opens an explanation on click and closes it with Escape, returning focus', async () => {
    render(<InfoTip topic="budget" />);
    const button = screen.getByRole('button', { name: 'About projected labour cost' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Projected labour cost' });
    expect(dialog).toHaveTextContent(/annual salary ÷ 2,080/);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });
});
