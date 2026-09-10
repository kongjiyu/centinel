import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { projectActivityLifecycle, type ProjectActivityLifecycle } from '../reviewViewModel';
import type { Artifact, DynamicSession, Project, StaticSession } from '../types';

export type ActivityTypeFilter = 'all' | 'review' | 'dynamic';
export type ProjectStateFilter = 'all' | 'needs_attention' | 'needs_approval' | 'in_progress' | 'completed' | 'cancelled' | 'no_activity';

export type ProjectActivity = {
  id: string;
  kind: 'review' | 'dynamic';
  session: StaticSession | DynamicSession;
  updatedAt: string;
};

export type ProjectAction = {
  id: string;
  project: Project;
  module: 'Review' | 'Dynamic Testing';
  state: string;
  action: 'Review' | 'Resolve' | 'Inspect' | 'Set up';
  tone: 'warning' | 'danger';
  reason: string;
  updatedAt: string;
  sessionId?: string;
  sessionName?: string;
};

export type ProjectSummary = {
  project: Project;
  staticSessions: StaticSession[];
  dynamicSessions: DynamicSession[];
  artifacts: Artifact[];
  latestActivity: ProjectActivity | null;
  activeCount: number;
  action: ProjectAction | null;
  unavailable: boolean;
};

export type ProjectState = {
  group: Exclude<ProjectStateFilter, 'all'>;
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
};

export function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatActivityTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(parsed);
  const year = parsed.getFullYear();
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hour}:${minute}`;
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'queued': return 'Queued';
    case 'running': return 'In progress';
    case 'success': return 'Completed';
    case 'failure': return 'Failed';
    case 'blocked': return 'Blocked';
    case 'cancelled': return 'Cancelled';
    default: return status ? status.replace(/[_-]+/g, ' ') : 'Unknown';
  }
}

function sessionUpdatedAt(session: { updatedAt: string; createdAt: string }): string {
  return session.updatedAt || session.createdAt;
}

function sortedSessions<T extends { updatedAt: string; createdAt: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => timestamp(sessionUpdatedAt(b)) - timestamp(sessionUpdatedAt(a)));
}

function actionPriority(item: ProjectAction): number {
  if (item.tone === 'danger') return 4;
  if (item.action === 'Resolve' || item.state.includes('blocked')) return 3;
  if (item.action === 'Review') return 2;
  return 1;
}

function getStaticAction(project: Project, sessions: StaticSession[], artifacts: Artifact[], unavailable: boolean): ProjectAction | null {
  const candidates: ProjectAction[] = [];

  sortedSessions(sessions).forEach(session => {
    if (session.status === 'failure' || session.status === 'blocked') {
      candidates.push({
        id: `review-failure:${session.id}`,
        project,
        module: 'Review',
        state: 'Failed',
        action: 'Inspect',
        tone: 'danger',
        reason: session.failureReason || `${session.name} stopped before Centinel could produce a result.`,
        updatedAt: sessionUpdatedAt(session),
        sessionId: session.id,
        sessionName: session.name,
      });
      return;
    }

    if (session.status !== 'success') return;

    if (session.currentDecision?.decision === 'changes_requested') {
      candidates.push({
        id: `review-changes:${session.id}`,
        project,
        module: 'Review',
        state: 'Changes required',
        action: 'Resolve',
        tone: 'warning',
        reason: session.currentDecision.comment || `${session.name} has requested changes that still need a response.`,
        updatedAt: sessionUpdatedAt(session),
        sessionId: session.id,
        sessionName: session.name,
      });
      return;
    }

    if (!session.currentDecision) {
      candidates.push({
        id: `review-decision:${session.id}`,
        project,
        module: 'Review',
        state: 'Review required',
        action: 'Review',
        tone: 'warning',
        reason: `${session.name} finished without a review decision.`,
        updatedAt: sessionUpdatedAt(session),
        sessionId: session.id,
        sessionName: session.name,
      });
    }
  });

  if (candidates.length > 0) {
    return candidates.sort((a, b) => actionPriority(b) - actionPriority(a) || timestamp(b.updatedAt) - timestamp(a.updatedAt))[0];
  }

  if (!unavailable && artifacts.length === 0 && sessions.length === 0) {
    return {
      id: `review-setup:${project.id}`,
      project,
      module: 'Review',
      state: 'Setup required',
      action: 'Set up',
      tone: 'warning',
      reason: 'No sources have been added, so Centinel cannot start the first review.',
      updatedAt: project.updatedAt || project.createdAt,
    };
  }

  return null;
}

function getDynamicAction(project: Project, sessions: DynamicSession[], unavailable: boolean): ProjectAction | null {
  if (unavailable && sessions.length === 0) return null;
  const session = sortedSessions(sessions).find(item => item.status === 'failure' || item.status === 'blocked');
  if (!session || (session.status !== 'failure' && session.status !== 'blocked')) return null;

  return {
    id: `dynamic:${session.id}`,
    project,
    module: 'Dynamic Testing',
    state: 'Failed',
    action: 'Inspect',
    tone: session.status === 'blocked' ? 'warning' : 'danger',
    reason: session.failureReason || `${session.name} ended before its test goal could be verified.`,
    updatedAt: sessionUpdatedAt(session),
    sessionId: session.id,
    sessionName: session.name,
  };
}

function buildSummary(
  project: Project,
  staticSessions: StaticSession[],
  dynamicSessions: DynamicSession[],
  artifacts: Artifact[],
  unavailable: boolean,
): ProjectSummary {
  const activities: ProjectActivity[] = [
    ...staticSessions.map(session => ({
      id: `review:${session.id}`,
      kind: 'review' as const,
      session,
      updatedAt: sessionUpdatedAt(session),
    })),
    ...dynamicSessions.map(session => ({
      id: `dynamic:${session.id}`,
      kind: 'dynamic' as const,
      session,
      updatedAt: sessionUpdatedAt(session),
    })),
  ].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  const actions = [
    getStaticAction(project, staticSessions, artifacts, unavailable),
    getDynamicAction(project, dynamicSessions, unavailable),
  ].filter((item): item is ProjectAction => Boolean(item));

  return {
    project,
    staticSessions,
    dynamicSessions,
    artifacts,
    latestActivity: activities[0] ?? null,
    activeCount: [...staticSessions, ...dynamicSessions].filter(session => session.status === 'queued' || session.status === 'running').length,
    action: actions.sort((a, b) => actionPriority(b) - actionPriority(a) || timestamp(b.updatedAt) - timestamp(a.updatedAt))[0] ?? null,
    unavailable,
  };
}

export function getProjectState(summary: ProjectSummary): ProjectState {
  if (summary.action) {
    if (summary.action.id.startsWith('review-decision:') || summary.action.id.startsWith('review-changes:')) {
      return { group: 'needs_approval', label: 'Need Approval', tone: 'warning' };
    }
    return {
      group: 'needs_attention',
      label: summary.action.state,
      tone: summary.action.tone,
    };
  }
  if (summary.activeCount > 0) {
    return { group: 'in_progress', label: 'In progress', tone: 'info' };
  }
  if (!summary.latestActivity) {
    return { group: 'no_activity', label: 'No activity', tone: 'neutral' };
  }
  const lifecycle = projectActivityLifecycle(
    summary.latestActivity.session,
    summary.latestActivity.kind,
  ) as ProjectActivityLifecycle;
  if (lifecycle === 'Need Approval') {
    return { group: 'needs_approval', label: lifecycle, tone: 'warning' };
  }
  if (lifecycle === 'In progress' || lifecycle === 'Queued') {
    return { group: 'in_progress', label: lifecycle, tone: 'info' };
  }
  if (lifecycle === 'Completed') return { group: 'completed', label: lifecycle, tone: 'success' };
  if (lifecycle === 'Cancelled') return { group: 'cancelled', label: lifecycle, tone: 'neutral' };
  return { group: 'needs_attention', label: lifecycle, tone: 'danger' };
}

export function sortProjectSummaries(summaries: ProjectSummary[]): ProjectSummary[] {
  return [...summaries].sort((a, b) => {
    const aDate = a.latestActivity?.updatedAt || a.project.updatedAt || a.project.createdAt;
    const bDate = b.latestActivity?.updatedAt || b.project.updatedAt || b.project.createdAt;
    return timestamp(bDate) - timestamp(aDate);
  });
}

export function matchesActivityFilter(summary: ProjectSummary, filter: ActivityTypeFilter): boolean {
  return filter === 'all' || summary.latestActivity?.kind === filter;
}

export function matchesStateFilter(summary: ProjectSummary, filter: ProjectStateFilter): boolean {
  return filter === 'all' || getProjectState(summary).group === filter;
}

export function matchesProjectSearch(summary: ProjectSummary, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const activity = summary.latestActivity;
  return [
    summary.project.name,
    summary.project.description,
    activity?.session.name,
    activity?.kind === 'dynamic' ? 'Dynamic Testing' : activity ? 'Review' : '',
  ].some(value => value?.toLocaleLowerCase().includes(normalized));
}

export function useProjectSummaries(projects: Project[]) {
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    if (projects.length === 0) {
      setSummaries([]);
      setUnavailable(false);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    void Promise.all(projects.map(async project => {
      const [staticResult, dynamicResult, artifactsResult] = await Promise.allSettled([
        api.listStaticSessions(project.id),
        api.listDynamicSessions(project.id),
        api.listArtifacts(project.id),
      ]);
      const projectUnavailable = [staticResult, dynamicResult, artifactsResult].some(result => result.status === 'rejected');
      return buildSummary(
        project,
        staticResult.status === 'fulfilled' ? staticResult.value : [],
        dynamicResult.status === 'fulfilled' ? dynamicResult.value : [],
        artifactsResult.status === 'fulfilled' ? artifactsResult.value : [],
        projectUnavailable,
      );
    })).then(results => {
      if (cancelled) return;
      setSummaries(sortProjectSummaries(results));
      setUnavailable(results.some(result => result.unavailable));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [projects, reloadKey]);

  return { summaries, loading, unavailable, reload };
}
