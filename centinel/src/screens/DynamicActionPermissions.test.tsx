import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DynamicActionPermissions, emptyInteractionSelectors } from './DynamicActionPermissions';

describe('control discovery for action permissions', () => {
  it('adds only the ticked discovered controls to their action lists', async () => {
    const onChange = vi.fn();
    const onDiscover = vi.fn().mockResolvedValue([
      { selector: '#username', label: 'Username', actions: ['type'], kind: 'Text field' },
      { selector: '#login-btn', label: 'Login', actions: ['click'], kind: 'Button' },
      { selector: '#logout-btn', label: 'Logout', actions: ['click'], kind: 'Button' },
    ]);
    const user = userEvent.setup();
    render(<DynamicActionPermissions selectors={emptyInteractionSelectors()} onChange={onChange} allowCoordinates={false} onCoordinatesChange={vi.fn()} repeatableSelectors="" onRepeatableChange={vi.fn()} onDiscover={onDiscover} />);
    await user.click(screen.getByRole('button', { name: 'Find controls' }));
    await user.click(await screen.findByRole('checkbox', { name: /Logout/ }));
    await user.click(screen.getByRole('button', { name: 'Allow selected controls' }));
    expect(onChange).toHaveBeenCalledWith('type', '#username');
    expect(onChange).toHaveBeenCalledWith('click', '#login-btn');
    expect(onChange).not.toHaveBeenCalledWith('click', expect.stringContaining('#logout-btn'));
    expect(screen.getByRole('status')).toHaveTextContent('2 controls added');
  });
});
