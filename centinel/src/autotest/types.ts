/** Mirrors sidecar/src/dynamic/autonomous/orchestrator.ts AutoTestSession (schemaVersion 1). */
export type AutoTestStage = 'reading' | 'starting' | 'exploring' | 'planning' | 'testing' | 'summarizing' | 'completed' | 'failed' | 'cancelled';
export type AutoTestState = 'queued' | 'running' | 'passed' | 'failed' | 'uncertain' | 'blocked' | 'not_tested' | 'cancelled';

export type AutoTestCheck = { id: string; criterionId: string; description: string; required: boolean; kind: string; expected?: unknown; selector?: string };
export type AutoTestCheckResult = { checkId: string; criterionId: string; verdict: 'passed' | 'failed' | 'uncertain' | 'not_tested'; observed: string | null; reason: string; evidenceIds: string[] };

export type AutoTestEntry = {
  id: string; name: string; goal: string; rationale: string; requirementRef: string | null;
  sourceRefs: Array<{ path: string; line: number }>; checks: AutoTestCheck[]; startPath: string;
  state: AutoTestState; laneId?: string; missionId?: string; revisionId?: string; runId?: string;
  reason?: string | null; checkResults?: AutoTestCheckResult[]; explanation?: string | null; startedAt?: string; finishedAt?: string;
};
export type AutoTestLane = { id: string; url: string | null; environmentId: string | null; state: 'starting' | 'idle' | 'running' | 'stopped' | 'failed'; currentTestId: string | null };

export type AutoTestSession = {
  schemaVersion: 1; id: string; projectId: string; ownerId: string; folder: string;
  createdAt: string; updatedAt: string; stage: AutoTestStage;
  error: { reason: string; message: string; log?: string } | null;
  repository: { fingerprint: string; files: number; routes: number; forms: number; requirements: boolean; truncated: boolean; persistence: string[] } | null;
  launch: { recipeId: string; label: string; framework: string; url: string | null; portHonored: boolean | null; installing: boolean; log: string } | null;
  exploration: { pages: Array<{ path: string; controls: number }>; controls: number } | null;
  lanes: AutoTestLane[]; laneLimit: number; laneNote: string | null;
  tests: AutoTestEntry[]; dropped: Array<{ name: string; reason: string }>;
  summary: { passed: number; failed: number; uncertain: number; blocked: number; notTested: number; limitations: string[] } | null;
};

export type LiveBox = { x: number; y: number; width: number; height: number };
export type LiveActionEvent = {
  laneId: string; step: number; action: string; targetLabel: string; box: LiveBox | null;
  viewport: { width: number; height: number }; phase: 'move' | 'press' | 'type' | 'done'; textLength?: number; masked?: boolean;
};
export type LiveFrameEvent = { laneId: string; seq: number; capturedAt: string; viewport: { width: number; height: number }; mimeType: string; data: string };

export const ACTIVE_STAGES: AutoTestStage[] = ['reading', 'starting', 'exploring', 'planning', 'testing', 'summarizing'];
export const isActive = (session: AutoTestSession | null | undefined) => !!session && ACTIVE_STAGES.includes(session.stage);
