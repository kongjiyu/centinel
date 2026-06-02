import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { AppShell } from './components/AppShell';
import { DashboardScreen } from './screens/DashboardScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ProjectDetailScreen } from './screens/ProjectDetailScreen';
import { DynamicSessionScreen } from './screens/DynamicSessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { api } from './api/client';
import type { Project, AiProviderSetting, Screen } from './types';

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'dashboard' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [aiSettings, setAiSettings] = useState<AiProviderSetting[]>([]);
  const [sidecarOnline, setSidecarOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [projectsData, settingsData] = await Promise.all([
        api.projects(),
        api.aiSettings(),
      ]);
      setProjects(projectsData);
      setAiSettings(settingsData);
      setSidecarOnline(true);
      setError(null);
    } catch (e) {
      setSidecarOnline(false);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateProject = async (name: string, description: string, workspacePath: string) => {
    const project = await api.createProject(name, description, workspacePath);
    setProjects(prev => [project, ...prev]);
  };

  const handleDeleteProject = async (id: string) => {
    await api.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (screen.name === 'project-detail' && screen.projectId === id) {
      setScreen({ name: 'projects' });
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <p>Connecting to Centinel sidecar...</p>
      </div>
    );
  }

  if (!sidecarOnline && error) {
    return (
      <div className="error-screen">
        <h1>Centinel</h1>
        <p>Cannot connect to the local sidecar service.</p>
        <p className="error-detail">{error}</p>
        <button className="btn-primary" onClick={() => { setLoading(true); loadData(); }}>
          Retry
        </button>
      </div>
    );
  }

  const currentProject = screen.name === 'project-detail'
    ? projects.find(p => p.id === screen.projectId) ?? null
    : null;

  return (
    <AppShell
      screen={screen}
      onNavigate={setScreen}
      aiSettings={aiSettings}
      sidecarOnline={sidecarOnline}
    >
      {screen.name === 'dashboard' && (
        <DashboardScreen
          projects={projects}
          aiSettings={aiSettings}
          onNavigate={setScreen}
        />
      )}
      {screen.name === 'projects' && (
        <ProjectsScreen
          projects={projects}
          onNavigate={setScreen}
          onCreate={handleCreateProject}
          onDelete={handleDeleteProject}
        />
      )}
      {screen.name === 'project-detail' && currentProject && (
        <ProjectDetailScreen
          project={currentProject}
          onNavigate={setScreen}
        />
      )}
      {screen.name === 'dynamic-session' && (
        <DynamicSessionScreen
          projectId={screen.projectId}
          sessionId={screen.sessionId}
          onNavigate={setScreen}
        />
      )}
      {screen.name === 'settings' && (
        <SettingsScreen settings={aiSettings} onRefresh={loadData} />
      )}
    </AppShell>
  );
}

export default App;
