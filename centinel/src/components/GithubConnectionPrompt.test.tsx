import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GithubConnectionPrompt } from './GithubConnectionPrompt';

vi.mock('../api/client', () => ({ api: { startIntegration: vi.fn() } }));
vi.mock('../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));

describe('GithubConnectionPrompt', () => {
  it('explains that repository access is optional after GitHub account sign-in', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GithubConnectionPrompt isOpen onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Connect GitHub repositories' })).toBeInTheDocument();
    expect(screen.getByText(/signed in with GitHub/i)).toBeInTheDocument();
    expect(screen.getByText(/optional and requests repository access separately/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
