import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { userFacingError } from './utils/userFacingError';
import './command.css';
import './workspace.css';
import { AppShell } from './components/AppShell';
import { DashboardScreen } from './screens/DashboardScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ProjectDetailScreen } from './screens/ProjectDetailScreen';
import type { ProjectCreateSource } from './components/ProjectCreateModal';
import { DynamicSessionScreen } from './screens/DynamicSessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { RequirementsScreen } from './screens/RequirementsScreen';
import { EvidenceBrowser } from './screens/EvidenceBrowser';
import { ReviewActivityScreen } from './screens/ReviewActivityScreen';
import { ReviewEntryScreen } from './screens/ReviewEntryScreen';
import { api } from './api/client';
import type { Project, AiProviderSetting, Screen } from './types';
import { ActiveReviewProvider } from './hooks/useActiveReview';
import { ReviewToast } from './components/ReviewToast';

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
      setError(userFacingError(e, 'Centinel could not load this workspace. Try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateProject = async (name: string, description: string, workspacePath: string, source: ProjectCreateSource, navigateAfter = true) => {
    const project = await api.createProject(name, description, workspacePath, source);
    setProjects(prev => [project, ...prev]);
    if (navigateAfter) setScreen({ name: 'project-detail', projectId: project.id });
    return project;
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
    <ActiveReviewProvider>
      <AppShell
        screen={screen}
        onNavigate={setScreen}
        projects={projects}
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
            initialSearch={screen.search}
            initialStateFilter={screen.stateFilter}
            initialCreate={screen.initialCreate}
            onNavigate={setScreen}
            onCreate={async (name, description, workspacePath, source) => handleCreateProject(name, description, workspacePath, source)}
            onDelete={handleDeleteProject}
          />
        )}
        {screen.name === 'project-detail' && currentProject && (
         <ProjectDetailScreen
            project={currentProject}
            initialAction={screen.initialAction}
            initialStaticSessionId={screen.initialStaticSessionId}
            onNavigate={setScreen}
            onProjectUpdated={(updatedProject) => setProjects(prev => prev.map(project => project.id === updatedProject.id ? updatedProject : project))}
          />
        )}
        {screen.name === 'dynamic-session' && (
          <DynamicSessionScreen
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'review-activity' && (
          <ReviewActivityScreen
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'review-entry' && (
          <ReviewEntryScreen
            projects={projects}
            initialProjectId={screen.projectId}
            onNavigate={setScreen}
            onCreateProject={(name, description, workspacePath, source) => handleCreateProject(name, description, workspacePath, source, false)}
          />
        )}
        {screen.name === 'evidence-browser' && (
          <EvidenceBrowser
            projectId={screen.projectId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'requirements' && (
          <RequirementsScreen
            projectId={screen.projectId}
            onNavigate={setScreen}
          />
        )}
        {screen.name === 'settings' && (
          <SettingsScreen settings={aiSettings} onRefresh={loadData} />
        )}
      </AppShell>
      <ReviewToast />
    </ActiveReviewProvider>
  );
}

export default App;
