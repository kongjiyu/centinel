import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { userFacingError } from './utils/userFacingError';
import './command.css';
import './workspace.css';
import './screens/ProfileScreen.css';
import { AppShell } from './components/AppShell';
import { DashboardScreen } from './screens/DashboardScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { ProjectDetailScreen } from './screens/ProjectDetailScreen';
import type { ProjectCreateSource } from './components/ProjectCreateModal';
import { DynamicWorkspaceScreen } from './screens/DynamicWorkspaceScreen';
import { DynamicSessionScreen } from './screens/DynamicSessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RequirementsScreen } from './screens/RequirementsScreen';
import { EvidenceBrowser } from './screens/EvidenceBrowser';
import { ReviewActivityScreen } from './screens/ReviewActivityScreen';
import { ReviewEntryScreen } from './screens/ReviewEntryScreen';
import { ReviewPlaygroundScreen } from './screens/ReviewPlaygroundScreen';
import { AuthScreen } from './screens/AuthScreen';
import { api } from './api/client';
import { reconcileOneDueSlackSource, SLACK_RECONCILIATION_INTERVAL_MS } from './integrations/slackReconciliation';
import { startGitHubReconciliation } from './integrations/githubReconciliation';
import type { Project, AiProviderSetting, Screen } from './types';
import { ActiveReviewProvider } from './hooks/useActiveReview';
import { ReviewToast } from './components/ReviewToast';
import { GithubConnectionPrompt } from './components/GithubConnectionPrompt';
import { isSupabaseAuthConfigured, restoreSupabaseSession, signOutSupabase, subscribeToDeepLinkAuth, subscribeToSupabaseAuth } from './auth/supabaseAuth';
import type { Session } from '@supabase/supabase-js';

type AuthProvider = 'github' | 'google' | 'email' | null;

function authProviderFor(session: Session): AuthProvider {
  const provider = session.user.app_metadata.provider;
  if (provider === 'github' || provider === 'google') return provider;
  return 'email';
}

function githubUsernameFor(session: Session): string | null {
  if (authProviderFor(session) !== 'github') return null;
  const metadata = session.user.user_metadata as Record<string, unknown> | undefined;
  const value = metadata?.user_name ?? metadata?.username ?? metadata?.preferred_username ?? metadata?.login;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function App() {
  const supabaseAuthConfigured = isSupabaseAuthConfigured();
  const [entryMode, setEntryMode] = useState<'auth' | 'workspace'>('auth');
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountUserId, setAccountUserId] = useState<string | null>(null);
  const [authProvider, setAuthProvider] = useState<AuthProvider>(null);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [githubAccountLogin, setGithubAccountLogin] = useState<string | null>(null);
  const [githubStatusLoaded, setGithubStatusLoaded] = useState(false);
  const [githubPromptedForUserId, setGithubPromptedForUserId] = useState<string | null>(null);
  const [githubConnectionPromptOpen, setGithubConnectionPromptOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'dashboard' });
  const navigate = (next: Screen) => setScreen(next.name === 'project-detail' && next.initialAction === 'dynamic' ? { name: 'dynamic-testing', projectId: next.projectId } : next);
  const [projects, setProjects] = useState<Project[]>([]);
  const [aiSettings, setAiSettings] = useState<AiProviderSetting[]>([]);
  const [sidecarOnline, setSidecarOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(!supabaseAuthConfigured);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const loadGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setSettingsLoading(true);
    void api.aiSettings().then(settingsData => {
      if (generation !== loadGeneration.current) return;
      setAiSettings(settingsData);
      setSettingsError(null);
    }).catch(cause => {
      if (generation !== loadGeneration.current) return;
      setSettingsError(userFacingError(cause, 'Model Provider settings are unavailable. Try again.'));
    }).finally(() => { if (generation === loadGeneration.current) setSettingsLoading(false); });
    try {
      const projectsData = await api.projects();
      if (generation !== loadGeneration.current) return;
      setProjects(projectsData);
      setSidecarOnline(true);
      setError(null);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setSidecarOnline(false);
      setError(userFacingError(e, 'Centinel could not load this workspace. Try again.'));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    void loadData();
  }, [authReady, loadData]);

  useEffect(() => {
    if (!supabaseAuthConfigured) return;
    let active = true;
    void restoreSupabaseSession()
      .then(session => {
        if (!active || !session) return;
        setAccountEmail(session.user.email ?? null);
        setAccountUserId(session.user.id);
        setAuthProvider(authProviderFor(session));
        setGithubAccountLogin(githubUsernameFor(session));
        setEntryMode('workspace');
      })
      .catch(() => {
        // The sign-in screen remains available when an expired/invalid local
        // session cannot be restored.
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    const unsubscribe = subscribeToSupabaseAuth(session => {
      if (!active) return;
      if (session) {
        setAccountEmail(session.user.email ?? null);
        setAccountUserId(session.user.id);
        setAuthProvider(authProviderFor(session));
        setGithubAccountLogin(githubUsernameFor(session));
        setSwitchingAccount(false);
        setEntryMode('workspace');
      } else {
        setAccountEmail(null);
        setAccountUserId(null);
        setAuthProvider(null);
        setGithubLogin(null);
        setGithubAccountLogin(null);
        setEntryMode('auth');
      }
    });
    const unsubscribeDeepLink = subscribeToDeepLinkAuth(
      session => {
        if (!active) return;
        setAccountEmail(session.user.email ?? null);
        setAccountUserId(session.user.id);
        setAuthProvider(authProviderFor(session));
        setGithubAccountLogin(githubUsernameFor(session));
        setSwitchingAccount(false);
        setEntryMode('workspace');
      },
      () => {
        // A malformed, expired, or cancelled browser hand-off leaves the
        // sign-in screen available for a safe retry.
      },
    );
    return () => { active = false; unsubscribe(); unsubscribeDeepLink(); };
  }, [supabaseAuthConfigured]);

  useEffect(() => {
    if (entryMode !== 'workspace') return;
    let active = true;
    const refreshGithubStatus = () => api.githubStatus()
      .then(status => {
        if (!active) return;
        setGithubLogin(status.connected ? status.login : null);
        setGithubStatusLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setGithubLogin(null);
        setGithubStatusLoaded(false);
      });
    setGithubStatusLoaded(false);
    void refreshGithubStatus();
    const handleWindowFocus = () => { void refreshGithubStatus(); };
    window.addEventListener('focus', handleWindowFocus);
    return () => { active = false; window.removeEventListener('focus', handleWindowFocus); };
  }, [entryMode]);

  useEffect(() => {
    if (authProvider !== 'github' || !accountUserId || !githubStatusLoaded || githubLogin || githubPromptedForUserId === accountUserId) return;
    setGithubPromptedForUserId(accountUserId);
    setGithubConnectionPromptOpen(true);
  }, [accountUserId, authProvider, githubLogin, githubPromptedForUserId, githubStatusLoaded]);

  useEffect(() => {
    if (githubLogin) setGithubConnectionPromptOpen(false);
  }, [githubLogin]);

  useEffect(() => {
    if (entryMode !== 'workspace' || !accountUserId) return;
    let active = true;
    let inFlight = false;
    let nextProjectIndex = 0;
    const reconcile = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        // Read the current user's RLS-scoped projects for each pass rather
        // than relying on a list cached before an account switch.
        const projectIds = (await api.projects()).map(project => project.id);
        if (!active) return;
        const result = await reconcileOneDueSlackSource(projectIds, nextProjectIndex, api, Date.now(), () => active);
        nextProjectIndex = result.nextIndex;
      } catch {
        // Authentication and connection failures remain visible through the
        // normal workspace and source status surfaces.
      } finally {
        inFlight = false;
      }
    };
    const firstPass = window.setTimeout(() => { void reconcile(); }, 60_000);
    const interval = window.setInterval(() => { void reconcile(); }, SLACK_RECONCILIATION_INTERVAL_MS);
    return () => {
      active = false;
      window.clearTimeout(firstPass);
      window.clearInterval(interval);
    };
  }, [entryMode, accountUserId]);

  useEffect(() => {
    if (entryMode !== 'workspace' || !accountUserId) return;
    return startGitHubReconciliation(api);
  }, [entryMode, accountUserId]);

  const returnToSignIn = () => {
    loadGeneration.current++;
    void signOutSupabase().catch(() => undefined);
    setAccountEmail(null);
    setAccountUserId(null);
    setAuthProvider(null);
    setGithubLogin(null);
    setGithubAccountLogin(null);
    setGithubConnectionPromptOpen(false);
    setSwitchingAccount(false);
    setScreen({ name: 'dashboard' });
    setEntryMode('auth');
  };

  useEffect(() => {
    const handleAuthExpired = () => { returnToSignIn(); };
    window.addEventListener('centinel:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('centinel:auth-expired', handleAuthExpired);
  }, []);

  const switchAccount = () => {
    // Retain the current session until a new authentication succeeds so the
    // Back action is a real recovery path, not a misleading sign-out.
    setSwitchingAccount(true);
    setEntryMode('auth');
  };

  if (entryMode === 'auth') {
    return <AuthScreen onSignIn={(email) => {
      setAccountEmail(email);
      setSwitchingAccount(false);
      setEntryMode('workspace');
      // Supabase sign-in caches a bearer token immediately before invoking
      // this callback. Refresh the workspace so the first authenticated view
      // cannot be populated from an unauthenticated/local compatibility load.
      void loadData();
    }} onBackToWorkspace={switchingAccount ? () => { setSwitchingAccount(false); setEntryMode('workspace'); } : undefined} />;
  }

  const handleCreateProject = async (name: string, description: string, workspacePath: string, source: ProjectCreateSource, navigateAfter = true) => {
    const project = await api.createProject(name, description, workspacePath, source);
    setProjects(prev => [project, ...prev]);
    if (navigateAfter) setScreen({ name: 'project-detail', projectId: project.id, initialSection: source.type === 'github' ? 'source' : undefined });
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
      <div className="loading-screen" role="status">
        <p>Loading projects…</p>
      </div>
    );
  }

  if (!sidecarOnline && error) {
    return (
      <div className="error-screen">
        <h1>Centinel</h1>
        <p>The workspace could not be loaded.</p>
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
        onNavigate={navigate}
        projects={projects}
        accountEmail={accountEmail}
        githubLogin={githubLogin}
        accountGithubLogin={githubAccountLogin}
        authProvider={authProvider}
        onSwitchAccount={switchAccount}
        onLogOut={returnToSignIn}
      >
        {screen.name === 'dashboard' && (
          <DashboardScreen
            projects={projects}
            aiSettings={aiSettings}
            onNavigate={navigate}
          />
        )}
        {screen.name === 'projects' && (
          <ProjectsScreen
            projects={projects}
            initialSearch={screen.search}
            initialStateFilter={screen.stateFilter}
            initialCreate={screen.initialCreate}
            onNavigate={navigate}
            onCreate={async (name, description, workspacePath, source) => handleCreateProject(name, description, workspacePath, source)}
            onDelete={handleDeleteProject}
          />
        )}
        {screen.name === 'project-detail' && currentProject && (
         <ProjectDetailScreen
            project={currentProject}
            initialAction={screen.initialAction}
            initialSection={screen.initialSection}
            initialStaticSessionId={screen.initialStaticSessionId}
            onNavigate={navigate}
            onProjectUpdated={(updatedProject) => setProjects(prev => prev.map(project => project.id === updatedProject.id ? updatedProject : project))}
          />
        )}
        {screen.name === 'dynamic-testing' && <DynamicWorkspaceScreen projects={projects} initialProjectId={screen.projectId} initialRunId={screen.runId} onNavigate={navigate} />}
        {screen.name === 'dynamic-session' && (
          <DynamicSessionScreen
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            onNavigate={navigate}
          />
        )}
        {screen.name === 'review-activity' && (
          <ReviewActivityScreen
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            onNavigate={navigate}
          />
        )}
        {screen.name === 'review-entry' && (
          <ReviewEntryScreen
            projects={projects}
            initialProjectId={screen.projectId}
            comparisonParentReviewId={screen.comparisonParentReviewId}
            onNavigate={target => navigate(screen.returnToPlayground && target.name === 'review-activity' ? { name: 'review-playground', projectId: target.projectId, sessionId: target.sessionId } : target)}
            onCreateProject={(name, description, workspacePath, source) => handleCreateProject(name, description, workspacePath, source, false)}
          />
        )}
        {screen.name === 'evidence-browser' && (
          <EvidenceBrowser
            projectId={screen.projectId}
            onNavigate={navigate}
          />
        )}
        {screen.name === 'requirements' && (
          <RequirementsScreen
            projectId={screen.projectId}
            onNavigate={navigate}
          />
        )}
        {screen.name === 'settings' && <>
          {settingsLoading && <p role="status">Loading Model Provider settings…</p>}
          {settingsError && <div className="command-inline-alert" role="status"><span>{settingsError}</span><button type="button" className="btn-secondary" onClick={() => void loadData()}>Retry settings</button></div>}
          <SettingsScreen settings={aiSettings} onRefresh={loadData} />
        </>}
        {screen.name === 'review-playground' && (
          <ReviewPlaygroundScreen projects={projects} initialProjectId={screen.projectId} initialSessionId={screen.sessionId} onNavigate={setScreen} />
        )}
        {screen.name === 'profile' && <ProfileScreen accountEmail={accountEmail} authProvider={authProvider} />}
      </AppShell>
      <ReviewToast />
      <GithubConnectionPrompt isOpen={githubConnectionPromptOpen} onClose={() => setGithubConnectionPromptOpen(false)} />
    </ActiveReviewProvider>
  );
}

export default App;
