import type { Project, CollaborationStatus, CollaboratorSearchResult, CollaboratorInviteResult, GithubCollaboratorSnapshot, AiProviderSetting, AiProvider, AiApiFormat, AiTestResult, DynamicSession, DynamicEvidence, Artifact, StaticSession, Finding, ReviewSourceManifest, ReviewTraceabilitySnapshot, ProjectAssessment, Requirement, RequirementMapping, ReviewDecisionRecord, ReviewDecision, ReviewDecisionAttachmentInput, ReviewModelUsage, ReviewScopeSelection, IntegrationProvider, ConnectedSource, ConnectedSourceStatusResult, ConnectedSourceBrowsePage, ConnectedSourceSyncResult, ConnectedSourceSyncRun, EvidenceSufficiencyAssessment, EvidenceContradictionDisposition, FindingCorrelationSnapshot, RequirementCandidate, StandardRule } from '../types';

const BASE = 'http://localhost:37701';

/** A transport error that retains status/code without exposing response data. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem('centinel:supabase-access-token')
    : null;
  const userId = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem('centinel:supabase-user-id')
    : null;
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (userId) headers.set('X-Centinel-User-Id', userId);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Empty responses are still represented by the HTTP status below. This
    // keeps lifecycle/auth errors actionable when a proxy closes early.
  }
  if (!res.ok) {
    const payload = json && typeof json === 'object' ? json as { error?: unknown; code?: unknown } : {};
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`;
    const code = typeof payload.code === 'string' ? payload.code : null;
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('centinel:auth-expired'));
    }
    throw new ApiError(message, res.status, code);
  }
  return json as T;
}

type DecisionServiceRecord = Omit<ReviewDecisionRecord, 'sessionId'> & { reviewId?: string; sessionId?: string };
type DecisionServiceResponse = { decision: DecisionServiceRecord; preparedChild?: Record<string, unknown> | null };

function normalizeDecision(record: DecisionServiceRecord): ReviewDecisionRecord {
  return { ...record, sessionId: record.sessionId ?? record.reviewId ?? '' };
}

function normalizePreparedReview(value: Record<string, unknown>): StaticSession {
  const config = value.config && typeof value.config === 'object' ? value.config : {};
  const scope = value.scope && typeof value.scope === 'object' ? value.scope as ReviewScopeSelection : undefined;
  const lineage = value.lineage && typeof value.lineage === 'object' ? value.lineage as Record<string, unknown> : {};
  return {
    id: String(value.id ?? ''), projectId: String(value.projectId ?? ''), name: String(value.name ?? ''),
    reviewType: String(value.reviewType ?? 'code_review') as StaticSession['reviewType'], status: 'prepared',
    configJson: JSON.stringify(config), progressJson: '{}', remarks: '', finalSummary: '', failureReason: '',
    createdAt: String(value.createdAt ?? ''), updatedAt: String(value.updatedAt ?? ''), baseRef: '', headRef: '',
    changedFilesJson: '[]', parentSessionId: String(lineage.parentReviewId ?? ''), reviewDiffJson: '', scope,
  };
}

export type CreateStaticSessionPayload = {
  name: string;
  instructions: string;
  /** Kept for transport compatibility; Review no longer exposes review-type choices. */
  reviewMode?: 'regular' | 'pull-request' | 'changed-files';
  reviewer?: string;
  pullRequest?: string;
  baseRef?: string;
  headRef?: string;
  scope?: ReviewScopeSelection;
  artifactIds?: string[];
  requirementIds?: string[];
  standardIds?: string[];
  selectedArtifactIds?: string[];
  selectedRequirementIds?: string[];
  selectedStandardIds?: string[];
  /** Client-generated key makes repeated submissions safe at the service seam. */
  idempotencyKey?: string;
  temporaryArtifactIds?: string[];
  supportiveDocuments?: Array<{ id?: string; name: string }>;
  parentSessionId?: string;
};

export type ProjectReportExportResult = {
  reportId: string;
  generatedAt: string;
  generatorVersion: string;
  riskPolicyVersion: string;
  expiresAt: string | null;
  storage: 'private-supabase';
  downloads: {
    json: string | null;
    markdown: string | null;
    pdf: string | null;
  };
  markdown: string;
  checksums: {
    snapshot: string;
    markdown: string;
    pdf: string;
    package: string;
  };
};

export type ProjectReportHistoryEntry = {
  id: string;
  projectId: string;
  actorId: string | null;
  policyVersion: string;
  generatorVersion: string;
  checksum: string | null;
  createdAt: string;
  storage: { json: string | null; markdown: string | null; pdf: string | null };
};

export type ProjectReportDownloadLinks = {
  reportId: string;
  expiresAt: string;
  downloads: { json: string; markdown: string; pdf: string };
};

export const api = {
  health: () => request<{ status: string }>('/health'),

  // Projects
  projects: () => request<Project[]>('/projects'),
  project: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (name: string, description: string, workspacePath: string, source?: { type: 'local-repository' } | { type: 'github'; repoUrl: string }) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description, workspacePath, source }),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  updateProject: (id: string, data: { name: string; description: string; workspacePath: string }) =>
    request<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getCollaborationStatus: (id: string) =>
    request<CollaborationStatus>(`/projects/${id}/collaborators/status`),
  getProjectCollaborators: (id: string) =>
    request<GithubCollaboratorSnapshot>(`/projects/${id}/collaborators`),
  syncGithubCollaborators: (id: string) =>
    request<GithubCollaboratorSnapshot>(`/projects/${id}/collaborators/sync`, { method: 'POST' }),
  searchCollaborators: (id: string, email: string) =>
    request<CollaboratorSearchResult>(`/projects/${id}/collaborators/search?email=${encodeURIComponent(email)}`),
  inviteCollaborator: (id: string, username: string) =>
    request<CollaboratorInviteResult>(`/projects/${id}/collaborators/invite`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  listGithubPullRequests: (id: string) =>
    request<{ repository: { owner: string; repo: string; remoteUrl: string }; pullRequests: Array<{ number: number; title: string; state: 'open' | 'closed'; htmlUrl: string; headRef: string; baseRef: string }> }>(
      `/projects/${id}/github/pull-requests`,
    ),
  githubStatus: () =>
    request<{ connected: boolean; login: string | null; message: string }>('/github/status'),
  listIntegrations: () =>
    request<Array<{ id: string; provider: 'github' | 'google_drive' | 'slack'; accountLabel: string; accountId: string; scopes: string; expiresAt: string | null; status: 'connected' | 'expired' | 'error'; createdAt: string; updatedAt: string }>>('/integrations'),
  startIntegration: (provider: 'github' | 'google_drive' | 'slack') =>
    request<{ authorizeUrl: string; state: string }>(`/integrations/${provider}/connect`, { method: 'POST' }),
  disconnectIntegration: (provider: 'github' | 'google_drive' | 'slack') =>
    request<{ ok: boolean }>(`/integrations/${provider}`, { method: 'DELETE' }),
  getConnectedSourceStatus: (provider: IntegrationProvider, projectId: string) =>
    request<ConnectedSourceStatusResult>(`/integrations/${provider}/source-status?projectId=${encodeURIComponent(projectId)}`),
  browseConnectedSources: (provider: IntegrationProvider, options: { remoteId?: string; cursor?: string; query?: string; pageSize?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.remoteId) params.set('remoteId', options.remoteId);
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.query) params.set('query', options.query);
    if (options.pageSize) params.set('pageSize', String(options.pageSize));
    return request<ConnectedSourceBrowsePage>(`/integrations/${provider}/browse${params.size ? `?${params.toString()}` : ''}`);
  },
  listConnectedSources: (projectId: string) =>
    request<ConnectedSource[]>(`/projects/${projectId}/sources`),
  importConnectedSource: (projectId: string, data: {
    provider: IntegrationProvider;
    kind: ConnectedSource['kind'];
    remoteId: string;
    remoteUrl?: string | null;
    name: string;
    selectedScope?: Record<string, unknown>;
    sync?: boolean;
    idempotencyKey?: string;
  }) => request<{ source: ConnectedSource; syncResult: ConnectedSourceSyncResult | null }>(`/projects/${projectId}/sources`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  syncConnectedSource: (projectId: string, sourceId: string, data: { force?: boolean; maxPages?: number; idempotencyKey?: string } = {}) =>
    request<ConnectedSourceSyncResult>(`/projects/${projectId}/sources/${sourceId}/sync`, { method: 'POST', body: JSON.stringify(data) }),
  resumeConnectedSourceSync: (projectId: string, sourceId: string, runId: string, data: { force?: boolean; maxPages?: number } = {}) =>
    request<ConnectedSourceSyncResult>(`/projects/${projectId}/sources/${sourceId}/sync-runs/${runId}/resume`, { method: 'POST', body: JSON.stringify(data) }),
  getConnectedSourceSyncHistory: (projectId: string, sourceId: string) =>
    request<ConnectedSourceSyncRun[]>(`/projects/${projectId}/sources/${sourceId}/sync-history`),
  disconnectConnectedSource: (projectId: string, sourceId: string) =>
    request<ConnectedSource>(`/projects/${projectId}/sources/${sourceId}`, { method: 'DELETE' }),

  // AI Settings
  codexStatus: () => request<{ available: boolean; connected: boolean; accountLabel: string | null; message: string }>('/settings/codex'),
  codexLogin: () => request<{ loginId: string; authUrl: string }>('/settings/codex/login', { method: 'POST' }),
  codexCancelLogin: (loginId: string) => request<{ ok: boolean }>('/settings/codex/login/cancel', { method: 'POST', body: JSON.stringify({ loginId }) }),
  codexLogout: () => request<{ ok: boolean }>('/settings/codex/logout', { method: 'POST' }),
  codexModels: () => request<{ id: string; label: string; supportsImages: boolean; isDefault: boolean }[]>('/settings/codex/models'),
  testCodex: (model: string, vision = false) => request<{ status: 'pass' | 'fail'; message: string }>('/settings/codex/test', { method: 'POST', body: JSON.stringify({ model, vision }) }),
  aiSettings: () => request<AiProviderSetting[]>('/settings/ai'),
  updateAiSetting: (id: 'text' | 'vision' | 'embedding', data: {
    provider: AiProvider;
    apiFormat: AiApiFormat;
    apiKey: string;
    baseUrl: string;
    model: string;
    fallbackEnabled?: boolean;
    fallbackProvider?: AiProvider | null;
    fallbackApiFormat?: AiApiFormat | null;
    fallbackApiKey?: string;
    fallbackBaseUrl?: string;
    fallbackModel?: string;
  }) =>
    request<AiProviderSetting>(`/settings/ai/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  testAiProvider: (id: 'text' | 'vision' | 'embedding', overrides?: {
    provider?: AiProvider;
    apiFormat?: AiApiFormat;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }) =>
    request<AiTestResult>(`/settings/ai/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(overrides ?? {}),
    }),
  getAiUsage: (filter?: {
    scope?: 'text' | 'vision' | 'embedding';
    callKind?: 'review' | 'test' | 'dynamic';
    sessionId?: string;
    projectId?: string;
  }) => {
    const params = new URLSearchParams();
    if (filter?.scope) params.set('scope', filter.scope);
    if (filter?.callKind) params.set('callKind', filter.callKind);
    if (filter?.sessionId) params.set('sessionId', filter.sessionId);
    if (filter?.projectId) params.set('projectId', filter.projectId);
    const qs = params.toString();
    return request<{
      totals: { input: number; output: number; cacheRead: number; cacheCreation: number; calls: number };
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
    }>(`/settings/ai/usage${qs ? `?${qs}` : ''}`);
  },
  getReviewModelUsage: (projectId: string, sessionId: string) => {
    const params = new URLSearchParams({ scope: 'text', callKind: 'review', projectId, sessionId });
    return request<ReviewModelUsage>(`/settings/ai/usage?${params.toString()}`);
  },

  // Dynamic Sessions
  listDynamicSessions: (projectId: string) =>
    request<DynamicSession[]>(`/projects/${projectId}/dynamic-sessions`),
  createDynamicSession: (projectId: string, data: {
    targetUrl: string;
    goal: string;
    missionType: 'user_journey' | 'smoke';
    maxSteps?: number;
  }) =>
    request<DynamicSession>(`/projects/${projectId}/dynamic-sessions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDynamicSession: (projectId: string, sessionId: string) =>
    request<DynamicSession>(`/projects/${projectId}/dynamic-sessions/${sessionId}`),
  listDynamicEvidence: (projectId: string, sessionId: string) =>
    request<DynamicEvidence[]>(`/projects/${projectId}/dynamic-sessions/${sessionId}/evidence`),
  cancelDynamicSession: (projectId: string, sessionId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/dynamic-sessions/${sessionId}/cancel`, {
      method: 'POST',
    }),

  // Artifacts
  listArtifacts: (projectId: string) =>
    request<Artifact[]>(`/projects/${projectId}/artifacts`),
  getArtifactContent: (projectId: string, artifactId: string, versionId?: string) =>
    request<{ versionId: string; content: string; contentHash: string; mimeType: string | null }>(`/projects/${projectId}/artifacts/${artifactId}/content${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`),
  uploadArtifact: (projectId: string, data: { fileName: string; content: string; type?: string }) =>
    request<Artifact>(`/projects/${projectId}/artifacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importRepoArtifacts: (projectId: string, repoPath: string) =>
    request<{ imported: Artifact[]; skipped: string[] }>(`/projects/${projectId}/artifacts/import-repo`, {
      method: 'POST',
      body: JSON.stringify({ repoPath }),
    }),
  deleteArtifact: (projectId: string, artifactId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/artifacts/${artifactId}`, {
      method: 'DELETE',
    }),

  // Static Sessions
  listStaticSessions: (projectId: string) =>
    request<StaticSession[]>(`/projects/${projectId}/static-sessions`),
  listActiveStaticSessions: () =>
    request<StaticSession[]>('/static-sessions/active'),
  createStaticSession: (projectId: string, data: CreateStaticSessionPayload) =>
    request<StaticSession>(`/projects/${projectId}/static-sessions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getStaticSession: (projectId: string, sessionId: string) =>
    request<StaticSession>(`/projects/${projectId}/static-sessions/${sessionId}`),
  listStaticFindings: (projectId: string, sessionId: string) =>
    request<Finding[]>(`/projects/${projectId}/static-sessions/${sessionId}/findings`),
  cancelStaticSession: (projectId: string, sessionId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/static-sessions/${sessionId}/cancel`, {
      method: 'POST',
    }),
  retryStaticSession: (projectId: string, sessionId: string, data: { refreshSourceManifest?: boolean } = {}) =>
    request<StaticSession>(`/projects/${projectId}/static-sessions/${sessionId}/retry`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getReviewSourceManifest: (projectId: string, sessionId: string) =>
    request<ReviewSourceManifest>(`/projects/${projectId}/static-sessions/${sessionId}/source-manifest`),
  getReviewTraceability: (projectId: string, sessionId: string) =>
    request<ReviewTraceabilitySnapshot>(`/projects/${projectId}/static-sessions/${sessionId}/traceability`),
  getReviewEvidenceSufficiency: (projectId: string, sessionId: string) =>
    request<EvidenceSufficiencyAssessment>(`/projects/${projectId}/static-sessions/${sessionId}/evidence-sufficiency`),
  saveContradictionDisposition: (projectId: string, sessionId: string, contradictionId: string, data: { decision: EvidenceContradictionDisposition['decision']; rationale: string }) =>
    request<EvidenceContradictionDisposition>(`/projects/${projectId}/static-sessions/${sessionId}/contradictions/${contradictionId}`, { method: 'PUT', body: JSON.stringify(data) }),
  getReviewCorrelations: (projectId: string, sessionId: string) =>
    request<FindingCorrelationSnapshot>(`/projects/${projectId}/static-sessions/${sessionId}/correlations`),
  prepareReviewIteration: (projectId: string, sessionId: string, data: { sourceChoice: 'reuse' | 'refresh'; feedback?: string; idempotencyKey?: string }) =>
    request<StaticSession>(`/projects/${projectId}/static-sessions/${sessionId}/iterations`, { method: 'POST', body: JSON.stringify(data) }),
  startPreparedReviewIteration: (projectId: string, sessionId: string, data: { idempotencyKey?: string } = {}) =>
    request<StaticSession>(`/projects/${projectId}/static-sessions/${sessionId}/start`, { method: 'POST', body: JSON.stringify(data) }),

  // Review Decisions (P0-3)
  listReviewDecisions: (projectId: string, sessionId: string, limit = 50, offset = 0) =>
    request<DecisionServiceRecord[]>(
      `/projects/${projectId}/static-sessions/${sessionId}/decisions?limit=${limit}&offset=${offset}`
    ).then(records => records.map(normalizeDecision)),
  getReviewDecisionAttachmentDownload: (projectId: string, sessionId: string, decisionId: string, attachmentId: string) =>
    request<{ id: string; fileName: string; signedUrl: string; expiresAt: string }>(
      `/projects/${projectId}/static-sessions/${sessionId}/decisions/${decisionId}/attachments/${attachmentId}`
    ),
  submitReviewDecision: (
    projectId: string,
    sessionId: string,
    data: {
      decision: ReviewDecision;
      comment?: string;
      reviewer?: string;
      attachments?: ReviewDecisionAttachmentInput[];
      sourceChoice?: 'reuse' | 'refresh';
      idempotencyKey?: string;
    }
  ) =>
    request<DecisionServiceResponse>(
      `/projects/${projectId}/static-sessions/${sessionId}/decision`,
      { method: 'POST', body: JSON.stringify(data) }
    ).then(result => ({
      ...normalizeDecision(result.decision),
      ...(result.preparedChild ? { preparedChild: normalizePreparedReview(result.preparedChild), sourceChoice: data.sourceChoice } : {}),
    })),

  // Unified Findings
  listFindings: (projectId: string) =>
    request<Finding[]>(`/projects/${projectId}/findings`),
  getProjectAssessment: (projectId: string) =>
    request<ProjectAssessment>(`/projects/${projectId}/assessment`),
  updateFinding: (projectId: string, findingId: string, status: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/findings/${findingId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Reports
  exportProjectReport: (projectId: string) =>
    request<ProjectReportExportResult>(`/projects/${projectId}/reports/export`, {
      method: 'POST',
    }),
  listProjectReportHistory: (projectId: string) =>
    request<ProjectReportHistoryEntry[]>(`/projects/${projectId}/reports`),
  renewProjectReportLinks: (projectId: string, reportId: string) =>
    request<ProjectReportDownloadLinks>(`/projects/${projectId}/reports/${reportId}/links`, { method: 'POST' }),

  // Requirements
  listRequirements: (projectId: string) =>
    request<Requirement[]>(`/projects/${projectId}/requirements`),
  listRequirementCandidates: (projectId: string, status?: RequirementCandidate['status']) =>
    request<RequirementCandidate[]>(`/projects/${projectId}/requirement-candidates${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  extractRequirementCandidates: (projectId: string, artifactId: string, sourceVersion?: string) =>
    request<RequirementCandidate[]>(`/projects/${projectId}/requirement-candidates/extract`, { method: 'POST', body: JSON.stringify({ artifactId, sourceVersion }) }),
  confirmRequirementCandidate: (projectId: string, candidateId: string) =>
    request<Requirement>(`/projects/${projectId}/requirement-candidates/${candidateId}/confirm`, { method: 'POST', body: '{}' }),
  rejectRequirementCandidate: (projectId: string, candidateId: string) =>
    request<RequirementCandidate>(`/projects/${projectId}/requirement-candidates/${candidateId}/reject`, { method: 'POST', body: '{}' }),
  listStandardRules: (projectId: string) =>
    request<StandardRule[]>(`/projects/${projectId}/standards`),
  ingestStandardRules: (projectId: string, artifactId: string, data: { label?: string; sourceVersion?: string; standardVersion?: string } = {}) =>
    request<StandardRule[]>(`/projects/${projectId}/standards`, { method: 'POST', body: JSON.stringify({ artifactId, ...data }) }),
  setStandardRuleEnabled: (projectId: string, ruleId: string, enabled: boolean) =>
    request<StandardRule>(`/projects/${projectId}/standards/rules/${ruleId}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  createRequirement: (projectId: string, data: { title: string; description: string; category: string; priority: string }) =>
    request<Requirement>(`/projects/${projectId}/requirements`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRequirement: (projectId: string, reqId: string, data: Partial<Requirement>) =>
    request<Requirement>(`/projects/${projectId}/requirements/${reqId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteRequirement: (projectId: string, reqId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/requirements/${reqId}`, {
      method: 'DELETE',
    }),
  mapRequirement: (projectId: string, reqId: string, data: { fileId?: string; symbolId?: string; coverageStatus: string; confidence: number }) =>
    request<RequirementMapping>(`/projects/${projectId}/requirements/${reqId}/map`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listRequirementMappings: (projectId: string, reqId: string) =>
    request<RequirementMapping[]>(`/projects/${projectId}/requirements/${reqId}/mappings`),
};
