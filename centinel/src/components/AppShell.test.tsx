import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { Project, Screen } from '../types';

const projects: Project[] = [
  {
    id: 'project-1',
    name: 'Website refresh',
    description: 'Office website',
    workspacePath: 'C:/work/website-refresh',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'project-2',
    name: 'Banking portal',
    description: 'Payment verification',
    workspacePath: 'C:/work/banking-portal',
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
];

function renderShell(screenState: Screen, onNavigate: (screen: Screen) => void, projectList = projects) {
  return render(
    <AppShell
      screen={screenState}
      onNavigate={onNavigate}
      projects={projectList}
      accountEmail="avery.chen@gmail.com"
      githubLogin="centinel-demo"
      onSwitchAccount={vi.fn()}
      onLogOut={vi.fn()}
    >
      <p>Screen content</p>
    </AppShell>,
  );
}

describe('AppShell module launch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI_IPC__');
  });

  it('uses operating-system window chrome inside Tauri', () => {
    Object.defineProperty(window, '__TAURI_IPC__', {
      configurable: true,
      value: vi.fn(),
    });

    const { container } = renderShell({ name: 'dashboard' }, vi.fn());

    expect(container.querySelector('.app-shell')).toHaveClass('native-window-chrome');
    expect(screen.queryByRole('button', { name: 'Minimize window' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close window' })).not.toBeInTheDocument();
  });

  it('keeps the preview header outside Tauri', () => {
    const { container } = renderShell({ name: 'dashboard' }, vi.fn());

    expect(container.querySelector('.app-shell')).toHaveClass('browser-window-chrome');
    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument();
  });

  it('opens the dedicated Review entry flow from global navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    const reviewButton = screen.getByRole('button', { name: 'Review' });
    await user.click(reviewButton);

    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-entry' });
  });

  it('keeps Dynamic Testing in the same selection dialog and restores focus on cancel', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    const dynamicButton = screen.getByRole('button', { name: 'Dynamic Testing' });
    await user.click(dynamicButton);
    expect(await screen.findByRole('dialog', { name: 'Start Dynamic Testing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(dynamicButton).toHaveFocus());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('launches directly when the current screen has a real project context', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'project-detail', projectId: 'project-2' }, onNavigate);

    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(onNavigate).toHaveBeenCalledWith({
      name: 'review-entry',
      projectId: 'project-2',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('routes to Projects when a global module has no available project', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate, []);

    await user.click(screen.getByRole('button', { name: 'Dynamic Testing' }));

    expect(onNavigate).toHaveBeenCalledWith({ name: 'projects' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the grouped navigation without a sidebar brand or service footer', () => {
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    expect(screen.getAllByText('Product').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('Activities')).toBeInTheDocument();
    expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Collapse Pinned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Pinned' }).querySelector('svg')?.getAttribute('data-lucide')).not.toBe('chevron-up');
    expect(screen.queryByText('Pinned projects')).not.toBeInTheDocument();
    expect(screen.queryByText('Services ready')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /centinel/i })).not.toBeInTheDocument();
  });

  it('persists an accessible Pinned disclosure and opens pinned project overviews', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    window.localStorage.setItem('centinel:pinned-project-ids', JSON.stringify(['project-2', 'stale-project']));
    renderShell({ name: 'dashboard' }, onNavigate);

    const pinsToggle = screen.getByRole('button', { name: 'Collapse Pinned' });
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Open Banking portal overview' })).toBeInTheDocument();
    expect(screen.queryByText('stale-project')).not.toBeInTheDocument();

    await user.click(pinsToggle);
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Expand Pinned' })).toHaveAttribute('aria-controls', 'sidebar-pins-content');
    expect(screen.getByRole('button', { name: 'Expand Pinned' }).querySelector('svg')?.getAttribute('data-lucide')).not.toBe('chevron-down');
    expect(window.localStorage.getItem('centinel:pins-expanded')).toBe('false');
  });

  it('moves the shell toggle into the navigation panel header', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { container } = renderShell({ name: 'dashboard' }, onNavigate);

    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.app-shell')).toHaveClass('sidebar-collapsed');
  });

  it('keeps the account control at the bottom of navigation and exposes account actions', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { container } = renderShell({ name: 'dashboard' }, onNavigate);

    const profile = screen.getByRole('button', { name: 'Open account menu' });
    expect(profile).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.sidebar-panel > .sidebar-profile')).toBeInTheDocument();

    await user.click(profile);
    expect(profile).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Account menu' })).toBeInTheDocument();
    const menu = screen.getByRole('dialog', { name: 'Account menu' });
    expect(within(menu).getByText('@centinel-demo')).toBeInTheDocument();
    expect(within(menu).getByText('avery.chen@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('avery.chen@gmail.com', { selector: '.sidebar-profile-email' })).toBeInTheDocument();
    expect(within(menu).queryByText('GitHub repository access connected')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Signed in with GitHub')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Current account')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Local Centinel session')).not.toBeInTheDocument();
    expect(within(menu).queryByText('GitHub')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Google email')).not.toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Manage account' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Manage sign-in methods' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('shows the signed-in identity without duplicating repository connection state', async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        screen={{ name: 'dashboard' }}
        onNavigate={vi.fn()}
        projects={projects}
        accountEmail="avery.chen@gmail.com"
        githubLogin={null}
        accountGithubLogin="Cstan0824"
        authProvider="github"
        onSwitchAccount={vi.fn()}
        onLogOut={vi.fn()}
      >
        <p>Screen content</p>
      </AppShell>,
    );

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    expect(within(screen.getByRole('dialog', { name: 'Account menu' })).getByText('@Cstan0824')).toBeInTheDocument();
    expect(screen.getByText('@Cstan0824', { selector: '.sidebar-profile-username' })).toBeInTheDocument();
    expect(screen.queryByText('GitHub repository access not connected')).not.toBeInTheDocument();
  });

  it('labels a Google sign-in as an account rather than an unconnected GitHub repository', () => {
    render(
      <AppShell
        screen={{ name: 'dashboard' }}
        onNavigate={vi.fn()}
        projects={projects}
        accountEmail="avery.chen@gmail.com"
        githubLogin={null}
        authProvider="google"
        onSwitchAccount={vi.fn()}
        onLogOut={vi.fn()}
      >
        <p>Screen content</p>
      </AppShell>,
    );

    expect(screen.getByText('Google account')).toBeInTheDocument();
    expect(screen.queryByText('GitHub not connected')).not.toBeInTheDocument();
  });

  it('keeps keyboard focus within the open account dialog', async () => {
    const user = userEvent.setup();
    renderShell({ name: 'dashboard' }, vi.fn());

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    const menu = screen.getByRole('dialog', { name: 'Account menu' });
    const manage = within(menu).getByRole('button', { name: 'Manage account' });
    const logout = within(menu).getByRole('button', { name: 'Log out' });
    expect(manage).toHaveFocus();

    await user.tab({ shift: true });
    expect(logout).toHaveFocus();
    await user.tab();
    expect(manage).toHaveFocus();
  });

  it('closes the account menu with Escape and restores focus to its trigger', async () => {
    const user = userEvent.setup();
    renderShell({ name: 'dashboard' }, vi.fn());

    const trigger = screen.getByRole('button', { name: 'Open account menu' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Account menu' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('runs the requested account action from the account menu', async () => {
    const user = userEvent.setup();
    const onSwitchAccount = vi.fn();
    const onLogOut = vi.fn();
    render(
      <AppShell
        screen={{ name: 'dashboard' }}
        onNavigate={vi.fn()}
        projects={projects}
        accountEmail="avery.chen@gmail.com"
        githubLogin="centinel-demo"
        onSwitchAccount={onSwitchAccount}
        onLogOut={onLogOut}
      >
        <p>Screen content</p>
      </AppShell>,
    );

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    await user.click(screen.getByRole('button', { name: 'Switch account' }));
    expect(onSwitchAccount).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(onLogOut).toHaveBeenCalledOnce();
  });
});
