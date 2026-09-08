import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileCheck2, FolderOpen, House, MonitorPlay, PanelLeftClose, PanelLeftOpen, Pin, Settings } from 'lucide-react';
import type { Project, Screen } from '../types';
import { Modal } from './Modal';
import { Select } from './Select';
import { PageBreadcrumbs } from './PageBreadcrumbs';
import { WindowHeader } from './WindowHeader';
import { usePinnedProjects } from '../hooks/usePinnedProjects';

type ModuleAction = 'static' | 'dynamic';

type Props = {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  projects: Project[];
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

export function AppShell({ screen, onNavigate, projects, children }: Props) {
  const nav = (name: Screen['name']) => onNavigate({ name } as Screen);
  const [pendingModuleAction, setPendingModuleAction] = useState<ModuleAction | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pinsExpanded, setPinsExpanded] = useState(readPinsExpanded);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const { pinnedProjects } = usePinnedProjects(projects);
  const screenKey = JSON.stringify(screen);

  const isActive = (names: Screen['name'][]) => names.includes(screen.name);
  useEffect(() => {
    if (pendingModuleAction && !projects.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id ?? '');
    }
  }, [pendingModuleAction, projects, selectedProjectId]);

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

  const openModule = (initialAction: 'static' | 'dynamic') => {
    const contextualProject = 'projectId' in screen
      ? projects.find(project => project.id === screen.projectId)
      : undefined;
    if (initialAction === 'static') {
      onNavigate(contextualProject
        ? { name: 'review-entry', projectId: contextualProject.id }
        : { name: 'review-entry' });
      return;
    }
    if (contextualProject) {
      onNavigate({ name: 'project-detail', projectId: contextualProject.id, initialAction });
      return;
    }
    if (projects.length === 0) {
      nav('projects');
      return;
    }
    setSelectedProjectId(projects[0].id);
    setPendingModuleAction(initialAction);
  };

  const handleProjectSelectionContinue = () => {
    if (!pendingModuleAction) return;
    const selectedProject = projects.find(project => project.id === selectedProjectId);
    if (!selectedProject) return;
    const initialAction = pendingModuleAction;
    setPendingModuleAction(null);
    onNavigate({ name: 'project-detail', projectId: selectedProject.id, initialAction });
  };

  const staticActive = screen.name === 'requirements' || screen.name === 'review-activity' || screen.name === 'review-entry' ||
    (screen.name === 'project-detail' && screen.initialAction === 'static');
  const dynamicActive = screen.name === 'dynamic-session' ||
    (screen.name === 'project-detail' && screen.initialAction === 'dynamic');
  const projectsActive = screen.name === 'projects' || screen.name === 'evidence-browser' ||
    (screen.name === 'project-detail' && !screen.initialAction);

  return (
    <div className={`app-shell has-window-chrome command-mode workspace-mode ${screen.name === 'dashboard' ? 'dashboard-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <WindowHeader />
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
                onClick={() => setSidebarCollapsed(value => !value)}
              >
                <span className="sidebar-toggle-icon" aria-hidden="true">
                  {sidebarCollapsed ? <PanelLeftOpen size={18} strokeWidth={1.7} /> : <PanelLeftClose size={18} strokeWidth={1.7} />}
                </span>
              </button>
            </header>
            <nav className="sidebar-nav" aria-label="Primary navigation">
            <div className="sidebar-nav-group">
              <div className="sidebar-category">Product</div>
              <button
                className={`nav-item ${isActive(['dashboard']) ? 'active' : ''}`}
                onClick={() => nav('dashboard')}
                aria-label="Home"
                title="Home"
              >
                <House size={18} aria-hidden="true" />
                <span>Home</span>
              </button>
              <button
                className={`nav-item ${projectsActive ? 'active' : ''}`}
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
                onClick={() => openModule('static')}
                aria-label="Review"
                title="Review"
              >
                <FileCheck2 size={18} aria-hidden="true" />
                <span>Review</span>
              </button>
              <button
                className={`nav-item ${dynamicActive ? 'active' : ''}`}
                onClick={() => openModule('dynamic')}
                aria-label="Dynamic Testing"
                title="Dynamic Testing"
              >
                <MonitorPlay size={18} aria-hidden="true" />
                <span>Dynamic Testing</span>
              </button>
            </div>

            <div className="sidebar-nav-group">
              <div className="sidebar-category">Settings</div>
              <button
                className={`nav-item ${isActive(['settings']) ? 'active' : ''}`}
                onClick={() => nav('settings')}
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={18} aria-hidden="true" />
                <span>Settings</span>
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

      {pendingModuleAction !== null && (
        <div className="workspace-project-launch">
          <Modal
            isOpen
            onClose={() => setPendingModuleAction(null)}
            title={pendingModuleAction === 'dynamic' ? 'Start Dynamic Testing' : 'Start a review'}
            descriptionId="project-selection-description"
            width={560}
          >
            <p className="modal-intro" id="project-selection-description">
              Choose a project before the setup form opens. Your selection will determine where this work is saved.
            </p>
            <div className="form-field">
              <label htmlFor="project-selection">Project</label>
              <Select
                id="project-selection"
                data-autofocus
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                options={projects.map(project => ({ value: project.id, label: project.name }))}
                aria-label="Project"
              />
            </div>
            {projects.find(project => project.id === selectedProjectId) && (
              <div className="project-selection-summary">
                <strong>{projects.find(project => project.id === selectedProjectId)?.name}</strong>
                {projects.find(project => project.id === selectedProjectId)?.description && (
                  <p>{projects.find(project => project.id === selectedProjectId)?.description}</p>
                )}
                <span>{projects.find(project => project.id === selectedProjectId)?.workspacePath}</span>
              </div>
            )}
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setPendingModuleAction(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleProjectSelectionContinue} disabled={!selectedProjectId}>Continue</button>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
