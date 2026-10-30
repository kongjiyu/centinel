export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

/** A Centinel account with access to a project. Owners manage membership. */
export type ProjectMember = { userId: string; email: string; role: 'owner' | 'member' | 'viewer'; addedAt: string };
export type ProjectMemberList = { viewerUserId: string; members: ProjectMember[] };

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
  latestSyncRun?: ConnectedSourceSyncRun | null;
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
  attemptCount?: number;
  errorCode?: string | null;
  errorMessage: string | null;
  retryable: boolean;
  retryService?: string | null;
  retryOperation?: string | null;
  retryAttempt?: number | null;
  retryLimit?: number | null;
  retryDelayMs?: number | null;
  nextAttemptAt?: string | null;
  leaseExpiresAt?: string | null;
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
  /** Embedding-only protocol; existing custom configurations remain valid. */
  embeddingProvider?: 'voyage' | 'custom';
  embeddingDimensions?: number;
  fallbackEnabled?: boolean;
  fallbackProvider?: AiProvider | null;
  fallbackApiFormat?: AiApiFormat | null;
  fallbackHasApiKey?: boolean;
  fallbackApiKeyPreview?: string;
  fallbackBaseUrl?: string;
  fallbackModel?: string;
  updatedAt: string;
};

export type { EmbeddingSettingsCatalog, EmbeddingModelOption, EmbeddingModelUsage, EmbeddingProviderId } from '../../sidecar/src/embeddingSettingsTypes';

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
  /** Set when this activity is a shared Mission/Run rather than a local legacy session. */
  runId?: string;
  missionId?: string;
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
  sourceId?: string | null;
  versionId?: string;
  type: ArtifactType;
  source: ArtifactSource;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
  /** Latest recorded content/metadata change, when the store provides one. */
  updatedAt?: string;
  /** Source currency governance (DESIGN.md: 90-day confirmation; deprecated sources leave new Reviews). */
  currency?: SourceCurrency;
};

export type SourceCurrency = {
  confirmedAt: string | null;
  confirmedBy: string | null;
  deprecated: boolean;
  deprecatedAt: string | null;
  deprecatedBy: string | null;
};

/** Pre-filled fields for a new Dynamic test; reviewId selects that Review's frozen requirements. */
export type DynamicTestDraft = { name: string; goal: string; reviewId?: string };

export type StaticSessionStatus = 'prepared' | 'queued' | 'running' | 'success' | 'failure' | 'failed' | 'blocked' | 'cancelled' | 'pending_approval' | 'completed' | 'approved' | 'changes_requested';

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

/** Per-review measured usage, tagged adapter totals, and separate accounting assumptions. */
export type ReviewModelUsage = {
  totals: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    calls: number;
    totalTokens?: number | null;
    providerReportedTotalTokens?: number;
    providerReportedCalls?: number;
    unknownTotalCalls?: number;
    unknownInputCalls?: number;
    unknownOutputCalls?: number;
    unknownCacheReadCalls?: number;
    unknownCacheCreationCalls?: number;
    assumedZeroNoResponseCalls?: number;
    assumedZeroNoResponseTokens?: number;
    accountedTokens?: number;
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
    totalTokens?: number | null;
    providerReportedTotalTokens?: number;
    providerReportedCalls?: number;
    unknownTotalCalls?: number;
    unknownInputCalls?: number;
    unknownOutputCalls?: number;
    unknownCacheReadCalls?: number;
    unknownCacheCreationCalls?: number;
    assumedZeroNoResponseCalls?: number;
    assumedZeroNoResponseTokens?: number;
    accountedTokens?: number;
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
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheCreationTokens: number | null;
    totalTokens: number | null;
    createdAt: string;
    totalTokensStatus?: 'provider_reported' | 'provider_derived' | 'unavailable';
    responseReceived?: boolean | null;
    usageObservation?: { source: 'provider_response' | 'provider_error_response' | 'codex_thread_total' | 'codex_turn_last'; completeness: 'complete' | 'partial'; missingCounters?: string[] } | null;
    accountingBasis?: 'assumed_zero_no_response' | null;
    accountedTokens?: number | null;
    indexTrigger?: 'source_changed' | 'review' | null;
    indexFingerprint?: string | null;
  }>;
  reviewUsage?: ReviewUsageProjection;
};

export type ReviewUsagePhase =
  | 'initial_analysis'
  | 'domain_repair'
  | 'citation_repair'
  | 'semantic_support'
  | 'support_repair'
  | 'response_repair'
  | 'source_indexing'
  | 'context_retrieval';

export type ReviewUsagePhaseBreakdown = {
  phase: ReviewUsagePhase;
  calls: number;
  repairCalls: number;
  inputTokens?: number;
  unknownInputCalls?: number;
  outputTokens?: number;
  unknownOutputCalls?: number;
  cacheReadTokens?: number;
  unknownCacheReadCalls?: number;
  cacheCreationTokens?: number;
  unknownCacheCreationCalls?: number;
  providerReportedTotalTokens?: number;
  providerReportedTotalCalls?: number;
  unknownProviderTotalCalls?: number;
  canonicalTotalTokens?: number;
  unknownCanonicalTotalCalls?: number;
  assumedZeroNoResponseCalls?: number;
  assumedZeroNoResponseTokens?: number;
  accountedTokens?: number;
};

export type ReviewUsageProjection = {
  reusedAssessments?: {
    status: 'available' | 'partial' | 'unavailable';
    batchCount: number | null;
    minimumCallsAvoided: number | null;
    originReviewIds: string[];
    uniqueFileCount: number | null;
    files: Array<{ artifactId: string; artifactVersionId: string | null; contentHash: string | null; filePath: string; lineStart: number | null; lineEnd: number | null }>;
  };
  status: 'available' | 'partial' | 'unavailable';
  totalProviderReportedTokens: number;
  providerReportedCalls: number;
  unknownProviderTotalCalls: number;
  canonicalTotalTokens: number;
  unknownCanonicalTotalCalls: number;
  assumedZeroNoResponseCalls?: number;
  assumedZeroNoResponseTokens?: number;
  accountedTokens?: number;
  byStage: Array<{
    stage: string;
    operations: string[];
    state: 'not_reached' | 'running' | 'completed' | 'stopped';
    calls: number;
    successfulCalls: number;
    failedCalls: number;
    cancelledCalls: number;
    inProgressCalls: number;
    repairCalls: number;
    phases: ReviewUsagePhaseBreakdown[];
    inputTokens: number;
    unknownInputCalls: number;
    outputTokens: number;
    unknownOutputCalls: number;
    cacheReadTokens: number;
    unknownCacheReadCalls: number;
    cacheCreationTokens: number;
    unknownCacheCreationCalls: number;
    providerReportedTotalTokens: number;
    providerReportedTotalCalls: number;
    unknownProviderTotalCalls: number;
    canonicalTotalTokens: number;
    unknownCanonicalTotalCalls: number;
    assumedZeroNoResponseCalls?: number;
    assumedZeroNoResponseTokens?: number;
    accountedTokens?: number;
    requestContext: {
      callsWithContext: number;
      callsWithoutContext: number;
      estimatedInputTokens: number;
      estimatedCalls: number;
      componentsCharacters: Record<string, number>;
    };
    aiFileCount: number | null;
    aiFileAppearances: number | null;
    aiFiles: Array<{
      artifactId: string;
      artifactVersionId: string | null;
      contentHash: string | null;
      filePath: string;
      appearances: number;
      phases: ReviewUsagePhase[];
      ranges: Array<{ lineStart: number | null; lineEnd: number | null }>;
    }>;
    physicalReadAttempts: number | null;
    physicalReadFileCount: number | null;
    physicalFiles: Array<{
      artifactId: string;
      artifactVersionId: string | null;
      contentHash: string | null;
      filePath: string;
      readAttempts: number;
      successfulReads: number;
      failedReads: number;
      lines: number | null;
      characters: number | null;
    }>;
  }>;
  sourceInventory: {
    status: 'available' | 'partial' | 'unavailable';
    totalUniqueFiles: number | null;
    knownUniqueFiles: number;
    aiFileAppearances: number | null;
    repeatedFileAppearances: number | null;
    unknownAiFileAttempts: number;
    files: Array<{
      artifactId: string;
      artifactVersionId: string | null;
      contentHash: string | null;
      filePath: string;
      appearances: number;
      stages: string[];
      phases: ReviewUsagePhase[];
      ranges: Array<{ lineStart: number | null; lineEnd: number | null }>;
    }>;
    physical: {
      status: 'available' | 'partial' | 'unavailable';
      readAttempts: number | null;
      uniqueFiles: number | null;
      unknownReadAttempts: number;
      byStage: Array<{
        stage: string;
        readAttempts: number;
        uniqueFiles: number;
        files: Array<{
          artifactId: string;
          artifactVersionId: string | null;
          contentHash: string | null;
          filePath: string;
          readAttempts: number;
          successfulReads: number;
          failedReads: number;
          lines: number | null;
          characters: number | null;
        }>;
      }>;
    };
  };
};

export type ReviewType = 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency';

export type StaticSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  completedAt?: string | null;
  modelStatus?: 'not_requested' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
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
  requirementId?: string;
  references?: FindingSourceReference[];
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

export type FindingResolutionEvidence = {
  status: 'resolved';
  basis: 'not_reproduced_in_comparable_review';
  reviewId: string;
  reviewName: string;
  sourceManifestId: string;
  previousSourceVersion: string;
  reviewedSourceVersion: string;
};

export type FindingLineageHistoryEntry = {
  findingId: string;
  reviewId: string | null;
  reviewName?: string;
  classification: 'recurring' | 'regressed';
  status: 'new' | 'accepted' | 'dismissed' | 'fixed' | 'carryover';
  title: string;
  severity: string;
  sourceVersion?: string | null;
  createdAt: string;
};

export type Finding = {
  /** Source-backed feature/path link validated by the Review runner. */
  location?: { ruleId?: string | null; sourceVersion?: string | null; domain?: string | null; issueType?: string | null; logicFlow?: string[]; relatedLocations?: Array<{ artifactId?: string | null; filePath: string; lineNumber: number; evidence: string; sourceVersion?: string | null }>; sourceLocator?: { artifactId?: string; filePath?: string; lineStart?: number; excerpt?: string; analysis?: { featureId: string; pathId: string; domain: string }; citationEvidence?: { version: 1; verification: 'verified' | 'needs_verification'; reason: 'source_match' | 'support_unverified'; candidates: Array<{ artifactId: string; sourceVersion: string; filePath: string; lineNumber: number; excerpt: string; score: number; confidence: 'high' | 'medium' | 'low'; match: 'exact' | 'relocated_exact' | 'approximate'; referenceIndex: number }>; unmatchedReferences: number } | null } | null };
  artifactVersionId?: string | null;
  requirementId?: string | null;
  relatedSources?: FindingSourceReference[];
  /** Saved analysis origin, when supplied by the service. */
  verifier?: string | null;
  /** A finding derived from this review's saved document assessment. */
  evidenceGap?: { assessmentId: string; code: string };
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
  /** Validated, derived project-list evidence; never a persisted decision. */
  resolutionEvidence?: FindingResolutionEvidence;
  /** Prior occurrences represented by this original project finding ID. */
  lineageHistory?: FindingLineageHistoryEntry[];
  /** Original project issue ID is retained; this identifies its latest evidence. */
  latestOccurrence?: { findingId: string; reviewId: string | null; classification: 'recurring' | 'regressed' };
};

export type FindingSourceReference = {
  artifactId?: string | null;
  filePath: string;
  lineNumber?: number | null;
  sourceVersion?: string | null;
  excerpt?: string;
  relation: 'code' | 'document' | 'requirement';
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
  /** Production orchestrator progress; older payloads use currentStage/stages. */
  stage?: string;
  pauseCode?: string;
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

export type ReviewSourceArtifact = {
  id: string;
  fileName: string;
  filePath: string;
  contentHash: string;
  artifactVersionId?: string | null;
};

export type ReviewSourceManifest = {
  sessionId: string;
  projectId: string;
  status: 'available' | 'unavailable' | 'incomplete';
  capturedAt?: string;
  updatedAt?: string;
  sources: ReviewSourceManifestItem[];
  artifactCount: number | null;
  /** Exact artifacts saved with this Review. Legacy snapshots may omit these. */
  artifacts?: ReviewSourceArtifact[];
};

export type TraceabilityState = 'complete' | 'incomplete' | 'missing';

export type ReviewTraceabilityRecord = {
  evidenceStatus?: 'verified' | 'stale' | 'unavailable';
  evidenceReason?: string | null;
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
      initialSection?: 'source';
      initialAction?: 'static' | 'dynamic';
      initialStaticSessionId?: string;
    }
  | { name: 'review-entry'; projectId?: string; comparisonParentReviewId?: string; returnToPlayground?: boolean }
  | { name: 'review-activity'; projectId: string; sessionId: string; reviewName?: string }
  /** draft pre-fills a new test, e.g. from a Review finding; it never starts a Run. */
  | { name: 'dynamic-testing'; projectId?: string; runId?: string; draft?: DynamicTestDraft }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'evidence-browser'; projectId: string }
  | { name: 'requirements'; projectId: string }
  | { name: 'review-playground'; projectId?: string; sessionId?: string }
  | { name: 'settings' }
    | { name: 'help' }
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
export type { ReadinessStatus as ProjectReadinessStatus, ReadinessAssessment, ReadinessCategoryResult, ReadinessGap } from '../../sidecar/src/readiness/types';
export type SourceIndexStatus = {
  state: 'none' | 'queued' | 'running' | 'ready' | 'paused' | 'failed' | 'superseded';
  fingerprint?: string; updatedAt?: string; errorCode?: string | null;
};
