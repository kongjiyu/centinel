import { useEffect, useState } from 'react';
import { FileCheck2, FolderOpen, House, MonitorPlay, Settings, Circle } from 'lucide-react';
import type { Project, Screen, AiProviderSetting } from '../types';
import { Modal } from './Modal';
import { Select } from './Select';

type ModuleAction = 'static' | 'dynamic';

type Props = {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  projects: Project[];
  aiSettings: AiProviderSetting[];
  sidecarOnline: boolean;
  children: React.ReactNode;
};

export function AppShell({ screen, onNavigate, projects, aiSettings, sidecarOnline, children }: Props) {
  const nav = (name: Screen['name']) => onNavigate({ name } as Screen);
  const [pendingModuleAction, setPendingModuleAction] = useState<ModuleAction | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const textOk = aiSettings.some(s => s.id === 'text' && s.hasApiKey);
  const visionOk = aiSettings.some(s => s.id === 'vision' && s.hasApiKey);

  const isActive = (names: Screen['name'][]) => names.includes(screen.name);
  useEffect(() => {
    if (pendingModuleAction && !projects.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id ?? '');
    }
  }, [pendingModuleAction, projects, selectedProjectId]);

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

  const projectsActive = screen.name === 'projects' ||
    (screen.name === 'project-detail' && !screen.initialAction) ||
    screen.name === 'evidence-browser';
  const staticActive = screen.name === 'requirements' || screen.name === 'review-activity' || screen.name === 'review-entry' ||
    (screen.name === 'project-detail' && screen.initialAction === 'static');
  const dynamicActive = screen.name === 'dynamic-session' ||
    (screen.name === 'project-detail' && screen.initialAction === 'dynamic');

  return (
    <div className={`app-shell command-mode workspace-mode ${screen.name === 'dashboard' ? 'dashboard-mode' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/assets/centinel-shield.svg" alt="" className="sidebar-logo-mark" />
          <span className="sidebar-title">CENTINEL</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${isActive(['dashboard']) ? 'active' : ''}`}
            onClick={() => nav('dashboard')}
            aria-label="Home"
            title="Home"
          >
            <House size={18} />
            <span>Home</span>
          </button>
          <button
            className={`nav-item ${projectsActive ? 'active' : ''}`}
            onClick={() => nav('projects')}
            aria-label="Projects"
            title="Projects"
          >
            <FolderOpen size={18} />
            <span>Projects</span>
          </button>
          <button
            className={`nav-item ${staticActive ? 'active' : ''}`}
            onClick={() => openModule('static')}
            aria-label="Review"
            title="Review"
          >
            <FileCheck2 size={18} />
            <span>Review</span>
          </button>
          <button
            className={`nav-item ${dynamicActive ? 'active' : ''}`}
            onClick={() => openModule('dynamic')}
            aria-label="Dynamic Testing"
            title="Dynamic Testing"
          >
            <MonitorPlay size={18} />
            <span>Dynamic Testing</span>
          </button>
          <button
            className={`nav-item ${isActive(['settings']) ? 'active' : ''}`}
            onClick={() => nav('settings')}
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-block" aria-label="Services status">
            <div className="status-row">
              <Circle
                size={8}
                className={`status-dot ${sidecarOnline ? 'online' : 'offline'}`}
                fill="currentColor"
              />
              <span className="status-label">Services ready</span>
              <span className={`status-value ${sidecarOnline && textOk && visionOk ? 'ok' : 'err'}`}>
                {sidecarOnline && textOk && visionOk ? 'Ready' : 'Setup required'}
              </span>
            </div>
            {(!sidecarOnline || !textOk || !visionOk) && (
              <button className="sidebar-status-action" onClick={() => nav('settings')}>
                Open Settings
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="main-content" id="main-content" tabIndex={-1}>
        {children}
      </main>

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
