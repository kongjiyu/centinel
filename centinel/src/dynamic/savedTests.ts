import type { DynamicRun, Mission, MissionRevision } from './types';

export type RunOutcomeFilter = 'all' | 'passed' | 'failed' | 'blocked' | 'uncertain' | 'running';
export const RUN_OUTCOME_FILTERS: Array<{ value: RunOutcomeFilter; label: string }> = [
  { value: 'all', label: 'All results' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Needs attention' },
  { value: 'uncertain', label: 'Uncertain' },
  { value: 'running', label: 'Queued or running' },
];
export const RUN_HISTORY_PAGE_SIZE = 20;

/** Groups Runs the same way the history labels them: only completed Runs carry a pass/fail verdict. */
export function runMatchesOutcome(run: DynamicRun, filter: RunOutcomeFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'running':
      return run.state === 'queued' || run.state === 'running';
    case 'blocked':
      return run.state === 'blocked' || run.state === 'interrupted';
    default:
      return run.state === 'completed' && run.verdict === filter;
  }
}

export function filterRuns(runs: DynamicRun[], outcome: RunOutcomeFilter, missionId: string): DynamicRun[] {
  return runs.filter((run) => runMatchesOutcome(run, outcome) && (missionId === 'all' || run.missionId === missionId));
}

/** A rename changes only the saved test's display name; otherwise the current revision name applies. */
export function savedTestName(mission: Mission | undefined, revision: MissionRevision | undefined): string {
  return mission?.displayName ?? revision?.name ?? 'Saved test';
}

export type SavedTestEntry = { mission: Mission; revision: MissionRevision };

/** Pairs each saved test with its current revision; tests whose revision has not loaded are omitted. */
export function savedTestEntries(missions: Mission[], revisions: MissionRevision[]): SavedTestEntry[] {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  return missions.flatMap((mission) => {
    const revision = byId.get(mission.currentRevisionId);
    return revision ? [{ mission, revision }] : [];
  });
}
