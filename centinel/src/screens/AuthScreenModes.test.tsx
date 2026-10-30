import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../auth/supabaseAuth';
import { AuthScreen } from './AuthScreen';

vi.mock('../auth/supabaseAuth', () => ({
  isSupabaseAuthConfigured: vi.fn(() => true),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  startGithubSignIn: vi.fn(),
  startGoogleSignIn: vi.fn(),
}));

describe('AuthScreen account modes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an account and explains when e-mail confirmation is required', async () => {
    vi.mocked(auth.signUpWithPassword).mockResolvedValue({ session: null });
    const user = userEvent.setup();
    render(<AuthScreen onSignIn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('heading', { name: 'Create your Centinel account' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters');
    await user.type(screen.getByLabelText('Password'), '-enough');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.signUpWithPassword).toHaveBeenCalledWith('new@example.com', 'short-enough'));
    expect(await screen.findByRole('status')).toHaveTextContent('Confirm it from the email');
  });

  it('sends a password reset link without a password field', async () => {
    vi.mocked(auth.requestPasswordReset).mockResolvedValue();
    const user = userEvent.setup();
    render(<AuthScreen onSignIn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Email address'), 'me@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(auth.requestPasswordReset).toHaveBeenCalledWith('me@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent('reset link is on its way');
  });
});
