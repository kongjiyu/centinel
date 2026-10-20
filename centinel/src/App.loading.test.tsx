import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './api/client';

vi.mock('./api/client', () => ({ api: { projects: vi.fn(), aiSettings: vi.fn(), githubStatus: vi.fn() } }));
vi.mock('./auth/supabaseAuth', () => ({ isSupabaseAuthConfigured: () => false, signOutSupabase: vi.fn().mockResolvedValue(undefined), restoreSupabaseSession: vi.fn(), subscribeToDeepLinkAuth: vi.fn(), subscribeToSupabaseAuth: vi.fn() }));
vi.mock('./screens/AuthScreen', () => ({ AuthScreen: ({ onSignIn }: any) => <button onClick={() => onSignIn('person@example.test')}>Sign in</button> }));
vi.mock('./components/AppShell', () => ({ AppShell: ({ children }: any) => <main>{children}</main> }));
vi.mock('./screens/DashboardScreen', () => ({ DashboardScreen: ({ projects }: any) => <div>{projects.map((project: any) => <p key={project.id}>{project.name}</p>)}</div> }));
vi.mock('./hooks/useActiveReview', () => ({ ActiveReviewProvider: ({ children }: any) => children }));
vi.mock('./components/ReviewToast', () => ({ ReviewToast: () => null }));
vi.mock('./components/GithubConnectionPrompt', () => ({ GithubConnectionPrompt: () => null }));

describe('workspace metadata loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects).mockResolvedValue([{ id: 'project-1', name: 'Available project', description: '', workspacePath: '', createdAt: '', updatedAt: '' }]);
    vi.mocked(api.githubStatus).mockResolvedValue({ connected: false, login: null, message: '' });
  });
  it('opens the project workspace while optional Model Provider settings are still pending', async () => {
    vi.mocked(api.aiSettings).mockReturnValue(new Promise(() => {}));
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Available project')).toBeInTheDocument();
  });
  it('keeps project data usable when optional provider settings fail', async () => {
    vi.mocked(api.aiSettings).mockRejectedValue(new Error('Provider configuration unavailable'));
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Available project')).toBeInTheDocument();
    expect(screen.queryByText('Cannot connect to the local sidecar service.')).not.toBeInTheDocument();
  });
});
