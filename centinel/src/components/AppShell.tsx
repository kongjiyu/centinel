import { LayoutDashboard, FolderOpen, Search, Settings, Circle, Radio } from 'lucide-react';
import type { Screen, AiProviderSetting } from '../types';

type Props = {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  aiSettings: AiProviderSetting[];
  sidecarOnline: boolean;
  children: React.ReactNode;
};

export function AppShell({ screen, onNavigate, aiSettings, sidecarOnline, children }: Props) {
  const nav = (name: Screen['name']) => onNavigate({ name } as Screen);

  const textOk = aiSettings.some(s => s.id === 'text' && s.hasApiKey);
  const visionOk = aiSettings.some(s => s.id === 'vision' && s.hasApiKey);

  const isActive = (names: Screen['name'][]) => names.includes(screen.name);

  return (
    <div className={`app-shell ${screen.name === 'dashboard' ? 'dashboard-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/assets/centinel-shield.svg" alt="" className="sidebar-logo-mark" />
          <span className="sidebar-title">CENTINEL</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${isActive(['dashboard']) ? 'active' : ''}`}
            onClick={() => nav('dashboard')}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </button>
          <button
            className={`nav-item ${isActive(['projects', 'project-detail', 'dynamic-session', 'static-session', 'evidence-browser', 'requirements']) ? 'active' : ''}`}
            onClick={() => nav('projects')}
          >
            <FolderOpen size={18} />
            <span>Projects</span>
          </button>
          <button
            className={`nav-item ${screen.name === 'evidence-browser' ? 'active' : ''}`}
            onClick={() => {
              // Navigate to evidence browser of first project or stay
              if (screen.name === 'project-detail' || screen.name === 'evidence-browser') {
                const projectId = 'projectId' in screen ? (screen as any).projectId : undefined;
                if (projectId) {
                  onNavigate({ name: 'evidence-browser', projectId });
                } else {
                  nav('projects');
                }
              } else {
                nav('projects');
              }
            }}
          >
            <Search size={18} />
            <span>Evidence</span>
          </button>
          <button
            className={`nav-item ${isActive(['settings']) ? 'active' : ''}`}
            onClick={() => nav('settings')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          {screen.name === 'dashboard' && (
            <div className="sidebar-edge-module" aria-hidden="true">
              <div className="edge-module-label">
                <Radio size={11} />
                QA node
              </div>
              <div className="edge-radar">
                <span className="edge-radar-sweep" />
                <span className="edge-radar-core" />
              </div>
            </div>
          )}
          <div className="status-block">
            <div className="status-row">
              <Circle
                size={8}
                className={`status-dot ${sidecarOnline ? 'online' : 'offline'}`}
                fill="currentColor"
              />
              <span className="status-label">Sidecar</span>
              <span className={`status-value ${sidecarOnline ? 'ok' : 'err'}`}>
                {sidecarOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="status-row">
              <Circle
                size={8}
                className={`status-dot ${textOk ? 'online' : 'offline'}`}
                fill="currentColor"
              />
              <span className="status-label">Text AI</span>
              <span className={`status-value ${textOk ? 'ok' : 'err'}`}>
                {textOk ? 'Ready' : 'Missing'}
              </span>
            </div>
            <div className="status-row">
              <Circle
                size={8}
                className={`status-dot ${visionOk ? 'online' : 'offline'}`}
                fill="currentColor"
              />
              <span className="status-label">Vision AI</span>
              <span className={`status-value ${visionOk ? 'ok' : 'err'}`}>
                {visionOk ? 'Ready' : 'Missing'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
