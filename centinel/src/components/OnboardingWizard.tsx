import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, X } from 'lucide-react';
import { api, type ProjectReportExportResult } from '../api/client';
import { isWorkflowProviderConfigured } from '../providerReadiness';
import { isExecutedReviewStatus } from '../reviewViewModel';
import type { AiProviderSetting, Project, RequirementCandidate, Screen, StaticSession } from '../types';
import { openExternalUrl } from '../utils/openExternalUrl';
import { userFacingError } from '../utils/userFacingError';
import { ReportExportCard } from './ReportExportCard';
import './OnboardingWizard.css';

/** The goal from the README's Sample Shop walkthrough. */
export const SAMPLE_REVIEW_GOAL = 'Check that sign-in, checkout and order viewing follow docs/requirements.md, especially privacy and server-side validation.';
export const SAMPLE_BROWSER_TEST = {
  name: 'Sign-in page shows the login form',
  url: 'http://localhost:4100',
  goal: 'Open the shop and confirm that the sign-in form and the product list are shown. Do not sign in.',
  visibleText: 'Sign in',
};
const SAMPLE_PROJECT_NAME = 'Sample Shop';

export type OnboardingRecord = {
  status: 'active' | 'dismissed' | 'completed';
  projectId?: string;
  reviewId?: string;
  runId?: string;
};

const storageKey = (accountId: string) => `centinel:onboarding:v1:${accountId}`;

export function readOnboarding(accountId: string): OnboardingRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    const parsed = raw ? JSON.parse(raw) as OnboardingRecord : null;
    return parsed && ['active', 'dismissed', 'completed'].includes(parsed.status) ? parsed : null;
  } catch {
    return null;
  }
}

function writeOnboarding(accountId: string, record: OnboardingRecord) {
  try { localStorage.setItem(storageKey(accountId), JSON.stringify(record)); } catch { /* Private mode: keep in memory only. */ }
}

/** Reopen the guide from Help. An existing Sample Shop project is reused, not duplicated. */
export function restartOnboarding(accountId: string): void {
  writeOnboarding(accountId, { status: 'active' });
}

/** Show the wizard for a new account (no projects yet), or while one is in progress. */
export function shouldShowOnboarding(accountId: string, projects: Project[]): boolean {
  const record = readOnboarding(accountId);
  if (record) return record.status === 'active';
  return projects.length === 0;
}

type Props = {
  accountId: string;
  projects: Project[];
  aiSettings: AiProviderSetting[];
  onNavigate: (screen: Screen) => void;
  /** Reload projects and Model Provider settings after the wizard changes them. */
  onDataChanged: () => Promise<void> | void;
  onClose: () => void;
};

type StepId = 'model' | 'project' | 'requirements' | 'review' | 'report';
const STEPS: Array<{ id: StepId; title: string }> = [
  { id: 'model', title: 'Connect ChatGPT' },
  { id: 'project', title: 'Create the Sample Shop project' },
  { id: 'requirements', title: 'Confirm its requirements' },
  { id: 'review', title: 'Start a Review and a browser test' },
  { id: 'report', title: 'Open the report' },
];

type CodexModel = Awaited<ReturnType<typeof api.codexModels>>[number];
const screenshotCapable = (model: CodexModel) => model.supportsImages && model.imageSupportKnown !== false;
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function OnboardingWizard({ accountId, projects, aiSettings, onNavigate, onDataChanged, onClose }: Props) {
  const [record, setRecord] = useState<OnboardingRecord>(() => readOnboarding(accountId) ?? { status: 'active' });
  const update = useCallback((patch: Partial<OnboardingRecord>) => {
    setRecord(current => {
      const next = { ...current, ...patch };
      writeOnboarding(accountId, next);
      return next;
    });
  }, [accountId]);
  useEffect(() => { if (!readOnboarding(accountId)) writeOnboarding(accountId, record); }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function act(name: string, task: () => Promise<void>) {
    setBusy(name); setError(''); setMessage('');
    try { await task(); }
    catch (cause) { if (mounted.current) setError(userFacingError(cause, 'This step could not finish. Try again.')); }
    finally { if (mounted.current) setBusy(''); }
  }

  // Step 1 — model provider.
  const textReady = isWorkflowProviderConfigured(aiSettings, 'text');
  const visionReady = isWorkflowProviderConfigured(aiSettings, 'vision');
  const usesCodex = aiSettings.some(setting => (setting.id === 'text' || setting.id === 'vision') && setting.provider === 'codex');
  const [codex, setCodex] = useState<Awaited<ReturnType<typeof api.codexStatus>> | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const loginStarted = useRef(0);
  const refreshCodex = useCallback(async () => {
    const next = await api.codexStatus();
    if (mounted.current) setCodex(next);
    return next;
  }, []);
  useEffect(() => { void refreshCodex().catch(() => {}); }, [refreshCodex]);
  const codexDisconnected = usesCodex && codex !== null && !codex.connected;
  const modelDone = textReady && !codexDisconnected;

  const chooseModels = useCallback(async () => {
    const models = await api.codexModels();
    const text = models.find(model => model.isDefault) ?? models[0];
    if (!text) throw new Error('Your ChatGPT account has no models available for Centinel.');
    const vision = screenshotCapable(text) ? text : models.find(screenshotCapable);
    const save = (role: 'text' | 'vision', model: CodexModel) => api.updateAiSetting(role, { provider: 'codex', apiFormat: 'codex-app-server', apiKey: '', baseUrl: '', model: model.id, fallbackEnabled: false });
    // Fill in only workflows without a saved model; never replace a choice made in Settings.
    const saveText = !textReady;
    const saveVision = Boolean(vision) && !visionReady;
    if (saveText) await save('text', text);
    if (saveVision && vision) await save('vision', vision);
    await onDataChanged();
    if (!mounted.current) return;
    if (!saveText && !saveVision) setMessage('ChatGPT is connected. Your saved model choices are unchanged.');
    else if (saveText && saveVision && vision) setMessage(`Using ${text.label} for Review${vision.id === text.id ? ' and Dynamic Testing' : ` and ${vision.label} for Dynamic Testing`}. You can change this in Settings.`);
    else if (saveText) setMessage(`Using ${text.label} for Review.${vision || visionReady ? '' : ' No model with screenshot support was found, so the browser test is skipped.'} You can change this in Settings.`);
    else if (vision) setMessage(`Using ${vision.label} for Dynamic Testing. You can change this in Settings.`);
  }, [onDataChanged, textReady, visionReady]);

  useEffect(() => {
    if (!loginId) return;
    const timer = setInterval(() => {
      if (Date.now() - loginStarted.current > 10 * 60_000) {
        setLoginId(null);
        void api.codexCancelLogin(loginId).catch(() => {});
        setError('ChatGPT sign-in timed out. Select Connect ChatGPT to try again.');
        return;
      }
      void refreshCodex().then(status => {
        if (!status.connected || !mounted.current) return;
        setLoginId(null);
        void act('models', chooseModels);
      }).catch(() => { /* Keep waiting; sign-in may still finish. */ });
    }, 2000);
    return () => clearInterval(timer);
  }, [loginId, refreshCodex, chooseModels]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectChatgpt = () => act('connect', async () => {
    const status = await refreshCodex();
    if (status.connected) { await chooseModels(); return; }
    if (!status.available) throw new Error(status.message || 'ChatGPT sign-in is unavailable on this device.');
    const login = await api.codexLogin();
    loginStarted.current = Date.now();
    setLoginId(login.loginId);
    if (!await openExternalUrl(login.authUrl)) {
      await api.codexCancelLogin(login.loginId).catch(() => {});
      setLoginId(null);
      throw new Error('Your browser could not open. Check your default browser and try again.');
    }
    setMessage('Finish signing in to ChatGPT in your browser. This step updates by itself.');
  });

  // Step 2 — Sample Shop project.
  const project = record.projectId ? projects.find(item => item.id === record.projectId) ?? null : null;
  const [shop, setShop] = useState<Awaited<ReturnType<typeof api.prepareSampleShop>> | null>(null);
  const createProject = () => act('project', async () => {
    const prepared = await api.prepareSampleShop();
    if (mounted.current) setShop(prepared);
    const existing = projects.find(item => item.name === SAMPLE_PROJECT_NAME && item.workspacePath === prepared.path);
    const created = existing ?? await api.createProject(SAMPLE_PROJECT_NAME, 'Practice web shop with planted bugs, bundled with Centinel.', prepared.path, { type: 'local-repository' });
    update({ projectId: created.id });
    await onDataChanged();
  });

  // Step 3 — requirements.
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<RequirementCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const loadRequirements = useCallback(async (projectId: string) => {
    const [requirements, pending] = await Promise.all([
      api.listRequirements(projectId),
      api.listRequirementCandidates(projectId, 'pending_confirmation'),
    ]);
    if (!mounted.current) return;
    setConfirmedCount(requirements.length);
    setCandidates(pending);
    setSelected(new Set(pending.map(candidate => candidate.id)));
  }, []);
  useEffect(() => {
    if (!record.projectId) return;
    void loadRequirements(record.projectId).catch(() => {});
  }, [record.projectId, loadRequirements]);
  const requirementsDone = (confirmedCount ?? 0) > 0;

  const extract = () => act('extract', async () => {
    if (!record.projectId) return;
    const artifacts = await api.listArtifacts(record.projectId);
    const document = artifacts.find(artifact => /(^|\/)docs\/requirements\.md$/i.test(artifact.originalPath || artifact.filePath))
      ?? artifacts.find(artifact => artifact.fileName.toLowerCase() === 'requirements.md');
    if (!document) throw new Error('The project has no docs/requirements.md. Open the project Source to check the import.');
    await api.extractRequirementCandidates(record.projectId, document.id);
    await loadRequirements(record.projectId);
  });

  const confirmSelected = () => act('confirm', async () => {
    if (!record.projectId) return;
    for (const candidate of candidates) {
      if (selected.has(candidate.id)) await api.confirmRequirementCandidate(record.projectId, candidate.id);
    }
    await loadRequirements(record.projectId);
  });

  // Step 4 — Review and browser test.
  const [goal, setGoal] = useState(SAMPLE_REVIEW_GOAL);
  const [withBrowserTest, setWithBrowserTest] = useState(true);
  const reviewKey = useRef(newKey());
  const runKey = useRef(newKey());
  const browserTestAvailable = visionReady && !codexDisconnected;
  const startReview = () => act('review', async () => {
    const projectId = record.projectId;
    if (!projectId) return;
    if (!goal.trim()) throw new Error('Write what this Review should check.');
    const [artifacts, requirements] = await Promise.all([api.listArtifacts(projectId), api.listRequirements(projectId)]);
    const active = artifacts.filter(artifact => !artifact.currency?.deprecated);
    const artifactIds = active.filter(artifact => artifact.type !== 'coding_standard').map(artifact => artifact.id);
    const standardIds = active.filter(artifact => artifact.type === 'coding_standard').map(artifact => artifact.id);
    const requirementIds = requirements.map(requirement => requirement.id);
    const review = await api.createStaticSession(projectId, {
      name: 'Pre-release review',
      instructions: goal.trim(),
      reviewMode: 'regular',
      reviewer: 'Project owner',
      scope: { artifactIds, requirementIds, standardIds },
      artifactIds, requirementIds, standardIds,
      selectedArtifactIds: artifactIds,
      selectedRequirementIds: requirementIds,
      selectedStandardIds: standardIds,
      idempotencyKey: reviewKey.current,
    });
    update({ reviewId: review.id });
    if (!withBrowserTest || !browserTestAvailable) return;
    try {
      const prepared = await api.prepareSampleShop();
      if (mounted.current) setShop(prepared);
      const checkId = newKey();
      const revision = await api.saveDynamicMission(projectId, {
        mode: 'guided',
        name: SAMPLE_BROWSER_TEST.name,
        goal: SAMPLE_BROWSER_TEST.goal,
        targetUrl: SAMPLE_BROWSER_TEST.url,
        maxSteps: 15,
        checks: [{ id: checkId, criterionId: `manual-${checkId}`, description: 'Expected visible text', kind: 'visible_text', expected: SAMPLE_BROWSER_TEST.visibleText, required: true }],
        context: null,
        contextAcknowledged: false,
        criterionExclusions: [],
      });
      const run = await api.startDynamicRun(projectId, revision.id, runKey.current);
      update({ runId: run.id });
    } catch (cause) {
      throw new Error(`The Review started, but the browser test could not start: ${userFacingError(cause, 'try it from Dynamic Testing.')}`);
    }
  });

  // Step 5 — wait for the Review, then export the report.
  const [review, setReview] = useState<StaticSession | null>(null);
  const [report, setReport] = useState<ProjectReportExportResult | null>(null);
  const reviewFinished = review ? isExecutedReviewStatus(review.status) : false;
  const reviewStopped = review ? ['failure', 'failed', 'blocked', 'cancelled'].includes(review.status) : false;
  useEffect(() => {
    const { projectId, reviewId } = record;
    if (!projectId || !reviewId || reviewFinished || reviewStopped) return;
    let current = true;
    const poll = () => api.getStaticSession(projectId, reviewId).then(next => { if (current) setReview(next); }).catch(() => {});
    void poll();
    const timer = setInterval(poll, 5000);
    return () => { current = false; clearInterval(timer); };
  }, [record, reviewFinished, reviewStopped]);

  const exportReport = () => act('report', async () => {
    if (!record.projectId || !record.reviewId) return;
    const result = await api.exportProjectReport(record.projectId, { reviewId: record.reviewId });
    if (mounted.current) setReport(result);
  });

  const done: Record<StepId, boolean> = {
    model: modelDone,
    project: Boolean(project),
    requirements: Boolean(project) && requirementsDone,
    review: Boolean(record.reviewId),
    report: Boolean(report),
  };
  const currentStep = STEPS.find(step => !done[step.id])?.id ?? 'report';

  const skip = () => { update({ status: 'dismissed' }); onClose(); };
  const finish = () => { update({ status: 'completed' }); onClose(); };
  const working = Boolean(busy);
  const formatDate = (value: string) => new Date(value).toLocaleString();

  function body(step: StepId) {
    switch (step) {
      case 'model':
        return <>
          <p>Centinel uses your ChatGPT plan to read code and drive the browser. You sign in to ChatGPT in your browser; no API key is needed.</p>
          <div className="onboarding-actions">
            {loginId
              ? <button type="button" className="btn-secondary" disabled={working} onClick={() => void act('cancel', async () => { await api.codexCancelLogin(loginId); setLoginId(null); })}>Cancel sign-in</button>
              : <button type="button" className="btn-primary" disabled={working} onClick={() => void connectChatgpt()}>{busy === 'connect' || busy === 'models' ? 'Connecting…' : 'Connect ChatGPT'}</button>}
            <button type="button" className="btn-link" onClick={() => onNavigate({ name: 'settings' })}>Use an API key instead</button>
          </div>
          {loginId && <p className="onboarding-status" role="status"><Loader2 size={16} aria-hidden="true" className="onboarding-spinner" /> Waiting for ChatGPT sign-in…</p>}
        </>;
      case 'project':
        return <>
          <p>The Sample Shop is a tiny web shop with three bugs planted on purpose. Centinel copies it to this Mac, runs it at <code>{SAMPLE_BROWSER_TEST.url}</code> and imports its code and requirements.</p>
          <div className="onboarding-actions">
            <button type="button" className="btn-primary" disabled={working} onClick={() => void createProject()}>{busy === 'project' ? 'Creating project…' : 'Create Sample Shop project'}</button>
          </div>
        </>;
      case 'requirements':
        return <>
          <p>Centinel checks code only against requirements you confirm. Extract the candidates from <code>docs/requirements.md</code>, read them, and confirm the ones that are right.</p>
          {candidates.length > 0 ? <>
            <fieldset className="onboarding-candidates">
              <legend>{candidates.length} candidate {candidates.length === 1 ? 'requirement' : 'requirements'} from requirements.md</legend>
              <ul>
                {candidates.map(candidate => <li key={candidate.id}>
                  <label>
                    <input type="checkbox" checked={selected.has(candidate.id)} disabled={working} onChange={event => setSelected(current => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(candidate.id); else next.delete(candidate.id);
                      return next;
                    })} />
                    <span><strong>{candidate.title}</strong><small>{candidate.statement}</small></span>
                  </label>
                </li>)}
              </ul>
            </fieldset>
            <div className="onboarding-actions">
              <button type="button" className="btn-primary" disabled={working || selected.size === 0} onClick={() => void confirmSelected()}>{busy === 'confirm' ? 'Confirming…' : `Confirm ${selected.size} ${selected.size === 1 ? 'requirement' : 'requirements'}`}</button>
            </div>
          </> : <div className="onboarding-actions">
            <button type="button" className="btn-primary" disabled={working} onClick={() => void extract()}>{busy === 'extract' ? 'Extracting requirements…' : 'Extract requirements'}</button>
          </div>}
          {busy === 'extract' && <p className="onboarding-status" role="status"><Loader2 size={16} aria-hidden="true" className="onboarding-spinner" /> Reading requirements.md with AI. This usually takes under a minute.</p>}
        </>;
      case 'review':
        return <>
          <div className="form-field">
            <label htmlFor="onboarding-review-goal">What should this Review verify?</label>
            <textarea id="onboarding-review-goal" rows={3} value={goal} disabled={working} onChange={event => setGoal(event.target.value)} />
          </div>
          <label className="onboarding-checkbox">
            <input type="checkbox" checked={withBrowserTest && browserTestAvailable} disabled={working || !browserTestAvailable} onChange={event => setWithBrowserTest(event.target.checked)} />
            <span>
              <strong>Also run a browser test</strong>
              <small>{browserTestAvailable
                ? <>“{SAMPLE_BROWSER_TEST.name}” opens <code>{SAMPLE_BROWSER_TEST.url}</code> and checks that the text “{SAMPLE_BROWSER_TEST.visibleText}” is visible.</>
                : 'Needs a Dynamic Testing model with screenshot support. Choose one in Settings.'}</small>
            </span>
          </label>
          {shop?.server === 'port_in_use' && <p className="onboarding-status" role="status">Something else is already using port 4100. The browser test opens whatever runs there.</p>}
          <div className="onboarding-actions">
            <button type="button" className="btn-primary" disabled={working} onClick={() => void startReview()}>{busy === 'review' ? 'Starting review…' : 'Start review'}</button>
          </div>
        </>;
      case 'report':
        if (report) return <>
          <ReportExportCard result={report} title="Sample Shop report ready" subject="Pre-release review" formatDate={formatDate} headingId="onboarding-report-title" />
          <div className="onboarding-actions">
            <button type="button" className="btn-primary" onClick={finish}>Finish</button>
            {record.projectId && <button type="button" className="btn-secondary" onClick={() => { finish(); onNavigate({ name: 'project-detail', projectId: record.projectId! }); }}>Open project</button>}
          </div>
        </>;
        return <>
          {reviewStopped
            ? <p className="onboarding-status onboarding-status-warning" role="status">The Review stopped before it finished. Open it to see why and retry.</p>
            : reviewFinished
              ? <p>The Review finished. Create the report to see what Centinel found, in plain language first and full detail after.</p>
              : <p className="onboarding-status" role="status"><Loader2 size={16} aria-hidden="true" className="onboarding-spinner" /> The Review is running. A project this size takes about four minutes; you can leave this page.</p>}
          <div className="onboarding-actions">
            {reviewFinished && <button type="button" className="btn-primary" disabled={working} onClick={() => void exportReport()}>{busy === 'report' ? 'Creating report…' : 'Create report'}</button>}
            {record.projectId && record.reviewId && <button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'review-activity', projectId: record.projectId!, sessionId: record.reviewId!, reviewName: 'Pre-release review' })}>Open Review</button>}
            {record.projectId && record.runId && <button type="button" className="btn-secondary" onClick={() => onNavigate({ name: 'dynamic-testing', projectId: record.projectId!, runId: record.runId })}>Open browser test</button>}
          </div>
        </>;
    }
  }

  function summary(step: StepId): string {
    switch (step) {
      case 'model': return codex?.accountLabel ? `Connected as ${codex.accountLabel}` : 'Model Provider is ready';
      case 'project': return project ? `${project.name} is ready` : '';
      case 'requirements': return `${confirmedCount ?? 0} confirmed ${confirmedCount === 1 ? 'requirement' : 'requirements'}`;
      case 'review': return record.runId ? 'Review and browser test started' : 'Review started';
      case 'report': return 'Report created';
    }
  }

  return (
    <section className="home-panel onboarding-panel" aria-labelledby="onboarding-title">
      <header className="onboarding-header">
        <div>
          <h2 id="onboarding-title">Get started with the Sample Shop</h2>
          <p>Five steps, about ten minutes. Skip it if you would rather start with your own project.</p>
        </div>
        <button type="button" className="onboarding-skip" onClick={skip} aria-label="Skip setup">
          <X size={16} aria-hidden="true" /> Skip
        </button>
      </header>
      <ol className="onboarding-steps">
        {STEPS.map((step, index) => {
          const isDone = done[step.id];
          const isCurrent = step.id === currentStep;
          return (
            <li key={step.id} className={`onboarding-step${isCurrent ? ' is-current' : ''}${isDone ? ' is-done' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
              <span className="onboarding-step-marker" aria-hidden="true">
                {isDone ? <CheckCircle2 size={20} /> : isCurrent ? <span className="onboarding-step-number">{index + 1}</span> : <Circle size={20} />}
              </span>
              <div className="onboarding-step-content">
                <h3>{step.title}<span className="visually-hidden">{isDone ? ' (done)' : isCurrent ? ' (current step)' : ''}</span></h3>
                {isDone && !(isCurrent && step.id === 'report') && <p className="onboarding-step-summary">{summary(step.id)}</p>}
                {isCurrent && body(step.id)}
              </div>
            </li>
          );
        })}
      </ol>
      {message && <p className="form-success" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
