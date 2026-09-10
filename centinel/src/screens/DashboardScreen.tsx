import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileEdit,
  FileCheck2,
  FileWarning,
  FolderCog,
  FolderOpen,
  MonitorX,
  MonitorPlay,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { ReviewIllustration } from '../components/HomeIllustrations';
import { ProjectSummaryTable } from '../components/ProjectSummaryTable';
import {
  formatActivityTime,
  timestamp,
  useProjectSummaries,
  type ProjectAction,
} from '../hooks/useProjectSummaries';
import type { AiProviderSetting, Project, Screen } from '../types';
import './DashboardScreen.css';

type Props = {
  projects: Project[];
  aiSettings: AiProviderSetting[];
  onNavigate: (screen: Screen) => void;
};

type Recommendation = {
  id: string;
  title: string;
  summary: string;
  actionLabel: string;
  tone: 'static' | 'dynamic' | 'setup' | 'project';
  Icon: typeof Code2;
  onClick: () => void;
};

function actionPriority(action: ProjectAction): number {
  if (action.tone === 'danger') return 4;
  if (action.action === 'Resolve' || action.state.includes('blocked')) return 3;
  if (action.action === 'Review') return 2;
  return 1;
}

function actionIconFor(action: ProjectAction): typeof Code2 {
  if (action.module === 'Dynamic Testing') return MonitorX;
  if (action.state === 'Changes required') return FileEdit;
  if (action.state === 'Review required') return FileCheck2;
  if (action.state === 'Setup required') return FolderCog;
  return FileWarning;
}

export function DashboardScreen({ projects, aiSettings, onNavigate }: Props) {
  const { summaries, loading, unavailable, reload } = useProjectSummaries(projects);
  const [recommendationIndex, setRecommendationIndex] = useState(0);

  const latestProject = useMemo(
    () => [...projects].sort((a, b) => timestamp(b.updatedAt || b.createdAt) - timestamp(a.updatedAt || a.createdAt))[0],
    [projects],
  );

  const allActions = useMemo(() => summaries
    .map(summary => summary.action)
    .filter((action): action is ProjectAction => Boolean(action))
    .sort((a, b) => actionPriority(b) - actionPriority(a) || timestamp(b.updatedAt) - timestamp(a.updatedAt)), [summaries]);
  const visibleActions = allActions.slice(0, 3);

  const recentProjects = useMemo(() => summaries.slice(0, 4), [summaries]);

  const hasTextSetting = aiSettings.some(setting => setting.id === 'text' && setting.hasApiKey);
  const hasVisionSetting = aiSettings.some(setting => setting.id === 'vision' && setting.hasApiKey);
  const needsInitialSetup = !hasTextSetting || !hasVisionSetting;

  const openProjectFlow = (initialAction: 'static' | 'dynamic') => {
    if (latestProject) {
      onNavigate(initialAction === 'static'
        ? { name: 'review-entry', projectId: latestProject.id }
        : { name: 'project-detail', projectId: latestProject.id, initialAction });
    } else {
      onNavigate({ name: 'projects' });
    }
  };

  const recommendations: Recommendation[] = [];
  if (!latestProject) {
    recommendations.push({
      id: 'create-project',
      title: 'Create your first project',
      summary: 'Start a workspace for sources, reviews, and browser tests.',
      actionLabel: 'Create project',
      tone: 'project',
      Icon: FolderOpen,
      onClick: () => onNavigate({ name: 'projects' }),
    });
  } else {
    if (needsInitialSetup) {
      recommendations.push({
        id: 'setup',
        title: 'Complete provider setup',
        actionLabel: 'Open settings',
        tone: 'setup',
        Icon: Settings,
        summary: `Connect the services needed before reviewing ${latestProject.name}.`,
        onClick: () => onNavigate({ name: 'settings' }),
      });
    }

    recommendations.push({
      id: 'review',
      title: 'Review current sources',
      summary: `Check consistency and traceability in ${latestProject.name}.`,
      actionLabel: 'Open Review',
      tone: 'static',
      Icon: Code2,
      onClick: () => openProjectFlow('static'),
    });

    recommendations.push({
      id: 'dynamic',
      title: 'Verify a live workflow',
      summary: `Run Dynamic Testing for ${latestProject.name}.`,
      actionLabel: 'Start test',
      tone: 'dynamic',
      Icon: MonitorPlay,
      onClick: () => openProjectFlow('dynamic'),
    });

    recommendations.push({
      id: 'project',
      title: 'Continue the latest project',
      summary: latestProject.name,
      actionLabel: 'Open project',
      tone: 'project',
      Icon: FolderOpen,
      onClick: () => onNavigate({ name: 'project-detail', projectId: latestProject.id }),
    });
  }

  useEffect(() => {
    setRecommendationIndex(index => Math.min(index, Math.max(recommendations.length - 1, 0)));
  }, [recommendations.length]);

  const openAction = (action: ProjectAction) => {
    if (action.module === 'Dynamic Testing' && action.sessionId && action.action === 'Inspect') {
      onNavigate({ name: 'dynamic-session', projectId: action.project.id, sessionId: action.sessionId });
      return;
    }
    if (action.module === 'Review' && action.sessionId) {
      onNavigate({ name: 'review-activity', projectId: action.project.id, sessionId: action.sessionId, reviewName: action.sessionName });
      return;
    }
    onNavigate({ name: 'project-detail', projectId: action.project.id, initialStaticSessionId: action.sessionId });
  };

  const recommendation = recommendations[recommendationIndex] ?? recommendations[0];
  const RecommendationIcon = recommendation.Icon;

  return (
    <div className="screen dashboard-home">
      <div className="home-background-art" aria-hidden="true"><ReviewIllustration /></div>

      <div className="home-top-grid">
        <section className="home-panel highlights-panel" aria-labelledby="action-required-title">
          <div className="home-section-heading">
            <div>
              <h2 id="action-required-title">Action required</h2>
            </div>
          </div>

          {loading && summaries.length === 0 ? (
            <div className="home-message" role="status">Loading required actions…</div>
          ) : visibleActions.length > 0 ? (
            <>
              <div className="action-required-list">
                {visibleActions.map(action => {
                  const ActionIcon = actionIconFor(action);
                  return (
                    <article key={action.id} className={`action-required-item action-required-${action.tone}`}>
                      <header className="action-required-header">
                        <span className="action-required-icon" aria-hidden="true">
                          <ActionIcon size={18} strokeWidth={1.8} />
                        </span>
                        <div className="action-required-context">
                          <strong>{action.project.name}</strong>
                          <span aria-hidden="true">·</span>
                          <span>{action.module}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={action.updatedAt}>{formatActivityTime(action.updatedAt)}</time>
                        </div>
                        <button
                          type="button"
                          className={`action-required-button action-required-button-${action.tone}`}
                          onClick={() => openAction(action)}
                          aria-label={`${action.action} ${action.project.name}: ${action.state}`}
                        >
                          {action.action}
                        </button>
                      </header>
                      <div className="action-required-body">
                        <h3>{action.state}</h3>
                        <p>{action.reason}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
              {allActions.length > visibleActions.length && (
                <div className="action-required-overflow">
                  <span>{allActions.length - visibleActions.length} more {allActions.length - visibleActions.length === 1 ? 'project needs' : 'projects need'} attention</span>
                  <button type="button" onClick={() => onNavigate({ name: 'projects', stateFilter: 'needs_attention' })}>
                    View affected projects
                  </button>
                </div>
              )}
            </>
          ) : unavailable ? (
            <div className="home-message home-message-error" role="alert">
              <AlertCircle size={20} aria-hidden="true" />
              <span>Required actions are unavailable.</span>
              <button className="home-inline-action" onClick={reload}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
            </div>
          ) : (
            <div className="home-message"><FileCheck2 size={22} aria-hidden="true" /><span>Nothing needs your attention.</span></div>
          )}
        </section>

        <div className="home-right-rail">
          <section className="home-panel recommendations-panel" aria-labelledby="recommendations-title">
            <div className={`recommendation-visual recommendation-${recommendation.tone}`}>
              <div className="recommendation-heading">
                <div>
                  <h2 id="recommendations-title">Recommendations</h2>
                </div>
                {recommendations.length > 1 && (
                  <div className="recommendation-controls">
                    <span className="recommendation-position" aria-live="polite">{recommendationIndex + 1} of {recommendations.length}</span>
                    <button
                      type="button"
                      className="recommendation-nav"
                      aria-label="Previous recommendation"
                      onClick={() => setRecommendationIndex(index => (index - 1 + recommendations.length) % recommendations.length)}
                    >
                      <ChevronLeft size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="recommendation-nav"
                      aria-label="Next recommendation"
                      onClick={() => setRecommendationIndex(index => (index + 1) % recommendations.length)}
                    >
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
              <div className="recommendation-summary">
                <span className="recommendation-icon" aria-hidden="true"><RecommendationIcon size={24} strokeWidth={1.8} /></span>
                <div>
                  <h3>{recommendation.title}</h3>
                  <p>{recommendation.summary}</p>
                </div>
              </div>
              <button type="button" className="recommendation-action" onClick={recommendation.onClick} aria-label={`${recommendation.actionLabel}: ${recommendation.summary}`}>
                {recommendation.actionLabel}
              </button>
              <img className="recommendation-watermark" src="/assets/centinel-shield.svg" alt="" aria-hidden="true" />
            </div>
          </section>

          <div className="quick-actions-grid" aria-label="Quick actions">
            <button
              type="button"
              className="quick-action quick-action-create"
              onClick={() => onNavigate({ name: 'projects', initialCreate: true })}
            >
              <span>Create project</span>
            </button>
            <button type="button" className="quick-action quick-action-secondary" onClick={() => openProjectFlow('static')}>
              <FileCheck2 size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>Review</span>
            </button>
            <button type="button" className="quick-action quick-action-secondary" onClick={() => openProjectFlow('dynamic')}>
              <MonitorPlay size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>Dynamic Testing</span>
            </button>
          </div>
        </div>
      </div>

      <section className="home-panel recent-projects-panel" aria-labelledby="recent-projects-title">
        <div className="recent-projects-header">
          <div className="recent-projects-title-group">
            <div>
              <div className="recent-projects-title-row">
                <h2 id="recent-projects-title">Recent projects</h2>
              </div>
            </div>
          </div>
          <button type="button" className="view-more-projects" onClick={() => onNavigate({ name: 'projects' })}>
            View more
          </button>
        </div>

        {loading && summaries.length === 0 ? (
          <div className="home-message" role="status">Loading projects…</div>
        ) : recentProjects.length > 0 ? (
          <ProjectSummaryTable summaries={recentProjects} onNavigate={onNavigate} variant="dashboard" ariaLabel="Recent projects" />
        ) : unavailable ? (
          <div className="home-message home-message-error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>Recent projects are unavailable.</span>
            <button className="home-inline-action" onClick={reload}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
          </div>
        ) : (
          <div className="home-message"><span>No recent projects yet.</span></div>
        )}
      </section>
    </div>
  );
}
