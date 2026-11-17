import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { Project, Screen } from '../types';
import { resetCheckStore } from '../check/store';
import { api } from '../api/client';
import type { Artifact, ConnectedSource } from '../types';

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
    resetCheckStore();
    window.localStorage.clear();
    Reflect.deleteProperty(window, '__TAURI_IPC__');
  });

  it('marks the Settings shortcut beside the profile active', () => {
    renderShell({ name: 'settings' }, vi.fn());
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'New Check' })).not.toHaveAttribute('aria-current');
  });

  it('keeps workspace navigation and a Findings breadcrumb on standalone finding pages', async () => {
    const navigate = vi.fn();
    renderShell({ name: 'review-finding', projectId: 'project-1', sessionId: 'review-1', findingId: 'finding-1' }, navigate);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(nav).queryByRole('button', { name: 'Code reviews' })).not.toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await userEvent.click(within(breadcrumb).getByRole('link', { name: 'Findings' }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ name: 'review-activity', sessionId: 'review-1', initialTab: 'Findings' }));
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

  it('opens New and omits the standalone activity directories', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    await user.click(screen.getByRole('button', { name: 'New Check' }));
    expect(screen.queryByRole('button', { name: 'Code reviews' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browser tests' })).not.toBeInTheDocument();

    expect(onNavigate).toHaveBeenCalledWith({ name: 'new-check' });
  });

  it('opens Help from the shortcut beside the profile', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    const menu = within(screen.getByRole('dialog', { name: 'Account menu' }));
    const labels = menu.getAllByRole('button').map(button => button.textContent?.trim());
    expect(labels).toEqual(['Switch account', 'Log out']);
    const helpButton = within(screen.getByRole('complementary')).getByRole('button', { name: 'Help' });
    expect(helpButton.querySelector('svg')).toHaveClass('lucide-circle-question-mark');
    await user.click(helpButton);
    expect(onNavigate).toHaveBeenCalledWith({ name: 'help' });
  });

  it('keeps sidebar navigation global inside a project', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderShell({ name: 'project-detail', projectId: 'project-2' }, onNavigate);

    await user.click(screen.getByRole('button', { name: 'New Check' }));

    expect(onNavigate).toHaveBeenCalledWith({ name: 'new-check' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an empty recent projects section when there are no projects', () => {
    renderShell({ name: 'new-check' }, vi.fn(), []);
    const recent = screen.getByRole('region', { name: 'Recent projects' });
    expect(within(recent).getByText('No projects yet')).toBeInTheDocument();
  });

  it('opens a recent project and shows its details and import sources from the ellipsis', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const sources = vi.spyOn(api, 'listConnectedSources').mockResolvedValue([
      { id: 'remote-1', status: 'active', name: 'acme/shop', remoteUrl: 'https://github.com/acme/shop' } as ConnectedSource,
    ]);
    const artifacts = vi.spyOn(api, 'listArtifacts').mockResolvedValue([
      { id: 'repo-file', source: 'repository', sourceId: 'local-1', localRepositoryName: 'payments' } as Artifact,
    ]);
    renderShell({ name: 'project', projectId: 'project-2' }, onNavigate);
    const recent = within(screen.getByRole('region', { name: 'Recent projects' }));
    const rows = recent.getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'Banking portal' })).toHaveAttribute('aria-current', 'page');
    await user.click(recent.getByRole('button', { name: 'Website refresh' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'project', projectId: 'project-1' });
    await user.click(recent.getByRole('button', { name: 'Details for Banking portal' }));
    const details = within(screen.getByRole('dialog', { name: 'Project details' }));
    expect(details.getByText('Banking portal')).toBeInTheDocument();
    expect(details.getByText('Payment verification')).toBeInTheDocument();
    expect(details.getByText('C:/work/banking-portal')).toBeInTheDocument();
    expect(await details.findByText('acme/shop')).toBeInTheDocument();
    expect(details.getByText('payments')).toBeInTheDocument();
    expect(sources).toHaveBeenCalledWith('project-2');
    expect(artifacts).toHaveBeenCalledWith('project-2');
    await user.click(details.getByRole('button', { name: 'Edit project' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'project-detail', projectId: 'project-2', initialSection: 'settings' });
    sources.mockRestore();
    artifacts.mockRestore();
  });

  it('renders New, recent checks and Projects without a brand or service footer', () => {
    const onNavigate = vi.fn();
    renderShell({ name: 'dashboard' }, onNavigate);

    const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
    expect(nav.getByRole('button', { name: 'New Check' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search projects and checks' })).toBeInTheDocument();
    expect(nav.getByText('Recent checks')).toBeInTheDocument();
    expect(nav.getByText('No checks yet')).toBeInTheDocument();
    expect(nav.getByRole('region', { name: 'Recent projects' })).toBeInTheDocument();
    expect(nav.queryByRole('button', { name: /^Projects$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Services ready')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /centinel/i })).not.toBeInTheDocument();
  });

  it('lists recent checks with their outcome, opens one, and filters them by project name', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    window.localStorage.setItem('centinel:checks:local', JSON.stringify([
      { id: 'c2', createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:05:00.000Z', projectName: 'sample-shop', documents: [], focus: '', mode: 'both', phase: 'done', problemCount: 5, notes: [] },
      { id: 'c1', createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '2026-11-11T10:05:00.000Z', projectName: 'portfolio-site', documents: [], focus: '', mode: 'code', phase: 'done', problemCount: 0, notes: [] },
    ]));
    renderShell({ name: 'new-check' }, onNavigate);

    const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
    expect(nav.getByRole('button', { name: 'New Check' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByText('5 problems')).toBeInTheDocument();
    expect(nav.getByText('No problems')).toBeInTheDocument();
    await user.click(nav.getByRole('button', { name: /sample-shop/ }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'check', checkId: 'c2' });

    const search = screen.getByRole('button', { name: 'Search projects and checks' });
    await user.click(search);
    const dialog = within(screen.getByRole('dialog', { name: 'Search projects and checks' }));
    expect(dialog.getAllByRole('heading').slice(-2).map(heading => heading.textContent)).toEqual(['Checks', 'Projects']);
    const input = dialog.getByRole('searchbox', { name: 'Search by project name' });
    expect(input).toHaveFocus();
    await user.type(input, 'portfolio');
    expect(dialog.getByText('No matching projects')).toBeInTheDocument();
    expect(dialog.queryByText('sample-shop')).not.toBeInTheDocument();
    expect(nav.getByText('sample-shop')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: /portfolio-site/ }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'check', checkId: 'c1' });

    await user.click(search);
    const reopened = within(screen.getByRole('dialog', { name: 'Search projects and checks' }));
    await user.type(reopened.getByRole('searchbox'), 'banking');
    await user.click(reopened.getByRole('button', { name: 'Banking portal' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: 'project', projectId: 'project-2' });
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
    expect(within(menu).getByText('centinel-demo')).toBeInTheDocument();
    expect(within(menu).getByText('avery.chen@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('centinel-demo', { selector: '.sidebar-profile-username' })).toBeInTheDocument();
    expect(within(menu).queryByText('GitHub repository access connected')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Signed in with GitHub')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Current account')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Local Centinel session')).not.toBeInTheDocument();
    expect(within(menu).queryByText('GitHub')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Google email')).not.toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Manage account' })).not.toBeInTheDocument();
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
    expect(within(screen.getByRole('dialog', { name: 'Account menu' })).getByText('Cstan0824')).toBeInTheDocument();
    expect(screen.getByText('Cstan0824', { selector: '.sidebar-profile-username' })).toBeInTheDocument();
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

    expect(screen.getByText('avery.chen@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('GitHub not connected')).not.toBeInTheDocument();
  });

  it('keeps keyboard focus within the open account dialog', async () => {
    const user = userEvent.setup();
    renderShell({ name: 'dashboard' }, vi.fn());

    await user.click(screen.getByRole('button', { name: 'Open account menu' }));
    const menu = screen.getByRole('dialog', { name: 'Account menu' });
    const switchAccount = within(menu).getByRole('button', { name: 'Switch account' });
    const logout = within(menu).getByRole('button', { name: 'Log out' });
    expect(switchAccount).toHaveFocus();

    await user.tab({ shift: true });
    expect(logout).toHaveFocus();
    await user.tab();
    expect(switchAccount).toHaveFocus();
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

describe('sidebar active item', () => {
  it('marks Help active beside the profile', () => {
    renderShell({ name: 'help' }, () => {});
    const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('button', { name: 'New Check' }).className).not.toContain('active');
  });
});
