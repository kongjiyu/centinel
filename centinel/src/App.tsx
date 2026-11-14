import { AlertTriangle } from 'lucide-react';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { hashToScreen, isRouteHash, screenToHash } from './navigation/screenHash';
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import './App.css';
import { userFacingError } from './utils/userFacingError';
import './command.css';
import './workspace.css';
import './screens/ProfileScreen.css';
import { AppShell } from './components/AppShell';
import { DashboardScreen } from './screens/DashboardScreen';
import type { ProjectRepositoryInput } from './types';
import { restartOnboarding } from './components/OnboardingWizard';
import { AuthScreen } from './screens/AuthScreen';
import { api, prepareWorkspaceSidecar } from './api/client';
import { startConnectedSourceReconciliation } from './integrations/connectedSourceReconciliation';
import { startRepositoryIndexSync } from './integrations/repositoryIndexSync';
import type { Project, AiProviderSetting, Screen } from './types';
import { ActiveReviewProvider } from './hooks/useActiveReview';
import { ReviewToast } from './components/ReviewToast';
import { UpdatePrompt } from './components/UpdatePrompt';
import { GithubConnectionPrompt } from './components/GithubConnectionPrompt';
import { isSupabaseAuthConfigured, restoreSupabaseSession, signOutSupabase, subscribeToDeepLinkAuth, subscribeToSupabaseAuth } from './auth/supabaseAuth';
import type { Session } from '@supabase/supabase-js';

// Screens outside the first view load on demand so the initial bundle stays
// small. Home and the sign-in screen stay in the main chunk.
const ProjectsScreen = lazy(() => import('./screens/ProjectsScreen').then(module => ({ default: module.ProjectsScreen })));
const ProjectDetailScreen = lazy(() => import('./screens/ProjectDetailScreen').then(module => ({ default: module.ProjectDetailScreen })));
const DynamicWorkspaceScreen = lazy(() => import('./screens/DynamicWorkspaceScreen').then(module => ({ default: module.DynamicWorkspaceScreen })));
const DynamicSessionScreen = lazy(() => import('./screens/DynamicSessionScreen').then(module => ({ default: module.DynamicSessionScreen })));
const ActivityDirectoryScreen = lazy(() => import('./screens/ActivityDirectoryScreen').then(module => ({ default: module.ActivityDirectoryScreen })));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then(module => ({ default: module.SettingsScreen })));
const ProfileScreen = lazy(() => import('./screens/ProfileScreen').then(module => ({ default: module.ProfileScreen })));
const RequirementsScreen = lazy(() => import('./screens/RequirementsScreen').then(module => ({ default: module.RequirementsScreen })));
const EvidenceBrowser = lazy(() => import('./screens/EvidenceBrowser').then(module => ({ default: module.EvidenceBrowser })));
const ReviewActivityScreen = lazy(() => import('./screens/ReviewActivityScreen').then(module => ({ default: module.ReviewActivityScreen })));
const ReviewEntryScreen = lazy(() => import('./screens/ReviewEntryScreen').then(module => ({ default: module.ReviewEntryScreen })));
const ReviewPlaygroundScreen = lazy(() => import('./screens/ReviewPlaygroundScreen').then(module => ({ default: module.ReviewPlaygroundScreen })));
const ReviewsListScreen = lazy(() => import('./screens/ReviewsListScreen').then(module => ({ default: module.ReviewsListScreen })));
const HelpScreen = lazy(() => import('./screens/HelpScreen').then(module => ({ default: module.HelpScreen })));

/** Shared placeholder while an on-demand screen downloads. */
function ScreenLoading() {
  return (
    <div className="screen screen-loading" aria-busy="true">
      <LoadingSkeleton label="Loading page" variant="panel" />
      <LoadingSkeleton label="Loading page content" variant="rows" rows={4} />
    </div>
  );
}

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
  const [screen, setScreen] = useState<Screen>(() => (typeof window !== 'undefined' && hashToScreen(window.location.hash)) || { name: 'dashboard' });
  const navigate = (next: Screen) => setScreen(next.name === 'project-detail' && next.initialAction === 'dynamic' ? { name: 'dynamic-testing', projectId: next.projectId } : next);
  // Keep the page in the URL hash so Back/Forward, reload and shared links work.
  useEffect(() => {
    const hash = screenToHash(screen);
    if (window.location.hash !== hash && (!window.location.hash || isRouteHash(window.location.hash))) window.location.hash = hash;
  }, [screen]);
  useEffect(() => {
    const follow = () => {
      const next = hashToScreen(window.location.hash);
      if (next) setScreen(current => screenToHash(current) === window.location.hash ? current : next);
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const indexSyncProjectIds = useRef<string[]>([]);
  indexSyncProjectIds.current = projects.map(project => project.id);
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
    await prepareWorkspaceSidecar();
    if (generation !== loadGeneration.current) return;
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
    return startConnectedSourceReconciliation(api);
  }, [entryMode, accountUserId]);

  useEffect(() => {
    if (entryMode !== 'workspace' || !accountUserId) return;
    return startRepositoryIndexSync(api, () => indexSyncProjectIds.current);
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

  const handleCreateProject = async (name: string, description: string, sources: ProjectRepositoryInput[]) => {
    const project = await api.createProject(name, description, '', sources);
    setProjects(prev => [project, ...prev]);
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
      <main className="loading-screen project-workspace-loading" aria-busy="true">
        <LoadingSkeleton label="Loading project workspace" variant="panel" />
        <LoadingSkeleton label="Loading project pages" variant="rows" rows={5} />
      </main>
    );
  }

  if (!sidecarOnline && error) {
    return (
      <div className="error-screen" role="alert">
        <span className="error-screen-icon" aria-hidden="true"><AlertTriangle size={24} /></span>
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
    <ActiveReviewProvider key={accountUserId ?? 'local'} accountId={accountUserId}>
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
        <Suspense fallback={<ScreenLoading />}>
        {screen.name === 'dashboard' && (
          <DashboardScreen
            projects={projects}
            aiSettings={aiSettings}
            onNavigate={navigate}
            accountId={accountUserId}
            onDataChanged={loadData}
          />
        )}
        {screen.name === 'projects' && (
          <ProjectsScreen
            projects={projects}
            initialSearch={screen.search}
            initialStateFilter={screen.stateFilter}
            initialCreate={screen.initialCreate}
            onNavigate={navigate}
            onCreate={handleCreateProject}
            onDelete={handleDeleteProject}
          />
        )}
        {screen.name === 'project-detail' && currentProject && (
         <ProjectDetailScreen
            project={currentProject}
            initialAction={screen.initialAction}
            initialSection={screen.initialSection}
            sourceArtifactId={screen.sourceArtifactId}
            findingsReviewId={screen.findingsReviewId}
            findingId={screen.findingId}
            initialStaticSessionId={screen.initialStaticSessionId}
            onNavigate={navigate}
            onProjectUpdated={(updatedProject) => setProjects(prev => prev.map(project => project.id === updatedProject.id ? updatedProject : project))}
          />
        )}
        {(screen.name === 'review-directory' || screen.name === 'dynamic-directory') && (
          <ActivityDirectoryScreen key={screen.name} kind={screen.name === 'review-directory' ? 'review' : 'dynamic'} projects={projects} onNavigate={navigate} />
        )}
        {screen.name === 'dynamic-testing' && <DynamicWorkspaceScreen projects={projects} initialProjectId={screen.projectId} initialRunId={screen.runId} initialMissionId={screen.missionId} initialDraft={screen.draft} listing={screen.listing} onNavigate={navigate} />}
        {screen.name === 'dynamic-session' && (
          <DynamicSessionScreen
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            onNavigate={navigate}
          />
        )}
        {(screen.name === 'review-activity' || screen.name === 'review-finding') && (
          <ReviewActivityScreen
            key={`${screen.name}:${screen.projectId}:${screen.sessionId}:${screen.name === 'review-finding' ? screen.findingId : screen.initialTab ?? ''}`}
            accountId={accountUserId}
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            findingId={screen.name === 'review-finding' ? screen.findingId : undefined}
            initialTab={screen.name === 'review-activity' ? screen.initialTab : undefined}
            onNavigate={navigate}
          />
        )}
        {screen.name === 'review-entry' && (
          <ReviewEntryScreen
            projects={projects}
            initialProjectId={screen.projectId}
            comparisonParentReviewId={screen.comparisonParentReviewId}
            onNavigate={target => navigate(screen.returnToPlayground && target.name === 'review-activity' ? { name: 'review-playground', projectId: target.projectId, sessionId: target.sessionId } : target)}
            onCreateProject={handleCreateProject}
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
          <SettingsScreen settings={aiSettings} onRefresh={loadData} initialSection={screen.section} />
        </>}
        {screen.name === 'help' && <HelpScreen onOpenSetupGuide={accountUserId ? () => { restartOnboarding(accountUserId); setScreen({ name: 'dashboard' }); } : undefined} />}
        {screen.name === 'review-playground' && (
          <ReviewPlaygroundScreen projects={projects} initialProjectId={screen.projectId} initialSessionId={screen.sessionId} onNavigate={setScreen} />
        )}
        {screen.name === 'profile' && <ProfileScreen accountEmail={accountEmail} authProvider={authProvider} />}
        {screen.name === 'reviews' && (
          <ReviewsListScreen
            projectId={screen.projectId}
            projects={projects}
            initialStatus={screen.status}
            onNavigate={navigate}
          />
        )}
        </Suspense>
      </AppShell>
      {/* Global overlays render outside the shell; this box-less wrapper gives
          them the same light workspace primitives (buttons, dialogs). */}
      <div className="workspace-mode global-overlays">
        <ReviewToast onOpenReview={(projectId, sessionId, reviewName) => navigate({ name: 'review-activity', projectId, sessionId, reviewName })} />
        {screen.name !== 'review-activity' && <UpdatePrompt />}
        <GithubConnectionPrompt isOpen={githubConnectionPromptOpen} onClose={() => setGithubConnectionPromptOpen(false)} />
      </div>
    </ActiveReviewProvider>
  );
}

export default App;
