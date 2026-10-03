import crypto from 'node:crypto';
import type {
  CentinelStore,
  StoreArtifact,
  StoreArtifactVersion,
  StoreAssessment,
  StoreDecision,
  StoreDynamicSession,
  StoreEmbeddingChunk,
  StoreFinding,
  StoreFindingStateChange,
  StoreIntegration,
  StoreModelConfiguration,
  StoreModelUsage,
  StoreProject,
  StoreProjectMember,
  StoreProjectSource,
  StoreRequirement,
  StoreRequirementMapping,
  StoreReviewEvidence,
  StoreReviewSession,
  StoreStandard,
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  return crypto.randomUUID();
}

/** Fast adapter for contract tests and local development without Supabase. */
export class InMemoryCentinelStore implements CentinelStore {
  private readonly projects = new Map<string, StoreProject>();
  private readonly members = new Map<string, StoreProjectMember>();
  private readonly sources = new Map<string, StoreProjectSource>();
  private readonly artifacts = new Map<string, StoreArtifact>();
  private readonly artifactVersions = new Map<string, StoreArtifactVersion>();
  private readonly requirements = new Map<string, StoreRequirement>();
  private readonly standards = new Map<string, StoreStandard>();
  private readonly mappings = new Map<string, StoreRequirementMapping>();
  private readonly findings = new Map<string, StoreFinding>();
  private readonly findingHistory = new Map<string, StoreFindingStateChange>();
  private readonly reviews = new Map<string, StoreReviewSession>();
  private readonly evidence = new Map<string, StoreReviewEvidence>();
  private readonly decisions = new Map<string, StoreDecision>();
  private readonly assessments = new Map<string, StoreAssessment>();
  private readonly modelConfigurations = new Map<string, StoreModelConfiguration>();
  private readonly modelUsage = new Map<string, StoreModelUsage>();
  private readonly integrations = new Map<string, StoreIntegration>();
  private readonly embeddings = new Map<string, StoreEmbeddingChunk>();
  private readonly dynamics = new Map<string, StoreDynamicSession>();

  seed(input: {
    projects?: StoreProject[];
    members?: StoreProjectMember[];
    sources?: StoreProjectSource[];
    artifacts?: StoreArtifact[];
    artifactVersions?: StoreArtifactVersion[];
    requirements?: StoreRequirement[];
    standards?: StoreStandard[];
    mappings?: StoreRequirementMapping[];
    findings?: StoreFinding[];
    reviews?: StoreReviewSession[];
    evidence?: StoreReviewEvidence[];
    dynamics?: StoreDynamicSession[];
  }): void {
    input.projects?.forEach(item => this.projects.set(item.id, clone(item)));
    input.members?.forEach(item => this.members.set(`${item.projectId}:${item.userId}`, clone(item)));
    input.sources?.forEach(item => this.sources.set(item.id, clone(item)));
    input.artifacts?.forEach(item => this.artifacts.set(item.id, clone(item)));
    input.artifactVersions?.forEach(item => this.artifactVersions.set(item.id, clone(item)));
    input.requirements?.forEach(item => this.requirements.set(item.id, clone(item)));
    input.standards?.forEach(item => this.standards.set(item.id, clone(item)));
    input.mappings?.forEach(item => this.mappings.set(item.id, clone(item)));
    input.findings?.forEach(item => this.findings.set(item.id, clone(item)));
    input.reviews?.forEach(item => this.reviews.set(item.id, clone(item)));
    input.evidence?.forEach(item => this.evidence.set(item.id, clone(item)));
    input.dynamics?.forEach(item => this.dynamics.set(item.id, clone(item)));
  }

  async listProjects(ownerId?: string): Promise<StoreProject[]> {
    return clone(Array.from(this.projects.values()).filter(item => !ownerId || item.ownerId === ownerId));
  }

  async getProject(projectId: string): Promise<StoreProject | null> {
    const item = this.projects.get(projectId);
    return item ? clone(item) : null;
  }

  async createProject(input: Omit<StoreProject, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProject> {
    const timestamp = now();
    const item: StoreProject = { ...input, id: id(), createdAt: timestamp, updatedAt: timestamp };
    this.projects.set(item.id, clone(item));
    await this.upsertProjectMember({ projectId: item.id, userId: item.ownerId, role: 'owner' });
    return clone(item);
  }

  async listProjectMembers(projectId: string): Promise<StoreProjectMember[]> {
    return clone(Array.from(this.members.values()).filter(item => item.projectId === projectId));
  }

  async upsertProjectMember(input: Omit<StoreProjectMember, 'createdAt'>): Promise<StoreProjectMember> {
    const key = `${input.projectId}:${input.userId}`;
    const existing = this.members.get(key);
    const item: StoreProjectMember = { ...input, createdAt: existing?.createdAt ?? now() };
    this.members.set(key, clone(item));
    return clone(item);
  }

  async listSources(projectId: string): Promise<StoreProjectSource[]> {
    return clone(Array.from(this.sources.values()).filter(item => item.projectId === projectId));
  }

  async saveSource(input: Omit<StoreProjectSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreProjectSource> {
    const timestamp = now();
    const item: StoreProjectSource = { ...input, id: id(), createdAt: timestamp, updatedAt: timestamp };
    this.sources.set(item.id, clone(item));
    return clone(item);
  }

  async listArtifacts(projectId: string): Promise<StoreArtifact[]> {
    return clone(Array.from(this.artifacts.values()).filter(item => item.projectId === projectId));
  }

  async saveArtifact(input: Omit<StoreArtifact, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreArtifact> {
    const existing = Array.from(this.artifacts.values()).find(item => item.projectId === input.projectId && item.path === input.path);
    const timestamp = now();
    const item: StoreArtifact = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    this.artifacts.set(item.id, clone(item));
    return clone(item);
  }

  async listArtifactVersions(artifactId: string): Promise<StoreArtifactVersion[]> {
    return clone(Array.from(this.artifactVersions.values()).filter(item => item.artifactId === artifactId).sort((a, b) => a.versionNumber - b.versionNumber));
  }

  async saveArtifactVersion(input: Omit<StoreArtifactVersion, 'id' | 'createdAt'>): Promise<StoreArtifactVersion> {
    const existing = Array.from(this.artifactVersions.values()).find(item => item.artifactId === input.artifactId && item.contentHash === input.contentHash);
    const item: StoreArtifactVersion = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? now() };
    this.artifactVersions.set(item.id, clone(item));
    return clone(item);
  }

  async listRequirements(projectId: string): Promise<StoreRequirement[]> {
    return clone(Array.from(this.requirements.values()).filter(item => item.projectId === projectId));
  }

  async saveRequirement(input: Omit<StoreRequirement, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreRequirement> {
    const existing = Array.from(this.requirements.values()).find(item => item.projectId === input.projectId && item.title === input.title);
    const timestamp = now();
    const item: StoreRequirement = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    this.requirements.set(item.id, clone(item));
    return clone(item);
  }

  async listStandards(projectId: string): Promise<StoreStandard[]> {
    return clone(Array.from(this.standards.values()).filter(item => item.projectId === projectId));
  }

  async saveStandard(input: Omit<StoreStandard, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreStandard> {
    const existing = Array.from(this.standards.values()).find(item => item.projectId === input.projectId && item.code === input.code);
    const timestamp = now();
    const item: StoreStandard = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    this.standards.set(item.id, clone(item));
    return clone(item);
  }

  async listRequirementMappings(requirementId: string): Promise<StoreRequirementMapping[]> {
    return clone(Array.from(this.mappings.values()).filter(item => item.requirementId === requirementId));
  }

  async saveRequirementMapping(input: Omit<StoreRequirementMapping, 'id' | 'createdAt'>): Promise<StoreRequirementMapping> {
    const existing = Array.from(this.mappings.values()).find(item => item.requirementId === input.requirementId && item.artifactId === input.artifactId && item.standardId === input.standardId);
    const item: StoreRequirementMapping = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? now() };
    this.mappings.set(item.id, clone(item));
    return clone(item);
  }

  async listFindings(projectId: string, reviewSessionId?: string): Promise<StoreFinding[]> {
    return clone(Array.from(this.findings.values()).filter(item => item.projectId === projectId && (!reviewSessionId || item.reviewSessionId === reviewSessionId)));
  }

  async saveFinding(input: Omit<StoreFinding, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreFinding> {
    const existing = input.correlationFingerprint
      ? Array.from(this.findings.values()).find(item => item.reviewSessionId === input.reviewSessionId && item.correlationFingerprint === input.correlationFingerprint)
      : undefined;
    const timestamp = now();
    const item: StoreFinding = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    this.findings.set(item.id, clone(item));
    return clone(item);
  }

  async updateFindingStatus(findingId: string, status: StoreFinding['status'], actorId: string | null = null, comment = ''): Promise<StoreFinding> {
    const current = this.findings.get(findingId);
    if (!current) throw new Error(`Finding ${findingId} was not found.`);
    if (current.status !== status) {
      const change: StoreFindingStateChange = { id: id(), projectId: current.projectId, findingId, fromStatus: current.status, toStatus: status, actorId, comment, createdAt: now() };
      this.findingHistory.set(change.id, change);
    }
    const updated = { ...current, status, updatedAt: now() };
    this.findings.set(findingId, clone(updated));
    return clone(updated);
  }

  async listFindingStateHistory(findingId: string): Promise<StoreFindingStateChange[]> {
    return clone(Array.from(this.findingHistory.values()).filter(item => item.findingId === findingId));
  }

  async listReviewSessions(projectId: string): Promise<StoreReviewSession[]> {
    return clone(Array.from(this.reviews.values()).filter(item => item.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async getReviewSession(reviewSessionId: string): Promise<StoreReviewSession | null> {
    const item = this.reviews.get(reviewSessionId);
    return item ? clone(item) : null;
  }

  async saveReviewSession(input: Omit<StoreReviewSession, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<StoreReviewSession> {
    const existing = input.id
      ? this.reviews.get(input.id)
      : input.idempotencyKey
        ? Array.from(this.reviews.values()).find(item => item.projectId === input.projectId && item.idempotencyKey === input.idempotencyKey)
        : undefined;
    const timestamp = now();
    const item: StoreReviewSession = {
      ...input,
      id: existing?.id ?? input.id ?? id(),
      config: clone(input.config),
      progress: clone(input.progress),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.reviews.set(item.id, clone(item));
    return clone(item);
  }

  async updateReviewSession(reviewSessionId: string, patch: Partial<Pick<StoreReviewSession, 'status' | 'progress' | 'finalSummary' | 'failureReason' | 'cancelledAt' | 'completedAt'>>): Promise<StoreReviewSession> {
    const current = this.reviews.get(reviewSessionId);
    if (!current) throw new Error(`Review ${reviewSessionId} was not found.`);
    const updated = { ...current, ...clone(patch), updatedAt: now() };
    this.reviews.set(reviewSessionId, clone(updated));
    return clone(updated);
  }

  async listReviewEvidence(reviewSessionId: string): Promise<StoreReviewEvidence[]> {
    return clone(Array.from(this.evidence.values()).filter(item => item.reviewSessionId === reviewSessionId));
  }

  async saveReviewEvidence(input: Omit<StoreReviewEvidence, 'id' | 'createdAt'>): Promise<StoreReviewEvidence> {
    const item: StoreReviewEvidence = { ...input, id: id(), createdAt: now() };
    this.evidence.set(item.id, clone(item));
    return clone(item);
  }

  async listDecisions(reviewSessionId: string): Promise<StoreDecision[]> {
    return clone(Array.from(this.decisions.values()).filter(item => item.reviewSessionId === reviewSessionId));
  }

  async saveDecision(input: Omit<StoreDecision, 'id' | 'createdAt'>): Promise<StoreDecision> {
    const item: StoreDecision = { ...input, id: id(), createdAt: now() };
    this.decisions.set(item.id, clone(item));
    return clone(item);
  }

  async saveAssessment(input: Omit<StoreAssessment, 'id' | 'createdAt'>): Promise<StoreAssessment> {
    const existing = Array.from(this.assessments.values()).find(item => item.reviewSessionId === input.reviewSessionId);
    const item: StoreAssessment = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? now() };
    this.assessments.set(item.id, clone(item));
    return clone(item);
  }

  async listModelConfigurations(ownerId: string, projectId?: string | null): Promise<StoreModelConfiguration[]> {
    return clone(Array.from(this.modelConfigurations.values()).filter(item => item.ownerId === ownerId && (projectId === undefined || item.projectId === projectId)));
  }

  async saveModelConfiguration(input: Omit<StoreModelConfiguration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreModelConfiguration> {
    const existing = Array.from(this.modelConfigurations.values()).find(item => item.ownerId === input.ownerId && item.projectId === input.projectId && item.purpose === input.purpose);
    const timestamp = now();
    const item: StoreModelConfiguration = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    this.modelConfigurations.set(item.id, clone(item));
    return clone(item);
  }

  async listModelUsage(reviewSessionId: string): Promise<StoreModelUsage[]> {
    return clone(Array.from(this.modelUsage.values()).filter(item => item.reviewSessionId === reviewSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  async saveModelUsage(input: Omit<StoreModelUsage, 'id' | 'createdAt'>): Promise<StoreModelUsage> {
    const item: StoreModelUsage = { ...input, id: id(), createdAt: now() };
    this.modelUsage.set(item.id, clone(item));
    return clone(item);
  }

  async listIntegrations(ownerId: string): Promise<StoreIntegration[]> {
    return clone(Array.from(this.integrations.values()).filter(item => item.ownerId === ownerId));
  }

  async saveIntegration(input: Omit<StoreIntegration, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoreIntegration> {
    const existing = Array.from(this.integrations.values()).find(item => item.ownerId === input.ownerId && item.provider === input.provider);
    const timestamp = now();
    const item: StoreIntegration = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
    this.integrations.set(item.id, clone(item));
    return clone(item);
  }

  async saveEmbeddingChunk(input: Omit<StoreEmbeddingChunk, 'id' | 'createdAt'>): Promise<StoreEmbeddingChunk> {
    const existing = Array.from(this.embeddings.values()).find(item => item.parentType === input.parentType && item.parentId === input.parentId && item.contentHash === input.contentHash);
    const item: StoreEmbeddingChunk = { ...input, id: existing?.id ?? id(), createdAt: existing?.createdAt ?? now() };
    this.embeddings.set(item.id, clone(item));
    return clone(item);
  }

  async listDynamicSessions(projectId: string): Promise<StoreDynamicSession[]> {
    return clone(Array.from(this.dynamics.values()).filter(item => item.projectId === projectId));
  }

}
