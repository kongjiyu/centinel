/**
 * Domain-level persistence contracts for the static-review boundary.
 *
 * The sidecar's route/orchestration code should depend on these records and
 * methods rather than on SQLite table names or Supabase row shapes. Dates are
 * ISO strings at this seam so adapters remain serialisable and easy to test.
 */

export type StoreProject = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreProjectMember = {
  projectId: string;
  userId: string;
  role: 'owner' | 'member' | 'viewer';
  createdAt: string;
};

export type StoreProjectSource = {
  id: string;
  projectId: string;
  integrationId: string | null;
  kind: 'upload' | 'local_repository' | 'github_repository' | 'google_drive' | 'slack_channel';
  name: string;
  remoteId: string | null;
  remoteUrl: string | null;
  syncStatus: 'idle' | 'syncing' | 'ready' | 'error';
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreArtifact = {
  id: string;
  projectId: string;
  sourceId: string | null;
  path: string;
  name: string;
  kind: string;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StoreArtifactVersion = {
  id: string;
  projectId: string;
  artifactId: string;
  versionNumber: number;
  contentHash: string;
  byteSize: number | null;
  storagePath: string | null;
  sourceRevision: string | null;
  contentType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StoreRequirement = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreStandard = {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  source: string;
  version: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StoreRequirementMapping = {
  id: string;
  projectId: string;
  requirementId: string;
  standardId: string | null;
  artifactId: string | null;
  fileId: string | null;
  symbolId: string | null;
  coverageStatus: string;
  confidence: number;
  createdAt: string;
};

export type StoreReviewStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'pending_approval'
  | 'completed'
  | 'approved'
  | 'changes_requested';

export type StoreReviewSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: string;
  status: StoreReviewStatus | string;
  config: Record<string, unknown>;
  progress: Record<string, unknown>;
  parentReviewId: string | null;
  idempotencyKey: string | null;
  sourceManifestHash: string | null;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
};

export type StoreReviewEvidence = {
  id: string;
  projectId: string;
  reviewSessionId: string;
  artifactVersionId: string | null;
  kind: string;
  locator: Record<string, unknown>;
  content: string | null;
  storagePath: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  immutable: boolean;
  createdAt: string;
};

export type StoreFinding = {
  id: string;
  projectId: string;
  reviewSessionId: string | null;
  dynamicSessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  priority: string | null;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed' | 'carryover';
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  artifactId: string | null;
  artifactVersionId: string | null;
  evidenceId: string | null;
  requirementId: string | null;
  standardId: string | null;
  verifier: string | null;
  location: Record<string, unknown>;
  correlationFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoreFindingStateChange = {
  id: string;
  projectId: string;
  findingId: string;
  fromStatus: StoreFinding['status'] | null;
  toStatus: StoreFinding['status'];
  actorId: string | null;
  comment: string;
  createdAt: string;
};

export type StoreDecision = {
  id: string;
  projectId: string;
  reviewSessionId: string;
  decision: 'approved' | 'changes_requested' | 'commented';
  comment: string;
  reviewer: string;
  createdAt: string;
};

export type StoreAssessment = {
  id: string;
  projectId: string;
  reviewSessionId: string;
  riskLevel: string;
  score: number | null;
  policyVersion: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type StoreModelConfiguration = {
  id: string;
  ownerId: string;
  projectId: string | null;
  purpose: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  secretCiphertext: string | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StoreModelUsage = {
  id: string;
  projectId: string | null;
  reviewSessionId: string | null;
  ownerId: string | null;
  stage: string;
  attempt: number;
  provider: string;
  model: string;
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  durationMs: number | null;
  errorCode: string | null;
  cost: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StoreIntegration = {
  id: string;
  ownerId: string;
  provider: string;
  accountLabel: string;
  accountId: string;
  scopes: string;
  tokenReference: string | null;
  expiresAt: string | null;
  status: 'connected' | 'expired' | 'error' | 'disconnected' | string;
  createdAt: string;
  updatedAt: string;
};

export type StoreEmbeddingChunk = {
  id: string;
  projectId: string;
  parentId: string;
  parentType: 'artifact_version' | 'requirement' | 'standard';
  ordinal: number;
  content: string;
  contentHash: string;
  embedding: number[] | null;
  embeddingModel: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StoreDynamicSession = {
  id: string;
  projectId: string;
  name: string;
  targetUrl: string;
  goal: string;
  missionType: string;
  status: string;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

export type StorePage<T> = { items: T[]; nextCursor: string | null };

/**
 * The durable repository surface. Methods are deliberately grouped by
 * domain, but one adapter owns the transaction/query boundary so callers do
 * not accidentally mix SQLite and Supabase records in a single workflow.
 */
export interface CentinelStore {
  listProjects(ownerId?: string): Promise<StoreProject[]>;
  getProject(projectId: string): Promise<StoreProject | null>;
  createProject(input: Omit<StoreProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProject>;
  listProjectMembers(projectId: string): Promise<StoreProjectMember[]>;
  upsertProjectMember(input: Omit<StoreProjectMember, 'createdAt'>): Promise<StoreProjectMember>;

  listSources(projectId: string): Promise<StoreProjectSource[]>;
  saveSource(input: Omit<StoreProjectSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProjectSource>;
  listArtifacts(projectId: string, signal?: AbortSignal): Promise<StoreArtifact[]>;
  saveArtifact(input: Omit<StoreArtifact, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreArtifact>;
  listArtifactVersions(artifactId: string, signal?: AbortSignal): Promise<StoreArtifactVersion[]>;
  saveArtifactVersion(input: Omit<StoreArtifactVersion, 'id' | 'createdAt'>): Promise<StoreArtifactVersion>;

  listRequirements(projectId: string): Promise<StoreRequirement[]>;
  saveRequirement(input: Omit<StoreRequirement, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreRequirement>;
  listStandards(projectId: string): Promise<StoreStandard[]>;
  saveStandard(input: Omit<StoreStandard, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreStandard>;
  listRequirementMappings(requirementId: string): Promise<StoreRequirementMapping[]>;
  saveRequirementMapping(input: Omit<StoreRequirementMapping, 'id' | 'createdAt'>): Promise<StoreRequirementMapping>;

  listFindings(projectId: string, reviewSessionId?: string): Promise<StoreFinding[]>;
  saveFinding(input: Omit<StoreFinding, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreFinding>;
  updateFindingStatus(findingId: string, status: StoreFinding['status'], actorId?: string | null, comment?: string): Promise<StoreFinding>;
  listFindingStateHistory(findingId: string): Promise<StoreFindingStateChange[]>;
  listReviewSessions(projectId: string): Promise<StoreReviewSession[]>;
  getReviewSession(reviewSessionId: string): Promise<StoreReviewSession | null>;
  saveReviewSession(input: Omit<StoreReviewSession, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<StoreReviewSession>;
  updateReviewSession(reviewSessionId: string, patch: Partial<Pick<StoreReviewSession, 'status' | 'progress' | 'finalSummary' | 'failureReason' | 'cancelledAt' | 'completedAt'>>): Promise<StoreReviewSession>;
  listReviewEvidence(reviewSessionId: string): Promise<StoreReviewEvidence[]>;
  saveReviewEvidence(input: Omit<StoreReviewEvidence, 'id' | 'createdAt'>): Promise<StoreReviewEvidence>;
  listDecisions(reviewSessionId: string): Promise<StoreDecision[]>;
  saveDecision(input: Omit<StoreDecision, 'id' | 'createdAt'>): Promise<StoreDecision>;
  saveAssessment(input: Omit<StoreAssessment, 'id' | 'createdAt'>): Promise<StoreAssessment>;

  listModelConfigurations(ownerId: string, projectId?: string | null): Promise<StoreModelConfiguration[]>;
  saveModelConfiguration(input: Omit<StoreModelConfiguration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreModelConfiguration>;
  listModelUsage(reviewSessionId: string): Promise<StoreModelUsage[]>;
  saveModelUsage(input: Omit<StoreModelUsage, 'id' | 'createdAt'>): Promise<StoreModelUsage>;
  listIntegrations(ownerId: string): Promise<StoreIntegration[]>;
  saveIntegration(input: Omit<StoreIntegration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreIntegration>;
  saveEmbeddingChunk(input: Omit<StoreEmbeddingChunk, 'id' | 'createdAt'>): Promise<StoreEmbeddingChunk>;

  listDynamicSessions(projectId: string): Promise<StoreDynamicSession[]>;
}
