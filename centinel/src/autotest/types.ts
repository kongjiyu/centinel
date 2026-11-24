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
  controls?: Array<{ selector: string; actions: string[] }>;
  /** Fixed full-check tests (18 Nov 2026). Absent for tests the AI wrote. */
  kind?: AutoTestKind;
  smoke?: { pages: Array<{ path: string; status: number | null; ok: boolean; problem: string | null }> };
  /** untried: distinct allowed controls not pressed; outOfScope: distinct controls exploration may not press. */
  exploration?: { screens: number; actions: number; untried: number; truncated: boolean; outOfScope?: number; seen?: number };
  unit?: UnitTestSummary;
  firstAttempt?: FirstAttempt;
  usability?: { sampled: number; failures: Array<{ rule: string; expected: string; observed: string; count: number }>; uncertain: number; limitations: string[] };
};
export type AutoTestKind = 'smoke' | 'exploratory' | 'usability' | 'unit';
export const TEST_KIND_LABEL: Record<AutoTestKind, string> = { smoke: 'Smoke', exploratory: 'Exploratory', usability: 'Usability', unit: 'Unit tests' };
/** Mirrors sidecar/src/dynamic/autonomous/unitTests.ts UnitSummary. */
export type UnitTestSummary = {
  outcome: string; script: string | null; framework: string | null;
  counts: { total: number; passed: number; failed: number; skipped: number } | null;
  failures: Array<{ file: string; name: string; message: string }>; reason: string;
  /** False when the project has no unit tests at all. */
  present?: boolean;
};
/** The first attempt of a test that was run again after it could not run. */
export type FirstAttempt = { runId: string | null; reason: string | null; state?: AutoTestState };
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
  /** Project conversation (13 Nov 2026). */
  request?: { text: string; base: AutoTestPreset | null; history: string[] } | null;
  reply?: string | null;
  presets?: AutoTestPreset[];
  planning?: boolean;
  startupQuestion?: { id: string; command: string; packages: string[]; packageCount: number; manualSetup?: string };
  suite?: { smoke: boolean; exploratory: boolean; usability: boolean; unit?: boolean };
};

export type AutoTestPreset = { name: string; goal: string; startPath: string; requirementRef: string | null; sourceRefs: Array<{ path: string; line: number }>; checks: AutoTestCheck[]; controls: Array<{ selector: string; actions: string[] }> };
export type AutoTestRef = { sessionId: string; testId: string };

export type LiveBox = { x: number; y: number; width: number; height: number };
export type LiveActionEvent = {
  laneId: string; step: number; action: string; targetLabel: string; box: LiveBox | null;
  viewport: { width: number; height: number }; phase: 'move' | 'press' | 'type' | 'done'; textLength?: number; masked?: boolean;
};
export type LiveFrameEvent = { laneId: string; seq: number; capturedAt: string; viewport: { width: number; height: number }; mimeType: string; data: string };

export const ACTIVE_STAGES: AutoTestStage[] = ['reading', 'starting', 'exploring', 'planning', 'testing', 'summarizing'];
export const isActive = (session: AutoTestSession | null | undefined) => !!session && ACTIVE_STAGES.includes(session.stage);

/** Mirrors sidecar/src/dynamic/runSteps.ts RunTimeline. */
export type RunStep = { step: number; action: string; target: string | null; page: string | null; result: 'success' | 'failure' | 'blocked'; error: string | null; typedLength: number | null; screenshot: boolean };
export type RunTimeline = { runId: string; state: string; verdict: string; reason: string | null; steps: RunStep[]; truncated: boolean; finalScreenshot?: boolean };
