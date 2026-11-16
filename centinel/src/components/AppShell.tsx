import { useEffect, useRef, useState } from 'react';
import { Check, CircleHelp, CircleUserRound, FileCheck2, FolderOpen, GitBranch, House, LoaderCircle, LogOut, MonitorPlay, PanelLeftClose, PanelLeftOpen, Plus, Repeat2, Search, Settings, TriangleAlert } from 'lucide-react';
import type { Project, Screen } from '../types';
import { PageBreadcrumbs } from './PageBreadcrumbs';
import { WindowHeader } from './WindowHeader';
import { useChecks } from '../check/store';
import { useBackgroundCheckSync } from '../check/sync';
import type { CheckRecord } from '../check/types';
import { Icon } from './Icon';
import './CheckSidebar.css';

type Props = {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  projects: Project[];
  accountEmail: string | null;
  githubLogin: string | null;
  accountGithubLogin?: string | null;
  authProvider?: 'github' | 'google' | 'email' | null;
  onSwitchAccount: () => void;
  onLogOut: () => void;
  children: React.ReactNode;
};

/** A recent check's outcome in a few words (DESIGN.md §6). */
function CheckOutcome({ check }: { check: CheckRecord }) {
  if (check.phase === 'preparing' || check.phase === 'running') {
    return <span className="sidebar-check-outcome is-running"><Icon icon={LoaderCircle} className="ci-spin" /><span>Checking…</span></span>;
  }
  if (check.phase === 'failed') return <span className="sidebar-check-outcome is-bad"><Icon icon={TriangleAlert} shape="triangle" /><span>Did not start</span></span>;
  const count = check.problemCount ?? 0;
  return count
    ? <span className="sidebar-check-outcome is-bad"><Icon icon={TriangleAlert} shape="triangle" /><span>{count} problem{count === 1 ? '' : 's'}</span></span>
    : <span className="sidebar-check-outcome"><Icon icon={Check} /><span>No problems</span></span>;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

function accountUsername(githubLogin: string | null, accountEmail: string | null): string {
  if (githubLogin) return `@${githubLogin.replace(/^@/, '')}`;
  if (accountEmail) return accountEmail.split('@')[0] || accountEmail;
  return 'Not provided';
}

export function AppShell({ screen, onNavigate, projects, accountEmail, githubLogin, accountGithubLogin = null, authProvider = null, onSwitchAccount, onLogOut, children }: Props) {
  const nav = (name: Screen['name']) => onNavigate({ name } as Screen);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const checks = useChecks();
  useBackgroundCheckSync(true);
  const visibleChecks = checks.filter(check => !search.trim() || check.projectName.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const screenKey = JSON.stringify(screen);
  const nativeWindowChrome = isTauriRuntime();
  const accountLogin = authProvider === 'github' ? accountGithubLogin ?? githubLogin
    : authProvider ? null : accountGithubLogin ?? githubLogin;
  const username = accountUsername(accountLogin, accountEmail);
  const accountMethod = accountLogin ? `@${accountLogin.replace(/^@/, '')}`
    : authProvider === 'google' ? 'Google account'
      : authProvider === 'email' ? 'Email account'
        : authProvider === 'github' ? 'GitHub account' : 'Account';

  const isActive = (names: Screen['name'][]) => names.includes(screen.name);
  useEffect(() => {
    if (!mainContentRef.current) return;
    mainContentRef.current.scrollTop = 0;
    mainContentRef.current.scrollLeft = 0;
  }, [screenKey]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const menuButtons = () => Array.from(accountMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    menuButtons()[0]?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (accountMenuRef.current?.contains(target) || accountTriggerRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAccountMenuOpen(false);
        accountTriggerRef.current?.focus();
      } else if (event.key === 'Tab') {
        const buttons = menuButtons();
        if (buttons.length === 0) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen]);

  const staticActive = screen.name === 'review-directory' || screen.name === 'requirements' || screen.name === 'review-activity' || screen.name === 'review-finding' || screen.name === 'review-entry' || screen.name === 'reviews' ||
    (screen.name === 'project-detail' && screen.initialAction === 'static');
  const dynamicActive = screen.name === 'dynamic-directory' || screen.name === 'dynamic-testing' || screen.name === 'dynamic-session' ||
    (screen.name === 'project-detail' && screen.initialAction === 'dynamic');
  const projectsActive = screen.name === 'projects' || screen.name === 'project' || screen.name === 'evidence-browser' ||
    (screen.name === 'project-detail' && !screen.initialAction);

  return (
    <div className={`app-shell has-window-chrome command-mode workspace-mode ${nativeWindowChrome ? 'native-window-chrome' : 'browser-window-chrome'} ${screen.name === 'dashboard' ? 'dashboard-mode' : ''} ${screen.name === 'new-check' || screen.name === 'check' || screen.name === 'project' ? 'check-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${accountMenuOpen ? 'account-menu-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {!nativeWindowChrome && <WindowHeader />}
      <div className="app-shell-workspace">
        <aside className="sidebar">
          <div className="sidebar-panel">
            <header className="sidebar-header">
              <button
                type="button"
                className="sidebar-toggle"
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!sidebarCollapsed}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => {
                  setSidebarCollapsed(value => !value);
                  setAccountMenuOpen(false);
                }}
              >
                <span className="sidebar-toggle-icon" aria-hidden="true">
                  {sidebarCollapsed ? <PanelLeftOpen size={18} strokeWidth={1.7} /> : <PanelLeftClose size={18} strokeWidth={1.7} />}
                </span>
              </button>
            </header>
            <nav className="sidebar-nav" aria-label="Primary navigation">
            <div className="sidebar-nav-group">
              <button
                className={`nav-item nav-new-check ${isActive(['new-check']) ? 'active' : ''}`}
                aria-current={isActive(['new-check']) ? 'page' : undefined}
                onClick={() => nav('new-check')}
                aria-label="New check"
                title="New check"
              >
                <Plus size={18} aria-hidden="true" />
                <span>New check</span>
              </button>
              <button
                className={`nav-item ${searchOpen ? 'active' : ''}`}
                aria-expanded={searchOpen}
                aria-controls="sidebar-check-search"
                onClick={() => { setSearchOpen(value => !value); if (sidebarCollapsed) setSidebarCollapsed(false); }}
                aria-label="Search checks"
                title="Search checks"
              >
                <Search size={18} aria-hidden="true" />
                <span>Search</span>
              </button>
              {searchOpen && !sidebarCollapsed && (
                <div className="sidebar-check-search" id="sidebar-check-search">
                  <label className="sr-only" htmlFor="sidebar-check-search-input">Search checks by project name</label>
                  <input id="sidebar-check-search-input" autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Project name" onKeyDown={event => { if (event.key === 'Escape') { setSearch(''); setSearchOpen(false); } }} />
                </div>
              )}
            </div>

            <div className="sidebar-nav-group sidebar-checks">
              <div className="sidebar-category">Recent checks</div>
              {visibleChecks.length ? (
                <ul className="sidebar-check-list">
                  {visibleChecks.map(check => {
                    const current = screen.name === 'check' && screen.checkId === check.id;
                    return (
                      <li key={check.id}>
                        <button
                          type="button"
                          className={`sidebar-check ${current ? 'active' : ''}`}
                          aria-current={current ? 'page' : undefined}
                          onClick={() => onNavigate({ name: 'check', checkId: check.id })}
                          title={check.projectName}
                        >
                          <span className="sidebar-check-name">{check.projectName}</span>
                          <CheckOutcome check={check} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="sidebar-pins-empty"><span>{search ? 'No matching checks' : 'No checks yet'}</span></div>
              )}
            </div>

            <div className="sidebar-nav-group">
              <div className="sidebar-category">Details</div>
              <button
                className={`nav-item ${isActive(['dashboard']) ? 'active' : ''}`}
                aria-current={isActive(['dashboard']) ? 'page' : undefined}
                onClick={() => nav('dashboard')}
                aria-label="Overview"
                title="Overview"
              >
                <House size={18} aria-hidden="true" />
                <span>Overview</span>
              </button>
              <button
                className={`nav-item ${projectsActive ? 'active' : ''}`}
                aria-current={projectsActive ? 'page' : undefined}
                onClick={() => nav('projects')}
                aria-label="Projects"
                title="Projects"
              >
                <FolderOpen size={18} aria-hidden="true" />
                <span>Projects</span>
              </button>
              <button
                className={`nav-item ${staticActive ? 'active' : ''}`}
                aria-current={staticActive ? 'page' : undefined}
                onClick={() => nav('review-directory')}
                aria-label="Code reviews"
                title="Code reviews"
              >
                <FileCheck2 size={18} aria-hidden="true" />
                <span>Code reviews</span>
              </button>
              <button
                className={`nav-item ${dynamicActive ? 'active' : ''}`}
                aria-current={dynamicActive ? 'page' : undefined}
                onClick={() => nav('dynamic-directory')}
                aria-label="Browser tests"
                title="Browser tests"
              >
                <MonitorPlay size={18} aria-hidden="true" />
                <span>Browser tests</span>
              </button>
            </div>

            <div className="sidebar-nav-group sidebar-settings-group">
              <button
                className={`nav-item ${isActive(['settings']) ? 'active' : ''}`}
                aria-current={isActive(['settings']) ? 'page' : undefined}
                onClick={() => nav('settings')}
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={18} aria-hidden="true" />
                <span>Settings</span>
              </button>
              <button
                className={`nav-item ${isActive(['help']) ? 'active' : ''}`}
                aria-current={isActive(['help']) ? 'page' : undefined}
                onClick={() => nav('help')}
                aria-label="Help"
                title="Help"
              >
                <CircleHelp size={18} aria-hidden="true" />
                <span>Help</span>
              </button>
            </div>
            </nav>
            <div className="sidebar-profile">
              <button
                type="button"
                ref={accountTriggerRef}
                className={`nav-item sidebar-profile-button ${accountMenuOpen ? 'active' : ''}`}
                onClick={() => setAccountMenuOpen(value => !value)}
                aria-label="Open account menu"
                aria-haspopup="dialog"
                aria-expanded={accountMenuOpen}
                aria-controls="sidebar-account-menu"
                title="Account"
              >
                <span className="sidebar-profile-avatar" aria-hidden="true"><CircleUserRound size={20} strokeWidth={1.7} /></span>
                <span className="sidebar-profile-copy">
                  <span className="sidebar-profile-label">Account</span>
                  <span className="sidebar-profile-username">{accountLogin && <GitBranch size={12} aria-hidden="true" />}{accountMethod}</span>
                  {accountEmail && <span className="sidebar-profile-email">{accountEmail}</span>}
                </span>
              </button>
              {accountMenuOpen && (
                <div id="sidebar-account-menu" ref={accountMenuRef} className="sidebar-account-menu" role="dialog" aria-label="Account menu">
                  <div className="sidebar-account-menu-heading">
                    <span className="sidebar-account-menu-avatar" aria-hidden="true"><CircleUserRound size={20} strokeWidth={1.7} /></span>
                  <div><strong>{username}</strong><span>{accountEmail ?? 'Email not provided'}</span></div>
                </div>
                  <div className="sidebar-account-actions" role="group" aria-label="Account actions">
                    <button type="button" onClick={() => { setAccountMenuOpen(false); onNavigate({ name: 'profile' }); }}><CircleUserRound size={16} aria-hidden="true" /> Manage account</button>
                    <button type="button" onClick={() => { setAccountMenuOpen(false); onSwitchAccount(); }}><Repeat2 size={16} aria-hidden="true" /> Switch account</button>
                    <button type="button" className="sidebar-account-logout" onClick={() => { setAccountMenuOpen(false); onLogOut(); }}><LogOut size={16} aria-hidden="true" /> Log out</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="page-content-container" aria-label="Page content">
          <PageBreadcrumbs
            screen={screen}
            projects={projects}
            onNavigate={onNavigate}
          />
          <main ref={mainContentRef} className="main-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </section>
      </div>

    </div>
  );
}
