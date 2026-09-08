import { ChevronRight, FileCheck2, MonitorPlay, Trash2 } from 'lucide-react';
import {
  formatActivityTime,
  getProjectState,
  type ProjectSummary,
} from '../hooks/useProjectSummaries';
import type { Screen } from '../types';
import './ProjectSummaryTable.css';

type Props = {
  summaries: ProjectSummary[];
  onNavigate: (screen: Screen) => void;
  onDelete?: (summary: ProjectSummary) => void;
  showWorkspacePath?: boolean;
  showDescription?: boolean;
  ariaLabel: string;
};

function openSummary(summary: ProjectSummary, onNavigate: Props['onNavigate']) {
  const activity = summary.latestActivity;
  if (!activity) {
    onNavigate({ name: 'project-detail', projectId: summary.project.id });
  } else if (activity.kind === 'dynamic') {
    onNavigate({ name: 'dynamic-session', projectId: summary.project.id, sessionId: activity.session.id });
  } else {
    onNavigate({ name: 'review-activity', projectId: summary.project.id, sessionId: activity.session.id });
  }
}

export function ProjectSummaryTable({
  summaries,
  onNavigate,
  onDelete,
  showWorkspacePath = false,
  showDescription = false,
  ariaLabel,
}: Props) {
  return (
    <div className="project-summary-table-shell">
      <table className="project-summary-table" aria-label={ariaLabel}>
        <colgroup>
          <col className="project-summary-col-project" />
          <col className="project-summary-col-activity" />
          <col className="project-summary-col-state" />
          <col className="project-summary-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Latest activity</th>
            <th scope="col">Current state</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
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
                      <div className="project-activity-meta">
                        <ActivityIcon size={14} strokeWidth={1.8} aria-hidden="true" />
                        {isDynamic ? 'Dynamic Testing' : 'Review'}
                      </div>
                      <strong>{activity.session.name}</strong>
                      <time dateTime={activity.updatedAt}>{formatActivityTime(activity.updatedAt)}</time>
                    </div>
                  ) : (
                    <div className="project-activity-stack project-activity-empty">
                      <span>No Review or Dynamic Testing activity yet</span>
                    </div>
                  )}
                </td>
                <td data-label="Current state">
                  <span className={`project-state-tag project-state-${state.tone}`}>{state.label}</span>
                </td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
