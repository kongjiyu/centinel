import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Image,
  FileText,
  Terminal,
  Bug,
  Activity,
  Clock,
  AlertCircle,
  CheckCircle2,
  CircleX,
  LoaderCircle,
  ShieldAlert,
  Globe,
  Route,
  ListChecks,
} from 'lucide-react';
import { api } from '../api/client';
import { CommandEmptyState, CommandPageHeader } from '../components/CommandUI';
import { EvidenceScreenshotThumbnail, EvidenceScreenshotViewer } from '../components/EvidenceScreenshot';
import type { DynamicSession, DynamicEvidence, Screen } from '../types';
import { userFacingError } from '../utils/userFacingError';
import './DynamicSessionScreen.css';

type Props = { projectId: string; sessionId: string; onNavigate: (screen: Screen) => void };

const EVIDENCE_ICONS: Record<string, typeof Image> = {
  screenshot: Image,
  action_trace: Activity,
  ai_request: FileText,
  ai_response: FileText,
  console_log: Terminal,
  debug_log: Bug,
  session_summary: FileText,
};

const EVIDENCE_GROUPS: { type: DynamicEvidence['type']; label: string }[] = [
  { type: 'screenshot', label: 'Screenshots' },
  { type: 'action_trace', label: 'Action trace' },
  { type: 'ai_response', label: 'Model responses' },
  { type: 'ai_request', label: 'Model requests' },
  { type: 'console_log', label: 'Console logs' },
  { type: 'debug_log', label: 'Debug log' },
  { type: 'session_summary', label: 'Session summary' },
];

const TECHNICAL_EVIDENCE_TYPES = new Set<DynamicEvidence['type']>([
  'ai_request',
  'ai_response',
  'console_log',
  'debug_log',
  'session_summary',
]);

function EvidenceGroup({
  group,
  items,
  onOpenScreenshot,
}: {
  group: (typeof EVIDENCE_GROUPS)[number];
  items: DynamicEvidence[];
  onOpenScreenshot: (item: DynamicEvidence) => void;
}) {
  if (items.length === 0) return null;
  const Icon = EVIDENCE_ICONS[group.type] || FileText;

  return (
    <section className={`dynamic-evidence-section dynamic-evidence-${group.type}`}>
      <h2 className="command-section-heading">
        <Icon size={16} /> {group.label} ({items.length})
      </h2>
      {group.type === 'screenshot' ? (
        <div className="screenshot-grid stagger-children">
          {items.map(item => (
            <EvidenceScreenshotThumbnail
              key={item.id}
              item={item}
              className="screenshot-item clickable"
              showLabel
              onOpen={onOpenScreenshot}
            />
          ))}
        </div>
      ) : (
        <div className="evidence-list stagger-children">
          {items.map(item => (
            <div key={item.id} className="evidence-item">
              <div className="evidence-header">
                <span className="evidence-type">{group.label}</span>
                <span className="evidence-time">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <div className="evidence-summary">{item.summary}</div>
              <code className="evidence-path">{item.filePath}</code>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function sessionOutcome(status: DynamicSession['status']) {
  switch (status) {
    case 'success':
      return { title: 'Test completed', copy: 'The requested journey completed successfully.', icon: CheckCircle2, tone: 'success' };
    case 'failure':
      return { title: 'Test found a blocking issue', copy: 'The requested journey could not be completed.', icon: CircleX, tone: 'danger' };
    case 'blocked':
      return { title: 'Test could not continue', copy: 'Centinel was blocked before it could complete the goal.', icon: ShieldAlert, tone: 'warning' };
    case 'cancelled':
      return { title: 'Test cancelled', copy: 'This run was stopped before completion.', icon: CircleX, tone: 'neutral' };
    case 'queued':
      return { title: 'Preparing the browser', copy: 'Centinel is preparing an isolated browser and the test plan.', icon: LoaderCircle, tone: 'active' };
    default:
      return { title: 'Testing the website', copy: 'Centinel is navigating the website and recording evidence.', icon: LoaderCircle, tone: 'active' };
  }
}

/** Keep runner diagnostics out of the main workflow while giving a specific next step. */
function failureRecovery(reason: string, status: DynamicSession['status']): string {
  const normalized = reason.toLowerCase();
  if (/playwright|browsertype\.launch|executable.*(?:doesn.t|not) exist|chromium/.test(normalized)) {
    return 'Centinel could not start its test browser. Install or repair the Playwright browser, then rerun the test.';
  }
  if (/network|econnrefused|timeout|failed to fetch|connection refused/.test(normalized)) {
    return 'Centinel could not reach the target website. Confirm that the site is available, then rerun the test.';
  }
  if (/permission|access denied|http\s*403/.test(normalized)) {
    return 'Centinel could not access the target website. Check the target permissions or sign-in requirements, then rerun the test.';
  }
  return status === 'blocked'
    ? 'The test could not continue. Check the target website and test setup, then rerun the test.'
    : 'The test could not finish. Check the target website and test setup, then rerun the test.';
}

export function DynamicSessionScreen({ projectId, sessionId, onNavigate }: Props) {
  const [session, setSession] = useState<DynamicSession | null>(null);
  const [evidence, setEvidence] = useState<DynamicEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState<DynamicEvidence | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        api.getDynamicSession(projectId, sessionId),
        api.listDynamicEvidence(projectId, sessionId),
      ]);
      setSession(s); setEvidence(e);
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load dynamic session:', err);
      setLoadError('The test run could not be loaded. Your saved run and evidence have not been changed.');
    }
    finally { setLoading(false); }
  }, [projectId, sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session || (session.status !== 'running' && session.status !== 'queued')) return;
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [session?.status, load]);

  const handleCancel = async () => {
    try { await api.cancelDynamicSession(projectId, sessionId); await load(); } catch {}
  };

  if (loading) return <div className="screen command-loading" role="status" aria-live="polite"><Activity size={20} /> Loading session...</div>;
  if (loadError && !session) return (
    <div className="screen">
      <CommandPageHeader eyebrow="Dynamic Testing" title="Test run" onBack={() => onNavigate({ name: 'project-detail', projectId })} />
      <CommandEmptyState
        icon={Bug}
        title="Test run unavailable"
        description={loadError}
        action={<button type="button" className="btn-primary" onClick={() => { setLoading(true); void load(); }}>Retry</button>}
      />
    </div>
  );
  if (!session) return <div className="screen"><CommandEmptyState icon={Bug} title="Session not found" description="This Dynamic Testing session is unavailable or has been removed." /></div>;

  const isActive = session.status === 'running' || session.status === 'queued';
  const screenshots = evidence.filter(item => item.type === 'screenshot');
  const actionTrace = evidence.filter(item => item.type === 'action_trace');
  const latestScreenshot = screenshots.at(-1);
  const latestActions = actionTrace.slice(-5).reverse();
  const outcome = sessionOutcome(session.status);
  const OutcomeIcon = outcome.icon;
  const recovery = failureRecovery(session.failureReason, session.status);
  const outcomeCopy = session.status === 'failure' || session.status === 'blocked'
    ? recovery
    : session.finalSummary || outcome.copy;

  return (
    <div className="screen command-dynamic-session animate-fade-in">
      <CommandPageHeader
        eyebrow="Dynamic Testing"
        title={session.name || 'Test run'}
        description={session.goal}
        status={{ label: session.status }}
        onBack={() => onNavigate({ name: 'project-detail', projectId })}
        meta={<><span>{session.missionType === 'smoke' ? 'Smoke test' : 'User journey'}</span><span>{new Date(session.createdAt).toLocaleString()}</span></>}
        actions={(
          <>
          {isActive && (
            <button className="btn-delete" onClick={handleCancel}>
              <X size={14} /> Cancel
            </button>
          )}
          </>
        )}
      />

      <section className={`dynamic-outcome dynamic-outcome-${outcome.tone}`} aria-live={isActive ? 'polite' : undefined}>
        <span className="dynamic-outcome-icon">
          <OutcomeIcon size={23} aria-hidden="true" className={isActive ? 'dynamic-spin' : undefined} />
        </span>
        <div className="dynamic-outcome-copy">
          <span className="dynamic-overline">{isActive ? 'Autonomous run' : 'Test outcome'}</span>
          <h2>{outcome.title}</h2>
          <p>{outcomeCopy}</p>
        </div>
        <div className="dynamic-outcome-count">
          <strong>{actionTrace.length}</strong>
          <span>recorded {actionTrace.length === 1 ? 'action' : 'actions'}</span>
        </div>
      </section>

      <section className="dynamic-run-context" aria-label="Test configuration">
        <div className="dynamic-context-item dynamic-context-target">
          <Globe size={16} aria-hidden="true" />
          <span><small>Target website</small><code>{session.targetUrl}</code></span>
        </div>
        <div className="dynamic-context-item">
          <Route size={16} aria-hidden="true" />
          <span><small>Test type</small><strong>{session.missionType === 'smoke' ? 'Smoke test' : 'User journey'}</strong></span>
        </div>
        <div className="dynamic-context-item">
          <ListChecks size={16} aria-hidden="true" />
          <span><small>Action limit</small><strong>{session.maxSteps}</strong></span>
        </div>
        <div className="dynamic-context-item">
          <Clock size={16} aria-hidden="true" />
          <span><small>Last updated</small><strong>{new Date(session.updatedAt).toLocaleString()}</strong></span>
        </div>
      </section>

      {isActive && (
        <section className="dynamic-live-layout">
          <div className="dynamic-browser-panel">
            <div className="dynamic-section-title">
              <div><span className="dynamic-overline">Visual evidence</span><h2>Latest browser view</h2></div>
              <span className="dynamic-live-badge"><span /> Live</span>
            </div>
            {latestScreenshot ? (
              <EvidenceScreenshotThumbnail
                item={latestScreenshot}
                className="dynamic-live-screenshot"
                showLabel
                onOpen={setSelectedScreenshot}
              />
            ) : (
              <div className="dynamic-browser-empty">
                <Image size={24} aria-hidden="true" />
                <strong>Waiting for the first screenshot</strong>
                <span>The browser view will appear when the run captures visual evidence.</span>
              </div>
            )}
          </div>

          <aside className="dynamic-activity-panel">
            <div className="dynamic-section-title">
              <div><span className="dynamic-overline">Action trace</span><h2>Live activity</h2></div>
            </div>
            <div className="dynamic-action-progress">
              <div><span>Recorded actions</span><strong>{actionTrace.length} of up to {session.maxSteps}</strong></div>
              <div className="dynamic-progress-track" aria-hidden="true"><span style={{ width: `${Math.min(100, actionTrace.length / session.maxSteps * 100)}%` }} /></div>
            </div>
            {latestActions.length > 0 ? (
              <ol className="dynamic-live-actions">
                {latestActions.map((item, index) => (
                  <li key={item.id}>
                    <span className="dynamic-action-index">{actionTrace.length - index}</span>
                    <span><strong>{item.summary}</strong><small>{new Date(item.createdAt).toLocaleTimeString()}</small></span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dynamic-activity-empty">No browser actions have been recorded yet.</p>
            )}
          </aside>
        </section>
      )}

      {!isActive && evidence.some(item => !TECHNICAL_EVIDENCE_TYPES.has(item.type)) && (
        <div className="dynamic-evidence-heading">
          <span className="dynamic-overline">Recorded evidence</span>
          <h2>See what happened</h2>
          <p>Review the captured screens first, then follow the action trace for the exact sequence.</p>
        </div>
      )}

      {!isActive && EVIDENCE_GROUPS.filter(group => !TECHNICAL_EVIDENCE_TYPES.has(group.type)).map(group => (
          <EvidenceGroup
            key={group.type}
            group={group}
            items={evidence.filter(item => item.type === group.type)}
            onOpenScreenshot={setSelectedScreenshot}
          />
        ))}

      {evidence.some(item => TECHNICAL_EVIDENCE_TYPES.has(item.type)) && (
        <details className="advanced-options technical-evidence">
          <summary>Technical details</summary>
          <div className="advanced-options-content">
            {EVIDENCE_GROUPS.filter(group => TECHNICAL_EVIDENCE_TYPES.has(group.type)).map(group => (
              <EvidenceGroup
                key={group.type}
                group={group}
                items={evidence.filter(item => item.type === group.type)}
                onOpenScreenshot={setSelectedScreenshot}
              />
            ))}
          </div>
        </details>
      )}

      <EvidenceScreenshotViewer
        screenshots={screenshots}
        selectedId={selectedScreenshot?.id ?? null}
        onSelect={setSelectedScreenshot}
        onClose={() => setSelectedScreenshot(null)}
      />

      {loadError && (
        <div className="command-inline-notice danger" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{loadError}</span>
          <button type="button" className="btn-secondary" onClick={() => void load()}>Retry</button>
        </div>
      )}
    </div>
  );
}
