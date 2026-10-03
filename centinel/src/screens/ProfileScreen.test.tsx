import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileScreen } from './ProfileScreen';

const accountLink = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));

vi.mock('../utils/openExternalUrl', () => accountLink);

describe('ProfileScreen account management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountLink.openExternalUrl.mockResolvedValue(true);
  });

  it('shows only the current GitHub sign-in account and opens its account settings', async () => {
    const user = userEvent.setup();
    render(<ProfileScreen accountEmail="avery@example.com" authProvider="github" />);

    expect(screen.getByRole('heading', { name: 'Manage account' })).toBeInTheDocument();
    expect(screen.getByText('avery@example.com')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText(/repository access is managed separately/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign-in methods' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link (Google|GitHub)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage GitHub account' }));
    expect(accountLink.openExternalUrl).toHaveBeenCalledWith('https://github.com/settings/profile');
  });

  it('keeps email and password as the current account access without offering another sign-in method', () => {
    render(<ProfileScreen accountEmail="avery@example.com" authProvider="email" />);

    expect(screen.getByText('Email and password')).toBeInTheDocument();
    expect(screen.getByText(/uses your email address and password/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage .* account/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link / })).not.toBeInTheDocument();
  });

  it('explains when the current provider is unavailable', () => {
    render(<ProfileScreen accountEmail="avery@example.com" />);

    expect(screen.getByText('Provider unavailable')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/could not determine which provider/i);
    expect(screen.queryByRole('button', { name: /Manage .* account/ })).not.toBeInTheDocument();
  });

  it('shows recovery guidance when the provider account page cannot open', async () => {
    const user = userEvent.setup();
    accountLink.openExternalUrl.mockResolvedValue(false);
    render(<ProfileScreen accountEmail="avery@example.com" authProvider="google" />);

    await user.click(screen.getByRole('button', { name: 'Manage Google account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not open the provider account page/i);
  });
});
