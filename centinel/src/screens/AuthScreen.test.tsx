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
    expect(onSignIn).toHaveBeenCalledWith(null);
  });

  it('retains the entered email as local session context', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<AuthScreen onSignIn={onSignIn} />);

    await user.type(screen.getByLabelText('Email address'), 'avery.chen@gmail.com');
    await user.click(screen.getByRole('button', { name: /Sign in/ }));

    expect(onSignIn).toHaveBeenCalledWith('avery.chen@gmail.com');
  });

  it('opens the same workspace from the Google sign-in control', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<AuthScreen onSignIn={onSignIn} />);

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('opens the same workspace from the GitHub sign-in control', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<AuthScreen onSignIn={onSignIn} />);

    await user.click(screen.getByRole('button', { name: 'Continue with GitHub' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('lets a person return to their current workspace while switching accounts', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<AuthScreen onSignIn={vi.fn()} onBackToWorkspace={onBack} />);

    await user.click(screen.getByRole('button', { name: 'Back to workspace' }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
