export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type CollaborationStatus = {
  available: boolean;
  repository: { owner: string; repo: string; remoteUrl: string } | null;
  reason?: 'missing_remote' | 'missing_token' | 'unsupported_remote' | 'project_not_found';
  message?: string;
};

export type CollaboratorMatch = {
  id: number;
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  type: string;
};

export type CollaboratorSearchResult = {
  email: string;
  repository: { owner: string; repo: string; remoteUrl: string };
  matches: CollaboratorMatch[];
};

export type GithubProjectCollaborator = CollaboratorMatch & {
  permission: string;
};

export type GithubCollaboratorSnapshot = {
  repository: { owner: string; repo: string; remoteUrl: string } | null;
  collaborators: GithubProjectCollaborator[];
  syncedAt: string | null;
};

export type CollaboratorInviteResult = {
  username: string;
  repository: { owner: string; repo: string; remoteUrl: string };
  status: 'invited' | 'already_collaborator';
};

export type IntegrationProvider = 'github' | 'google_drive' | 'slack';

export type ConnectedSourceStatus = 'active' | 'removed' | 'inaccessible' | 'disconnected';
export type ConnectedSourceSyncStatus = 'idle' | 'syncing' | 'ready' | 'error';

export type ConnectedSource = {
  id: string;
  projectId: string;
  integrationId: string;
  provider: IntegrationProvider;
  kind: 'github_repository' | 'google_drive' | 'slack_channel';
  remoteId: string;
  remoteUrl: string | null;
  name: string;
  selectedScope: Record<string, unknown>;
  remoteRevision: string | null;
  syncCursor: Record<string, unknown> | null;
  status: ConnectedSourceStatus;
  syncStatus: ConnectedSourceSyncStatus;
  lastSyncedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectedSourceStatusResult = {
  provider: IntegrationProvider;
  connected: boolean;
  accountLabel: string | null;
  accountId: string | null;
  scopes: string[];
  expiresAt: string | null;
  status: string;
  reauthorizationRequired: boolean;
  missingScopes: string[];
  sources: ConnectedSource[];
};

export type ConnectedSourceBrowseEntry = {
  id: string;
  name: string;
  kind: 'repository' | 'branch' | 'folder' | 'file' | 'workspace' | 'channel';
  mimeType?: string | null;
  remoteUrl?: string | null;
  revision?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConnectedSourceBrowsePage = {
  items: ConnectedSourceBrowseEntry[];
  nextCursor: string | null;
};

export type ConnectedSourceSyncRun = {
  id: string;
  projectId: string;
  sourceId: string;
  status: 'queued' | 'running' | 'partial' | 'success' | 'failure' | 'cancelled';
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  removedCount: number;
  inaccessibleCount: number;
  errorMessage: string | null;
  retryable: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type ConnectedSourceSyncResult = {
  source: ConnectedSource;
  run: ConnectedSourceSyncRun;
  complete: boolean;
  imported: number;
  updated: number;
  unchanged: number;
  removed: number;
  inaccessible: number;
};

export type AiProvider = 'mimo' | 'gemini' | 'custom' | 'codex';
export type AiApiFormat = 'openai-compatible' | 'anthropic-compatible' | 'google-native' | 'codex-app-server';

export type AiProviderSetting = {
  id: 'text' | 'vision' | 'embedding';
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  fallbackEnabled?: boolean;
  fallbackProvider?: AiProvider | null;
  fallbackApiFormat?: AiApiFormat | null;
  fallbackHasApiKey?: boolean;
  fallbackApiKeyPreview?: string;
  fallbackBaseUrl?: string;
  fallbackModel?: string;
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
export type ArtifactSource = 'documents' | 'repository' | 'directory' | 'drive';

export type Artifact = {
  id: string;
  projectId: string;
  versionId?: string;
  type: ArtifactType;
  source: ArtifactSource;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
};

export type StaticSessionStatus = 'prepared' | 'queued' | 'running' | 'success' | 'failure' | 'blocked' | 'cancelled' | 'pending_approval';

/**
 * The immutable input selection sent when a Review starts.  The service may
 * add resolved source/version metadata after creation; the renderer only
 * sends stable project-owned identifiers and never treats a display label as
 * evidence of what was reviewed.
 */
export type ReviewScopeSelection = {
  artifactIds: string[];
  requirementIds: string[];
  standardIds: string[];
  baseRef?: string;
  headRef?: string;
  pullRequest?: string;
};

/** Per-review model usage. Token counts are provider-reported values only. */
export type ReviewModelUsage = {
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    calls: number;
  };
  byGroup: Array<{
    provider: AiProvider;
    apiFormat: AiApiFormat;
    model: string;
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalCalls: number;
  }>;
  recent: Array<{
    id: string;
    projectId: string | null;
    sessionId: string | null;
    scope: 'text' | 'vision' | 'embedding';
    callKind: 'review' | 'test' | 'dynamic';
    stage: string | null;
    roundNumber: number | null;
    provider: AiProvider;
    apiFormat: AiApiFormat;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    createdAt: string;
  }>;
};

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
  /** P1-5: parent session id if this is a re-review. Empty otherwise. */
  parentSessionId: string;
  /** P1-5: cached diff against the parent; empty until computed. */
  reviewDiffJson: string;
  /**
   * Latest review decision (P0-3). Embedded by GET /static-sessions/:id
   * so the dashboard can show the verdict pill on the session row
   * without a second round-trip. null when the team has never recorded
   * a decision on this session.
   */
  currentDecision?: ReviewDecisionRecord | null;
  /** Structured scope returned by newer review services. */
  scope?: ReviewScopeSelection | null;
  /** Optional embedded usage summary; the renderer also supports the usage endpoint. */
  modelUsage?: ReviewModelUsage | null;
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
  attachments?: ReviewDecisionAttachment[];
  /** Present when Request Changes successfully prepared the child Review. */
  preparedChild?: StaticSession;
  sourceChoice?: 'reuse' | 'refresh';
};

export type EvidenceGap = {
  id: string;
  code: string;
  severity: 'warning' | 'blocking';
  title: string;
  detail: string;
  remediation: string;
  affectedStages: string[];
  artifactId?: string;
};

export type EvidenceContradiction = {
  id: string;
  left: { id: string; text: string; artifactId?: string; locator?: { filePath: string; lineStart?: number; section?: string } };
  right: { id: string; text: string; artifactId?: string; locator?: { filePath: string; lineStart?: number; section?: string } };
  detail: string;
  affectedStages: string[];
  disposition?: EvidenceContradictionDisposition;
};

export type EvidenceContradictionDisposition = {
  contradictionId: string;
  decision: 'authoritative_left' | 'authoritative_right' | 'not_conflict';
  rationale: string;
  actorId: string;
  updatedAt: string;
};

export type EvidenceSufficiencyAssessment = {
  id: string;
  reviewId: string;
  projectId: string;
  reviewType: string;
  readiness: 'ready' | 'ready_with_warnings' | 'blocked';
  gaps: EvidenceGap[];
  contradictions: EvidenceContradiction[];
  artifactCount: number;
  availableArtifactCount: number;
  staleArtifactCount: number;
  confirmedRequirementCount: number;
  enabledStandardRuleCount: number;
  assessedAt: string;
};

export type FindingCorrelationClass = 'new' | 'recurring' | 'carried_over' | 'resolved' | 'regressed';

export type FindingCorrelationSnapshot = {
  parentReviewId: string;
  childReviewId: string;
  correlations: Array<{
    id: string;
    parentFindingId: string | null;
    childFindingId: string | null;
    classification: FindingCorrelationClass;
    method: 'stable_id' | 'fingerprint' | 'heuristic' | 'unmatched';
    score: number;
    stableFingerprint: string;
    detail?: string;
  }>;
  ambiguities: Array<{
    childFindingId: string;
    candidateParentFindingIds: string[];
    scores: number[];
    reason: 'close_candidates' | 'critical_requires_confirmation' | 'candidate_already_matched';
  }>;
  counts: Record<FindingCorrelationClass, number>;
  createdAt: string;
};

export type ReviewDecisionAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
};

/** Payload accepted when adding a supportive document to review feedback. */
export type ReviewDecisionAttachmentInput = {
  fileName: string;
  mimeType: string;
  content: string;
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  /** Optional independent remediation priority when supplied by the service. */
  priority?: string | null;
  /** Server-derived Risk Level from the shared Severity + Priority policy. */
  riskLevel?: string | null;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed' | 'carryover';
  createdAt: string;
  /** Optional service-provided modification time. Older responses only expose createdAt. */
  updatedAt?: string;
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
  | 'summarizing'
  | 'risk_assessment'
  | 'awaiting_approval';

export type ReviewStageProgress = {
  id: ReviewStageId;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  thoughts: string[];
  summary?: string;
};

export type ReviewProgress = {
  currentStage: ReviewStageId;
  stages: ReviewStageProgress[];
  startedAt: string;
  updatedAt: string;
};

export type ReviewSourceKind = 'repository' | 'directory' | 'document' | 'drive';

export type ReviewSourceManifestItem = {
  id: string;
  sessionId: string;
  sourceId: string;
  sourceKind: ReviewSourceKind;
  label: string;
  artifactIds: string[];
  filesReviewed: number;
  contentHashes: string[];
  capturedAt: string;
};

export type ReviewSourceManifest = {
  sessionId: string;
  projectId: string;
  status: 'available' | 'unavailable' | 'incomplete';
  capturedAt?: string;
  updatedAt?: string;
  sources: ReviewSourceManifestItem[];
  artifactCount: number | null;
};

export type TraceabilityState = 'complete' | 'incomplete' | 'missing';

export type ReviewTraceabilityRecord = {
  requirementId: string;
  title: string;
  description: string;
  category: string;
  state: TraceabilityState;
  mappingIds: string[];
  sourceArtifactIds: string[];
  sourceSymbolIds?: string[];
  confidence: number | null;
  capturedAt: string;
};

export type TraceabilitySummary = {
  complete: number;
  incomplete: number;
  missing: number;
  attention: number;
};

export type ReviewTraceabilitySnapshot = {
  sessionId: string;
  projectId: string;
  status: 'available' | 'unavailable';
  records: ReviewTraceabilityRecord[];
  summary: TraceabilitySummary | null;
  capturedAt?: string;
  updatedAt?: string;
};

export type ProjectAssessment = {
  projectId: string;
  status: 'available' | 'unavailable';
  policyVersion?: string;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    classified: number;
    unclassified: number;
  } | null;
  riskItems: Array<Finding & { riskLevel: string }>;
  traceability: {
    status: 'available' | 'unavailable';
    reviewId: string | null;
    summary: TraceabilitySummary | null;
  };
};

export type Screen =
  | { name: 'dashboard' }
  | {
      name: 'projects';
      search?: string;
      stateFilter?: 'all' | 'needs_attention' | 'needs_approval' | 'in_progress' | 'completed' | 'cancelled' | 'no_activity';
      activityFilter?: 'all' | 'review' | 'dynamic';
      /** Open the directory's existing project-creation modal on entry. */
      initialCreate?: boolean;
    }
  | {
      name: 'project-detail';
      projectId: string;
      initialAction?: 'static' | 'dynamic';
      initialStaticSessionId?: string;
    }
  | { name: 'review-entry'; projectId?: string }
  | { name: 'review-activity'; projectId: string; sessionId: string; reviewName?: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'evidence-browser'; projectId: string }
  | { name: 'requirements'; projectId: string }
  | { name: 'settings' }
  | { name: 'profile' };

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

export type SourceLocator = {
  artifactId: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  page?: number;
  section?: string;
  excerpt?: string;
};

export type RequirementCandidate = {
  id: string;
  projectId: string;
  kind: 'requirement' | 'acceptance_criterion';
  title: string;
  statement: string;
  sourceLocator: SourceLocator;
  sourceVersion: string;
  confidence: number;
  fingerprint: string;
  status: 'pending_confirmation' | 'confirmed' | 'rejected';
  confirmedRequirementId: string | null;
  confirmedBy: string | null;
  rejectedBy?: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StandardRule = {
  id: string;
  projectId: string;
  standardId: string;
  stableKey: string;
  title: string;
  statement: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  recommendation: string;
  sourceArtifactId: string;
  sourceLocator: SourceLocator;
  sourceVersion: string;
  standardVersion: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
