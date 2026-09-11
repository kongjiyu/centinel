import { ChevronRight, FileCheck2, MonitorPlay, Pin, Trash2 } from 'lucide-react';
import {
  formatActivityTime,
  getProjectState,
  type ProjectSummary,
} from '../hooks/useProjectSummaries';
import type { Screen } from '../types';
import { formatEntityId } from '../utils/entityId';
import './ProjectSummaryTable.css';

type Props = {
  summaries: ProjectSummary[];
  onNavigate: (screen: Screen) => void;
  onDelete?: (summary: ProjectSummary) => void;
  /** Directory-only local pin affordance. Dashboard rows never render it. */
  isPinned?: (projectId: string) => boolean;
  onTogglePin?: (projectId: string) => void;
  showWorkspacePath?: boolean;
  showDescription?: boolean;
  ariaLabel: string;
  /** Dashboard rows intentionally omit the directory's action column. */
  variant?: 'directory' | 'directory-recent' | 'dashboard';
};

function openSummary(summary: ProjectSummary, onNavigate: Props['onNavigate']) {
  const activity = summary.latestActivity;
  if (!activity) {
    onNavigate({ name: 'project-detail', projectId: summary.project.id });
  } else if (activity.kind === 'dynamic') {
    onNavigate({ name: 'dynamic-session', projectId: summary.project.id, sessionId: activity.session.id });
  } else {
    onNavigate({ name: 'review-activity', projectId: summary.project.id, sessionId: activity.session.id, reviewName: activity.session.name });
  }
}

export function ProjectSummaryTable({
  summaries,
  onNavigate,
  onDelete,
  isPinned,
  onTogglePin,
  showWorkspacePath = false,
  showDescription = false,
  ariaLabel,
  variant = 'directory',
}: Props) {
  const usesRecentProjectStyle = variant === 'dashboard' || variant === 'directory-recent';
  const showsDirectoryControls = variant !== 'dashboard';
  return (
    <div className="project-summary-table-shell">
      <table className={`project-summary-table${usesRecentProjectStyle ? ' project-summary-table-dashboard' : ''}`} aria-label={ariaLabel}>
        <colgroup>
          {showsDirectoryControls && onTogglePin && <col className="project-summary-col-pin" />}
          <col className="project-summary-col-project" />
          <col className="project-summary-col-activity" />
          <col className="project-summary-col-state" />
          {showsDirectoryControls && <col className="project-summary-col-action" />}
        </colgroup>
        <thead className={usesRecentProjectStyle ? 'project-summary-table-head-dashboard' : undefined}>
          <tr>
            {showsDirectoryControls && onTogglePin && <th scope="col"><span className="visually-hidden">Pin</span></th>}
            <th scope="col">Project</th>
            <th scope="col">Latest activity</th>
            <th scope="col">Current state</th>
            {showsDirectoryControls && <th scope="col"><span className="visually-hidden">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {summaries.map(summary => {
            const activity = summary.latestActivity;
            const state = getProjectState(summary);
            const isDynamic = activity?.kind === 'dynamic';
            const ActivityIcon = isDynamic ? MonitorPlay : FileCheck2;
            const actionLabel = activity
              ? isDynamic ? 'Open test' : 'Open review'
              : 'Open project';

            return (
              <tr
                key={summary.project.id}
                className="project-summary-row"
                tabIndex={0}
                aria-label={`Open ${summary.project.name} overview`}
                onClick={event => {
                  if (event.target instanceof Element && event.target.closest('button')) return;
                  onNavigate({ name: 'project-detail', projectId: summary.project.id });
                }}
                onKeyDown={event => {
                  if (event.target instanceof Element && event.target.closest('button')) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onNavigate({ name: 'project-detail', projectId: summary.project.id });
                  }
                }}
              >
                {showsDirectoryControls && onTogglePin && (
                  <td className="project-summary-pin-cell" data-label="Pin">
                    <button
                      type="button"
                      className={`project-summary-pin${isPinned?.(summary.project.id) ? ' is-pinned' : ''}`}
                      onClick={() => onTogglePin(summary.project.id)}
                      aria-label={`${isPinned?.(summary.project.id) ? 'Unpin' : 'Pin'} ${summary.project.name}`}
                      aria-pressed={Boolean(isPinned?.(summary.project.id))}
                      title={isPinned?.(summary.project.id) ? 'Unpin project' : 'Pin project'}
                    >
                      <Pin size={16} strokeWidth={1.8} fill={isPinned?.(summary.project.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </td>
                )}
                <td data-label="Project">
                  <div className="project-summary-identity">
                    <strong>{summary.project.name}</strong>
                    {showDescription && <span>{summary.project.description || 'No project description'}</span>}
                    {showWorkspacePath && <code>{summary.project.workspacePath}</code>}
                  </div>
                </td>
                <td data-label="Latest activity">
                  {activity ? (
                    <div className={`project-activity-stack project-activity-${activity.kind}`}>
                      <strong title={activity.session.name}>{activity.session.name} <span className="project-activity-id">{formatEntityId(activity.session.id)}</span></strong>
                      <div className="project-activity-meta">
                        <ActivityIcon size={14} strokeWidth={1.8} aria-hidden="true" />
                        <span>{isDynamic ? 'Dynamic testing' : 'Review'}</span>
                        <span className="project-activity-separator" aria-hidden="true">·</span>
                        <time dateTime={activity.updatedAt}>{formatActivityTime(activity.updatedAt)}</time>
                      </div>
                    </div>
                  ) : (
                    <div className="project-activity-stack project-activity-empty">
                      <span>No review or dynamic testing activity yet</span>
                    </div>
                  )}
                </td>
                <td data-label="Current state">
                  <span className={`project-state-tag project-state-${state.tone}`}>{state.label}</span>
                </td>
                {showsDirectoryControls && (
                  <td className="project-summary-actions">
                    <button
                      type="button"
                      className="project-summary-open"
                      onClick={() => openSummary(summary, onNavigate)}
                      aria-label={`${actionLabel} for ${summary.project.name}`}
                    >
                      <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        className="project-summary-delete"
                        onClick={() => onDelete(summary)}
                        aria-label={`Remove ${summary.project.name}`}
                      >
                        <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
