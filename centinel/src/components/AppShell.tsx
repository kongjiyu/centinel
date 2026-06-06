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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/assets/centinel-logo-transparent.png" alt="Centinel" className="sidebar-logo" />
          <span className="sidebar-title">Centinel</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${screen.name === 'dashboard' ? 'active' : ''}`}
            onClick={() => nav('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`nav-item ${screen.name === 'projects' || screen.name === 'project-detail' || screen.name === 'dynamic-session' || screen.name === 'requirements' ? 'active' : ''}`}
            onClick={() => nav('projects')}
          >
            Projects
          </button>
          <button
            className={`nav-item ${screen.name === 'settings' ? 'active' : ''}`}
            onClick={() => nav('settings')}
          >
            Settings
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className={`status-indicator ${sidecarOnline ? 'online' : 'offline'}`}>
            <span className="status-dot" />
            {sidecarOnline ? 'Sidecar online' : 'Sidecar offline'}
          </div>
          <div className="api-status">
            <span className={textOk ? 'configured' : 'unconfigured'}>
              Text {textOk ? '✓' : '✗'}
            </span>
            <span className={visionOk ? 'configured' : 'unconfigured'}>
              Vision {visionOk ? '✓' : '✗'}
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
