import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const options = [
  { value: 'all', label: 'All activity' },
  { value: 'review', label: 'Review' },
  { value: 'dynamic', label: 'Dynamic Testing' },
];

describe('Select', () => {
  it('exposes an accessible combobox and keyboard-safe option menu', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select id="activity" aria-label="Activity type" value="all" onChange={onChange} options={options} />);

    const trigger = screen.getByRole('combobox', { name: 'Activity type' });
    expect(trigger).toHaveTextContent('All activity');
    expect(document.querySelector('select')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Dynamic Testing' }));

    expect(onChange).toHaveBeenCalledWith('dynamic');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes with Escape and keeps disabled state discoverable', async () => {
    const user = userEvent.setup();
    render(<Select aria-label="Activity type" value="all" onChange={() => undefined} options={options} />);
    const trigger = screen.getByRole('combobox', { name: 'Activity type' });

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();

    render(<Select aria-label="Disabled activity" value="all" onChange={() => undefined} options={options} disabled />);
    expect(screen.getByRole('combobox', { name: 'Disabled activity' })).toBeDisabled();
  });
});

