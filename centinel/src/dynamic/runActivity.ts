import { api } from '../api/client';
import type { DynamicSession, DynamicSessionStatus, Screen } from '../types';
import type { DynamicRun } from './types';

/**
 * Project-level status for a shared Run. It follows the Run's own state and
 * independent verdict so Home, Projects and Project Overview agree with the
 * Dynamic Testing result view.
 */
export function runActivityStatus(run: Pick<DynamicRun, 'state' | 'verdict'>): DynamicSessionStatus {
  switch (run.state) {
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'cancelled': return 'cancelled';
    case 'completed':
      if (run.verdict === 'passed') return 'success';
      if (run.verdict === 'failed') return 'failure';
      return 'blocked';
    default:
      // Blocked and interrupted Runs need a person to inspect them.
      return 'blocked';
  }
}

export function runToActivitySession(run: DynamicRun): DynamicSession {
  return {
    id: run.id,
    runId: run.id,
    missionId: run.missionId,
    projectId: run.projectId,
    type: 'dynamic',
    name: run.revision.name,
    status: runActivityStatus(run),
    targetUrl: run.environment?.targetUrl ?? run.revision.targetUrl,
    goal: run.revision.goal,
    missionType: 'user_journey',
    browserMode: 'headed',
    maxSteps: run.revision.maxSteps,
    finalSummary: '',
    failureReason: run.reason ?? '',
    createdAt: run.createdAt,
    updatedAt: run.updatedAt || run.createdAt,
  };
}

/**
 * Shared Runs are authoritative. Device-local legacy sessions remain visible
 * only when no Run already represents them.
 */
export function mergeDynamicActivity(runs: DynamicRun[], legacySessions: DynamicSession[]): DynamicSession[] {
  const mirrored = new Set(runs.map(run => run.legacySessionId).filter((id): id is string => Boolean(id)));
  return [
    ...runs.map(runToActivitySession),
    ...legacySessions.filter(session => !mirrored.has(session.id)),
  ];
}

/** A later Run of the same saved test supersedes earlier outcomes. */
export function latestPerSavedTest(sessions: DynamicSession[]): DynamicSession[] {
  const latest = new Map<string, DynamicSession>();
  const standalone: DynamicSession[] = [];
  for (const session of sessions) {
    if (!session.missionId) { standalone.push(session); continue; }
    const current = latest.get(session.missionId);
    const time = Date.parse(session.updatedAt || session.createdAt) || 0;
    const currentTime = current ? Date.parse(current.updatedAt || current.createdAt) || 0 : -1;
    if (time > currentTime) latest.set(session.missionId, session);
  }
  return [...latest.values(), ...standalone];
}

export async function loadDynamicActivity(projectId: string): Promise<{ sessions: DynamicSession[]; unavailable: boolean }> {
  const [legacyResult, runsResult] = await Promise.allSettled([
    api.listDynamicSessions(projectId),
    typeof api.dynamicRuns === 'function' ? api.dynamicRuns(projectId) : Promise.resolve([] as DynamicRun[]),
  ]);
  return {
    sessions: mergeDynamicActivity(
      runsResult.status === 'fulfilled' ? runsResult.value : [],
      legacyResult.status === 'fulfilled' ? legacyResult.value : [],
    ),
    unavailable: legacyResult.status === 'rejected' || runsResult.status === 'rejected',
  };
}

export function dynamicActivityScreen(projectId: string, session: Pick<DynamicSession, 'id' | 'runId'>): Screen {
  return session.runId
    ? { name: 'dynamic-testing', projectId, runId: session.runId }
    : { name: 'dynamic-session', projectId, sessionId: session.id };
}
