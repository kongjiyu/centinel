export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type AiProvider = 'mimo' | 'gemini' | 'custom';
export type AiApiFormat = 'openai-compatible' | 'anthropic-compatible' | 'google-native';

export type AiProviderSetting = {
  id: 'text' | 'vision';
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  updatedAt: string;
};

export type AiProviderPreset = {
  id: string;
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  baseUrl: string;
  model: string;
};

export type AiTestResult = {
  status: string;
  message?: string;
  raw?: string;
  hint?: string;
};

export type DynamicSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'blocked' | 'cancelled';

export type DynamicSession = {
  id: string;
  projectId: string;
  type: 'dynamic';
  name: string;
  status: DynamicSessionStatus;
  targetUrl: string;
  goal: string;
  missionType: 'user_journey' | 'smoke';
  browserMode: 'headed';
  maxSteps: number;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

export type DynamicEvidence = {
  id: string;
  type: 'screenshot' | 'action_trace' | 'ai_request' | 'ai_response' | 'console_log' | 'debug_log' | 'session_summary';
  filePath: string;
  summary: string;
  createdAt: string;
};

export type ArtifactType = 'requirement' | 'design' | 'source_code' | 'coding_standard' | 'other';
export type ArtifactSource = 'documents' | 'repository' | 'drive';

export type Artifact = {
  id: string;
  projectId: string;
  type: ArtifactType;
  source: ArtifactSource;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
};

export type StaticSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled';

export type ReviewType = 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency';

export type StaticSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  configJson: string;
  progressJson: string;
  remarks: string;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
  /** P0-4: base git ref (e.g. 'main', 'origin/main'). Empty = no scope. */
  baseRef: string;
  /** P0-4: head git ref. Empty = no scope. */
  headRef: string;
  /**
   * P0-4: JSON-encoded array of file paths changed between base and
   * head. Parsed with JSON.parse on the client when needed.
   */
  changedFilesJson: string;
  /**
   * Latest review decision (P0-3). Embedded by GET /static-sessions/:id
   * so the dashboard can show the verdict pill on the session row
   * without a second round-trip. null when the team has never recorded
   * a decision on this session.
   */
  currentDecision?: ReviewDecisionRecord | null;
};

/**
 * Session-level review decision (P0-3). Distinct from per-finding
 * `status`; this is the team's verdict on the review as a whole.
 *   - approved: sign-off, the report can ship
 *   - changes_requested: blocking, unresolved issues remain
 *   - commented: non-blocking note, no verdict yet
 */
export type ReviewDecision = 'approved' | 'changes_requested' | 'commented';

export type ReviewDecisionRecord = {
  id: string;
  sessionId: string;
  projectId: string;
  decision: ReviewDecision;
  comment: string;
  reviewer: string;
  createdAt: string;
};

/**
 * Test plan item (Group 2c). A single executable test derived from a
 * static-review finding (rationale = the finding id) or generated as
 * a smoke test for an unfinded module (rationale = 'smoke').
 */
export type TestItemKind = 'unit' | 'integration' | 'e2e' | 'smoke';
export type TestItemStatus = 'proposed' | 'accepted' | 'rejected' | 'in_progress' | 'passed' | 'failed';

export type TestItem = {
  id: string;
  sessionId: string;
  projectId: string;
  module: string;
  component: string | null;
  filePath: string;
  lineNumber: number | null;
  title: string;
  description: string;
  /** The finding id that drove this item, or 'smoke' / 'coverage_gap'. */
  rationale: string | null;
  kind: TestItemKind;
  severity: string;
  status: TestItemStatus;
  createdAt: string;
  updatedAt: string;
};

export type TestItemRollup = {
  module: string;
  total: number;
  proposed: number;
  accepted: number;
  rejected: number;
  inProgress: number;
  passed: number;
  failed: number;
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed';
  createdAt: string;
  artifactId: string | null;
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  fromRemarks: boolean;
  filePath: string;
  lineNumber: number | null;
};

export type ReviewStageId =
  | 'understanding_context'
  | 'code_review'
  | 'requirement_validation'
  | 'summarizing';

export type ReviewStageProgress = {
  id: ReviewStageId;
  label: string;
  status: 'pending' | 'active' | 'done';
  thoughts: string[];
  summary?: string;
};

export type ReviewProgress = {
  currentStage: ReviewStageId;
  stages: ReviewStageProgress[];
  startedAt: string;
  updatedAt: string;
};

export type ReviewArtifact = {
  id: string;
  sessionId: string;
  projectId: string;
  title: string;
  content: string;
  artifactType: string;
  createdAt: string;
};

export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'evidence-browser'; projectId: string }
  | { name: 'requirements'; projectId: string }
  | { name: 'settings' };

export type Requirement = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  createdAt: string;
};

export type RequirementMapping = {
  id: string;
  requirementId: string;
  fileId: string | null;
  symbolId: string | null;
  coverageStatus: string;
  confidence: number;
};
