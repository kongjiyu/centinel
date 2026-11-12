import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleHelp, CircleUserRound, FileCheck2, FolderOpen, GitBranch, House, LogOut, MonitorPlay, PanelLeftClose, PanelLeftOpen, Pin, Repeat2, Settings } from 'lucide-react';
import type { Project, Screen } from '../types';
import { PageBreadcrumbs } from './PageBreadcrumbs';
import { WindowHeader } from './WindowHeader';
import { usePinnedProjects } from '../hooks/usePinnedProjects';

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

const PINS_EXPANDED_STORAGE_KEY = 'centinel:pins-expanded';
const PINS_CONTENT_ID = 'sidebar-pins-content';

function readPinsExpanded(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const value = window.localStorage.getItem(PINS_EXPANDED_STORAGE_KEY);
    return value === null ? true : value === 'true';
  } catch {
    return true;
  }
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
  const [pinsExpanded, setPinsExpanded] = useState(readPinsExpanded);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { pinnedProjects } = usePinnedProjects(projects);
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
    try {
      window.localStorage.setItem(PINS_EXPANDED_STORAGE_KEY, String(pinsExpanded));
    } catch {
      // A restricted browser or private webview may not allow preferences.
    }
  }, [pinsExpanded]);

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
  const projectsActive = screen.name === 'projects' || screen.name === 'evidence-browser' ||
    (screen.name === 'project-detail' && !screen.initialAction);

  return (
    <div className={`app-shell has-window-chrome command-mode workspace-mode ${nativeWindowChrome ? 'native-window-chrome' : 'browser-window-chrome'} ${screen.name === 'dashboard' ? 'dashboard-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${accountMenuOpen ? 'account-menu-open' : ''}`}>
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
              <div className="sidebar-category">Dashboard</div>
              <button
                className={`nav-item ${isActive(['dashboard']) ? 'active' : ''}`}
                aria-current={isActive(['dashboard']) ? 'page' : undefined}
                onClick={() => nav('dashboard')}
                aria-label="Home"
                title="Home"
              >
                <House size={18} aria-hidden="true" />
                <span>Home</span>
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
            </div>

            <div className="sidebar-nav-group">
              <div className="sidebar-category">Activities</div>
              <button
                className={`nav-item ${staticActive ? 'active' : ''}`}
                aria-current={staticActive ? 'page' : undefined}
                onClick={() => nav('review-directory')}
                aria-label="Review"
                title="Review"
              >
                <FileCheck2 size={18} aria-hidden="true" />
                <span>Review</span>
              </button>
              <button
                className={`nav-item ${dynamicActive ? 'active' : ''}`}
                aria-current={dynamicActive ? 'page' : undefined}
                onClick={() => nav('dynamic-directory')}
                aria-label="Dynamic Testing"
                title="Dynamic Testing"
              >
                <MonitorPlay size={18} aria-hidden="true" />
                <span>Dynamic Testing</span>
              </button>
              {/* Developer harness: hidden from the product navigation outside development builds (DESIGN.md navigation). */}
            </div>

            <div className="sidebar-nav-group">
              <div className="sidebar-category">Settings</div>
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

            <div className="sidebar-nav-group sidebar-pins-group">
              <button
                type="button"
                className="sidebar-pins-toggle"
                aria-expanded={pinsExpanded}
                aria-controls={PINS_CONTENT_ID}
                aria-label={pinsExpanded ? 'Collapse Pinned' : 'Expand Pinned'}
                title={pinsExpanded ? 'Collapse Pinned' : 'Expand Pinned'}
                onClick={() => setPinsExpanded(value => !value)}
              >
                <span className="sidebar-pinned-collapsed-icon" aria-hidden="true">
                  <Pin size={18} strokeWidth={1.7} />
                </span>
                <span>Pinned</span>
                {pinsExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </button>
              <div id={PINS_CONTENT_ID} className="sidebar-pins-content" hidden={!pinsExpanded}>
                {pinnedProjects.length > 0 ? pinnedProjects.map(project => (
                  <button
                    key={project.id}
                    type="button"
                    className={`nav-item sidebar-pin-item ${screen.name === 'project-detail' && screen.projectId === project.id ? 'active' : ''}`}
                    aria-current={screen.name === 'project-detail' && screen.projectId === project.id ? 'page' : undefined}
                    onClick={() => onNavigate({ name: 'project-detail', projectId: project.id })}
                    aria-label={`Open ${project.name} overview`}
                    title={project.name}
                  >
                    <FolderOpen size={17} aria-hidden="true" />
                    <span>{project.name}</span>
                  </button>
                )) : (
                  <div className="sidebar-pins-empty">
                    <span>No pinned projects</span>
                  </div>
                )}
              </div>
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
