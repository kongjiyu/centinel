import { rankMentionChecks, rankMentionProjects } from '../screens/check/checkMentionSelection';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, CircleUserRound, FolderOpen, LoaderCircle, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Repeat2, Search, Settings, SquareChartGantt, TriangleAlert } from 'lucide-react';
import type { Project, Screen } from '../types';
import { PageBreadcrumbs } from './PageBreadcrumbs';
import { WindowHeader } from './WindowHeader';
import { useChecks } from '../check/store';
import { checkName } from '../check/checkName';
import { useBackgroundCheckSync } from '../check/sync';
import type { CheckRecord } from '../check/types';
import { ProblemCountIcon } from './ProblemCountIcon';
import { Icon } from './Icon';
import { ProjectCreateModal } from './ProjectCreateModal';
import type { ProjectCreationResult, ProjectRepositoryInput } from '../types';
import { Modal } from './Modal';
import { OverflowText } from './OverflowText';
import { RecentProjectDetails } from './RecentProjectDetails';
import './CheckSidebar.css';

type Props = {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  projects: Project[];
  onProjectUpdated?: (project: Project) => void;
  onCreateProject?: (name: string, description: string, sources: ProjectRepositoryInput[]) => Promise<ProjectCreationResult | void>;
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
  const active = check.phase === 'preparing' || check.phase === 'running';
  const failed = check.phase === 'failed';
  const count = check.problemCount ?? 0;
  const label = active ? 'Checking' : failed ? 'Did not start' : count ? `${count} ${count === 1 ? 'problem' : 'problems'}` : 'No problems';
  return <span className={`sidebar-check-outcome${active ? ' is-running' : failed || count ? ' is-bad' : ''}`}>
    {active ? <Icon icon={LoaderCircle} className="ci-spin" /> : failed ? <Icon icon={TriangleAlert} /> : <ProblemCountIcon summary={check} />}
    <span className="sidebar-outcome-label">{label}</span>
  </span>;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

const SEARCH_SECTIONS = [
  { page: 'help', name: 'Help', entries: [
    ['Setup guide', 'help-guide-heading'], ['Start a Review', 'help-start-heading'], ['Follow Activity', 'help-activity-heading'],
    ['Read the result', 'help-result-heading'], ['Inspect evidence', 'help-evidence-heading'], ['Update project sources', 'help-sync-heading'],
    ['Confirm requirements', 'help-requirements-heading'], ['Test the running application', 'help-dynamic-heading'],
    ['Share a project', 'help-project-heading'], ['Set up AI models', 'help-settings-heading'], ['Privacy and diagnostics', 'help-privacy-heading'],
  ] },
  { page: 'settings', name: 'Settings', entries: [
    ['App Version', 'settings-app-version-title'], ['Appearance', 'settings-appearance-title'], ['Account', 'settings-account-title'],
    ['Connections', 'settings-connections-title'], ['Model Provider', 'model-provider-title'], ['Embedding model provider', 'embedding-provider-heading'], ['Usage', 'settings-usage-title'],
  ] },
] as const;

export function AppShell({ screen, onNavigate, projects, accountEmail, githubLogin, accountGithubLogin = null, onCreateProject, onProjectUpdated, onSwitchAccount, onLogOut, children }: Props) {
  const nav = (name: Screen['name']) => onNavigate({ name } as Screen);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [projectLimit, setProjectLimit] = useState(5);
  const [checksExpanded, setChecksExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [recentsScrolled, setRecentsScrolled] = useState(false);
  const [detailsProjectId, setDetailsProjectId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const closePreviewTimer = useRef<ReturnType<typeof setTimeout>>();
  const closePreview = () => {
    clearTimeout(closePreviewTimer.current);
    setPreview(null);
  };
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', dismiss);
    window.addEventListener('resize', closePreview);
    return () => {
      clearTimeout(closePreviewTimer.current);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('resize', closePreview);
    };
  }, []);
  const openProjectDetails = (projectId: string) => {
    closePreview();
    setSearchOpen(false);
    setDetailsProjectId(projectId);
  };
  const projectOptions = (project: Project) => (
    <button type="button" className="sidebar-project-options"
      aria-label={`Details for ${project.name}`} aria-haspopup="dialog"
      onPointerEnter={event => {
        if (event.pointerType === 'touch' || detailsProjectId) return;
        clearTimeout(closePreviewTimer.current);
        setPreview({ id: project.id, anchor: event.currentTarget.getBoundingClientRect() });
      }}
      onPointerLeave={event => {
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.recent-project-preview')) return;
        closePreviewTimer.current = setTimeout(closePreview, 160);
      }}
      onClick={() => openProjectDetails(project.id)}
    ><Icon icon={MoreHorizontal} /></button>
  );
  const checks = useChecks();
  useBackgroundCheckSync(true);
  const visibleChecks = checks.slice(0, 20);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const screenKey = JSON.stringify(screen);
  const nativeWindowChrome = isTauriRuntime();
  const accountLogin = accountGithubLogin ?? githubLogin;
  const username = accountLogin?.replace(/^@/, '') || accountEmail || 'Profile';

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

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (document.querySelector('[aria-modal="true"]')) return;
      setAccountMenuOpen(false);
      setSearch('');
      setSearchOpen(true);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const recentProjects = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const detailsProject = projects.find(project => project.id === (detailsProjectId ?? preview?.id));
  const query = search.trim().toLowerCase();
  const matchingProjects = searchOpen ? rankMentionProjects(recentProjects, checks, query, 8, true) : [];
  const matchingChecks = searchOpen ? rankMentionChecks(checks.filter(check => [checkName(check), check.projectName, check.focus].join(' ').toLowerCase().includes(query)), 8) : [];

  const openSearchResult = (result: Screen) => {
    setSearchOpen(false);
    onNavigate(result);
  };

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
            <div className={`sidebar-fixed-actions${recentsScrolled ? ' is-scrolled' : ''}`}>
            <div className="sidebar-nav-group sidebar-new">
              <button
                className={`nav-item nav-new-check ${isActive(['new-check']) ? 'active' : ''}`}
                aria-current={isActive(['new-check']) ? 'page' : undefined}
                onClick={() => nav('new-check')}
                aria-label="New Check"
                title="New Check"
              >
                <SquareChartGantt size={18} aria-hidden="true" />
                <span>New Check</span>
              </button>
            </div>

            <button type="button" className="nav-item sidebar-search-toggle" aria-label="Search projects and checks"
              aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" title="Search"
              onClick={() => { setSearch(''); setSearchOpen(true); }}>
              <Search size={18} strokeWidth={1.7} aria-hidden="true" /><span>Search</span>
            </button>
            </div>
            <div className="sidebar-recents" onScroll={event => { closePreview(); setRecentsScrolled(event.currentTarget.scrollTop > 0); }}>
            <div className="sidebar-nav-group sidebar-checks">
              <button type="button" className="sidebar-category sidebar-recent-toggle"
                aria-expanded={checksExpanded} aria-controls="sidebar-recent-checks-content" onClick={() => setChecksExpanded(value => !value)}>
                Checks <ChevronDown size={14} aria-hidden="true" />
              </button>
              <div id="sidebar-recent-checks-content" hidden={!checksExpanded}>
              {visibleChecks.length ? (
                <ul className="sidebar-check-list">
                  {visibleChecks.map(check => {
                    const current = screen.name === 'check' && screen.checkId === check.id;
                    return (
                      <li key={check.id}>
                        <button
                          type="button"
                          className={`sidebar-check sidebar-check-item ${current ? 'active' : ''}`}
                          aria-current={current ? 'page' : undefined}
                          onClick={() => onNavigate({ name: 'check', checkId: check.id })}
                        >
                          <Icon icon={SquareChartGantt} />
                          <OverflowText text={checkName(check)} />
                          <CheckOutcome check={check} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="sidebar-pins-empty"><span>No checks yet</span></div>
              )}
              </div>
            </div>

            <section className="sidebar-nav-group sidebar-recent-projects" aria-labelledby="sidebar-recent-projects-title">
              <div className="sidebar-projects-heading">
              <button type="button" className="sidebar-category sidebar-recent-toggle" id="sidebar-recent-projects-title"
                aria-expanded={projectsExpanded} aria-controls="sidebar-recent-projects-content" onClick={() => setProjectsExpanded(value => !value)}>
                Projects <ChevronDown size={14} aria-hidden="true" />
              </button>
              <button type="button" className="sidebar-project-add" aria-label="Add project" title="Add project" onClick={() => {
                if (onCreateProject) setCreateProjectOpen(true);
                else onNavigate({ name: 'new-check', initialCreate: true });
              }}><Icon icon={Plus} /></button>
              </div>
              <div id="sidebar-recent-projects-content" hidden={!projectsExpanded}>
              {recentProjects.length ? (
                <>
                  <ul className="sidebar-check-list" id="sidebar-recent-projects-list">
                    {recentProjects.slice(0, projectLimit).map(project => {
                      const current = (screen.name === 'project' || screen.name === 'project-detail') && screen.projectId === project.id;
                      return (
                        <li className={`sidebar-project-row${current ? ' active' : ''}`} key={project.id}>
                          <button
                            type="button"
                            className={`sidebar-check sidebar-project${current ? ' active' : ''}`}
                            aria-current={current ? 'page' : undefined}
                            onClick={() => onNavigate({ name: 'project', projectId: project.id })}
                          >
                            <Icon icon={FolderOpen} />
                            <OverflowText text={project.name} />
                          </button>
                          {projectOptions(project)}
                        </li>
                      );
                    })}
                  </ul>
                  {recentProjects.length > projectLimit && (
                    <button type="button" className="sidebar-project-more" aria-controls="sidebar-recent-projects-list" onClick={() => setProjectLimit(value => value + 5)}>
                      Show more
                    </button>
                  )}
                </>
              ) : <div className="sidebar-pins-empty"><span>No projects yet</span></div>}
              </div>
            </section>
            </div>

            </nav>
            <div className="sidebar-profile">
              <div className="sidebar-profile-actions">
              <button
                type="button"
                ref={accountTriggerRef}
                className={`nav-item sidebar-profile-button ${accountMenuOpen ? 'active' : ''}`}
                onClick={() => setAccountMenuOpen(value => !value)}
                aria-label="Open account menu"
                aria-haspopup="dialog"
                aria-expanded={accountMenuOpen}
                aria-controls="sidebar-account-menu"
              >
                <span className="sidebar-profile-avatar" aria-hidden="true"><CircleUserRound size={20} strokeWidth={1.7} /></span>
                <span className="sidebar-profile-copy"><span className="sidebar-profile-username">{username}</span></span>
              </button>
              <button type="button" className="sidebar-profile-action" title="Help" aria-label="Help" aria-current={screen.name === 'help' ? 'page' : undefined} onClick={() => { setAccountMenuOpen(false); nav('help'); }}><CircleHelp size={17} aria-hidden="true" /></button>
              <button type="button" className="sidebar-profile-action" title="Settings" aria-label="Settings" aria-current={screen.name === 'settings' ? 'page' : undefined} onClick={() => { setAccountMenuOpen(false); nav('settings'); }}><Settings size={17} aria-hidden="true" /></button>
              </div>
              {accountMenuOpen && (
                <div id="sidebar-account-menu" ref={accountMenuRef} className="sidebar-account-menu" role="dialog" aria-label="Account menu">
                  <div className="sidebar-account-menu-heading">
                    <span className="sidebar-account-menu-avatar" aria-hidden="true"><CircleUserRound size={20} strokeWidth={1.7} /></span>
                  <div><strong>{username}</strong>{accountEmail && accountEmail !== username && <span>{accountEmail}</span>}</div>
                </div>
                  <div className="sidebar-account-actions" role="group" aria-label="Account actions">
                    <button type="button" onClick={() => { setAccountMenuOpen(false); onSwitchAccount(); }}><Repeat2 size={16} aria-hidden="true" /> Switch account</button>
                    <button type="button" className="sidebar-account-logout" onClick={() => { setAccountMenuOpen(false); onLogOut(); }}><LogOut size={16} aria-hidden="true" /> Log out</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="page-content-container" aria-label="Page content">
          {screen.name !== 'new-check' && screen.name !== 'check' && screen.name !== 'project' && screen.name !== 'settings' && <PageBreadcrumbs
            screen={screen}
            projects={projects}
            onNavigate={onNavigate}
          />}
          <main ref={mainContentRef} className="main-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </section>
      </div>
      <Modal isOpen={searchOpen} onClose={() => { closePreview(); setSearchOpen(false); }} title="Search projects and checks" width={720} overlayClassName="sidebar-search-overlay"
        headerContent={<div className="sidebar-search-header"><input className="sidebar-search-field" type="search" data-autofocus aria-label="Search checks, projects, settings, and guides" placeholder="Search checks, projects, settings, and guides" value={search} onChange={event => setSearch(event.target.value)} /><Search size={17} aria-hidden="true" /></div>}>
        <div className="sidebar-search-dialog">
          <div className="sidebar-search-results">
            <section aria-labelledby="sidebar-search-checks">
              <h4 id="sidebar-search-checks">Checks</h4>
              {matchingChecks.length ? <ul className="sidebar-check-list">
                {matchingChecks.map(check => <li key={check.id}>
                  <button type="button" className="sidebar-check sidebar-check-item" onClick={() => openSearchResult({ name: 'check', checkId: check.id })}>
                    <Icon icon={SquareChartGantt} />
                    <OverflowText text={checkName(check)} />
                    <CheckOutcome check={check} />
                  </button>
                </li>)}
              </ul> : <p>{query ? 'No matching checks' : 'No checks yet'}</p>}
            </section>
            <section aria-labelledby="sidebar-search-projects">
              <h4 id="sidebar-search-projects">Projects</h4>
              {matchingProjects.length ? <ul className="sidebar-check-list">
                {matchingProjects.map(project => <li key={project.id} className="sidebar-project-row">
                  <button type="button" className="sidebar-check sidebar-project" onClick={() => openSearchResult({ name: 'project', projectId: project.id })}>
                    <Icon icon={FolderOpen} /><OverflowText text={project.name} />
                  </button>
                  {projectOptions(project)}
                </li>)}
              </ul> : <p>{query ? 'No matching projects' : 'No projects yet'}</p>}
            </section>
            {query && SEARCH_SECTIONS.map(({ page, name, entries }) => {
              const matches = entries.filter(([label]) => query.split(/\s+/).every(term => (name + ' ' + label).toLowerCase().includes(term)));
              return matches.length > 0 && <section key={page} aria-label={name}>
                <h4>{name}</h4>
                <ul className="sidebar-check-list">{matches.map(([label, headingId]) => <li key={headingId}>
                  <button type="button" className="sidebar-check" onClick={() => openSearchResult({ name: page, headingId })}>{label}</button>
                </li>)}</ul>
              </section>;
            })}
          </div>
        </div>
      </Modal>
      {onCreateProject && <ProjectCreateModal isOpen={createProjectOpen} onClose={() => setCreateProjectOpen(false)} onCreate={onCreateProject} />}
      {detailsProject && (
        <RecentProjectDetails key={detailsProject.id} project={detailsProject}
          anchor={detailsProjectId ? null : preview?.anchor ?? null}
          onClose={() => { closePreview(); setDetailsProjectId(null); }}
          onEdit={() => openProjectDetails(detailsProject.id)}
          onPreviewEnter={() => clearTimeout(closePreviewTimer.current)}
          onUpdated={onProjectUpdated}
        />
      )}
    </div>
  );
}
