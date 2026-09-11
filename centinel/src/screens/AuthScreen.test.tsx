import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';

describe('AuthScreen', () => {
  it('opens the workspace when the empty sign-in form is submitted', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<AuthScreen onSignIn={onSignIn} />);

    expect(screen.getByRole('heading', { name: 'Sign in to Centinel' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('opens the same workspace from the Google sign-in control', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<AuthScreen onSignIn={onSignIn} />);

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
