import type {EvidenceCopy} from '../../../sidecar/src/dynamic/sharedEvidence/types';
import type {DynamicFinding,FindingDetail,ReviewFindingInput,RemediationInput} from '../../../sidecar/src/dynamic/findings/types';
import type { DynamicRun, Mission, MissionInput, MissionRevision, EnvironmentInput, EnvironmentProfile, EnvironmentSnapshot, EnvironmentData, WorkspaceAuthorization, WorkspaceInspection, HookOperation, HookKind } from '../dynamic/types';
import type { Project, CollaborationStatus, CollaboratorSearchResult, CollaboratorInviteResult, GithubCollaboratorSnapshot, AiProviderSetting, AiProvider, AiApiFormat, AiTestResult, DynamicSession, DynamicEvidence, Artifact, StaticSession, Finding, ReviewSourceManifest, ReviewTraceabilitySnapshot, ProjectAssessment, Requirement, RequirementMapping, ReviewDecisionRecord, ReviewDecision, ReviewDecisionAttachmentInput, ReviewModelUsage, ReviewScopeSelection, IntegrationProvider, ConnectedSource, ConnectedSourceStatusResult, ConnectedSourceBrowsePage, ConnectedSourceSyncResult, ConnectedSourceSyncRun, EvidenceSufficiencyAssessment, EvidenceContradictionDisposition, FindingCorrelationSnapshot, RequirementCandidate, StandardRule } from '../types';

import { SIDECAR_BASE_URL } from './transport';
import type { EmbeddingSettingsCatalog } from '../types';
const BASE = SIDECAR_BASE_URL;
const GET_REQUEST_TIMEOUT_MS = 30_000;

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

// Coalesce simultaneous identical reads (StrictMode, parent/child panels).
// Entries exist only while in flight; navigation and explicit refresh still
// read fresh data. Credentials are part of the identity, never logged.
const pendingReads = new Map<string, Promise<unknown>>();

function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (init) return sendRequest<T>(path, init);
  const key = JSON.stringify([path,
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('centinel:supabase-access-token') : null,
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('centinel:supabase-user-id') : null,
  ]);
  const existing = pendingReads.get(key);
  if (existing) return existing as Promise<T>;
  const pending = sendRequest<T>(path);
  pendingReads.set(key, pending);
  const clear = () => { if (pendingReads.get(key) === pending) pendingReads.delete(key); };
  void pending.then(clear, clear);
  return pending;
}

async function sendRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
  const url = `${BASE}${path}`;
  const isGet = (init?.method ?? 'GET').trim().toUpperCase() === 'GET';
  if (!isGet) return readResponse<T>(await fetch(url, { ...init, headers }));

  const callerSignal = init?.signal;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let callerAbortHandler: (() => void) | undefined;
  let rejectCallerAbort: ((reason?: unknown) => void) | undefined;
  const callerAbort = callerSignal ? new Promise<never>((_, reject) => {
    rejectCallerAbort = reject;
    callerAbortHandler = () => {
      const reason = callerSignal.reason ?? abortError();
      controller.abort(reason);
      rejectCallerAbort?.(reason);
    };
    if (callerSignal.aborted) callerAbortHandler();
    else callerSignal.addEventListener('abort', callerAbortHandler, { once: true });
  }) : undefined;
  const operation = callerSignal?.aborted
    ? Promise.reject(callerSignal.reason ?? abortError())
    : (async () => {
      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      return readResponse<T>(res, controller.signal);
    })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ApiError('The request timed out. Please retry.', 504, 'request_timeout');
      reject(error);
      controller.abort(error);
    }, GET_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race(callerAbort ? [operation, timeout, callerAbort] : [operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (callerSignal && callerAbortHandler) callerSignal.removeEventListener('abort', callerAbortHandler);
  }
}

function abortError(): Error {
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}

async function readResponse<T>(res: Response, signal?: AbortSignal): Promise<T> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    // Empty responses are still represented by the HTTP status below. This
    // keeps lifecycle/auth errors actionable when a proxy closes early.
  }
  if (!res.ok) {
    const payload = json && typeof json === 'object' ? json as { error?: unknown; code?: unknown } : {};
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`;
    const code = typeof payload.code === 'string' ? payload.code : null;
    if (res.status === 401 && code === 'unauthenticated' && typeof window !== 'undefined') {
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
  /** Links an explicitly submitted fresh-scope Review to a comparable completed parent. */
  comparisonParentReviewId?: string;
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

async function downloadReport(endpoint:string,id:string,format:'json'|'markdown'|'pdf'){
    const token=sessionStorage.getItem('centinel:supabase-access-token');const response=await fetch(`${BASE}${endpoint}`,{cache:'no-store',signal:AbortSignal.timeout(30000),headers:token?{Authorization:`Bearer ${token}`}:{}});if(!response.ok)throw new ApiError('Report export is unavailable for this account.',response.status);
    const bound=8*1024*1024;const reader=response.body?.getReader();if(!reader)throw Error('Report body unavailable.');const chunks:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>bound)throw Error('Report export exceeds the download bound.');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return {bytes,sha256:response.headers.get('X-Centinel-SHA256')??'',filename:`centinel-dynamic-${id}.${format==='markdown'?'md':format}`,mimeType:response.headers.get('Content-Type')??'application/octet-stream'};
}
export const api = {
  getReviewHarness: (projectId: string, sessionId: string) =>
    request<import('../reviewHarness').ReviewHarnessTrace>(`/projects/${encodeURIComponent(projectId)}/static-sessions/${encodeURIComponent(sessionId)}/harness`),
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
  codexModels: () => request<{ id: string; label: string; supportsImages: boolean; isDefault: boolean; imageSupportKnown?: boolean; catalogSource?: 'account' | 'codex'; catalogWarning?: 'account_catalog_unavailable' }[]>('/settings/codex/models'),
  testCodex: (model: string, vision = false) => request<{ status: 'pass' | 'fail'; message: string }>('/settings/codex/test', { method: 'POST', body: JSON.stringify({ model, vision }) }),
  aiSettings: () => request<AiProviderSetting[]>('/settings/ai'),
  embeddingModels: () => request<EmbeddingSettingsCatalog>('/settings/ai/embedding/models'),
  updateAiSetting: (id: 'text' | 'vision' | 'embedding', data: {
    provider: AiProvider;
    apiFormat: AiApiFormat;
    apiKey: string;
    baseUrl: string;
    model: string;
    embeddingProvider?: 'voyage' | 'custom';
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
      totals: { input: number; output: number; cacheRead: number; cacheCreation: number; calls: number;
        totalTokens?: number; unknownTotalCalls?: number; unknownInputCalls?: number; unknownOutputCalls?: number;
        unknownCacheReadCalls?: number; unknownCacheCreationCalls?: number;
        assumedZeroNoResponseCalls?: number; assumedZeroNoResponseTokens?: number; accountedTokens?: number };
      byGroup: Array<{
        provider: AiProvider;
        apiFormat: AiApiFormat;
        model: string;
        totalInput: number;
        totalOutput: number;
        totalCacheRead: number;
        totalCacheCreation: number;
        totalCalls: number;
        unknownInputCalls?: number; unknownOutputCalls?: number; unknownCacheReadCalls?: number; unknownCacheCreationCalls?: number;
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
        outcome?: 'in_progress' | 'success' | 'retryable_error' | 'permanent_error' | 'malformed_response' | 'cancelled' | null;
        errorCode?: string | null;
        durationMs?: number | null;
        responseReceived?: boolean | null;
        usageObservation?: { source: string; completeness: 'complete' | 'partial'; missingCounters?: string[] } | null;
        accountingBasis?: 'assumed_zero_no_response' | null;
        accountedTokens?: number | null;
      }>;
    }>(`/settings/ai/usage${qs ? `?${qs}` : ''}`);
  },
  getReviewModelUsage: (projectId: string, sessionId: string) => {
    const params = new URLSearchParams({ callKind: 'review', projectId, sessionId });
    return request<ReviewModelUsage>(`/settings/ai/usage?${params.toString()}`);
  },
  getProjectReadiness: (projectId: string) => request<ProjectReadinessStatus>(`/projects/${projectId}/readiness`),
  startProjectReadiness: (projectId: string) => request<ProjectReadinessStatus>(`/projects/${projectId}/readiness`, { method: 'POST', body: JSON.stringify({ trigger: 'manual' }) }),

  // Versioned Dynamic missions and independently checked runs.
  dynamicReports:(project:string,run:string)=>request<import('../../../sidecar/src/dynamic/reports/types').DynamicReportSummary[]>(`/projects/${project}/dynamic/runs/${run}/reports`),
  captureDynamicReport:(project:string,run:string,reportId:string)=>request<import('../../../sidecar/src/dynamic/reports/types').DynamicReportSnapshot>(`/projects/${project}/dynamic/runs/${run}/reports`,{method:'POST',body:JSON.stringify({reportId})}),
  dynamicReport:(project:string,id:string)=>request<import('../../../sidecar/src/dynamic/reports/types').DynamicReportSnapshot>(`/projects/${project}/dynamic/reports/${id}`),
  dynamicReportExport:(project:string,id:string,format:'json'|'markdown'|'pdf')=>downloadReport(`/projects/${project}/dynamic/reports/${id}/${format}`,id,format),
  unitRuns:(project:string,profile:string)=>request<import('../../../sidecar/src/dynamic/unit/types').DynamicUnitRun[]>(`/projects/${project}/dynamic/environments/${profile}/unit-runs`),
  startUnitRun:(project:string,profile:string,idempotencyKey:string,timeoutMs:number)=>request<import('../../../sidecar/src/dynamic/unit/types').DynamicUnitRun>(`/projects/${project}/dynamic/environments/${profile}/unit-runs`,{method:'POST',body:JSON.stringify({idempotencyKey,timeoutMs})}),
  cancelUnitRun:(project:string,profile:string,id:string)=>request<import('../../../sidecar/src/dynamic/unit/types').DynamicUnitRun>(`/projects/${project}/dynamic/environments/${profile}/unit-runs/${id}/cancel`,{method:'POST',body:'{}'}),
  unitReports:(project:string,run:string)=>request<import('../../../sidecar/src/dynamic/unit/reports').UnitReportSnapshot['metadata'][]>(`/projects/${project}/dynamic/unit-runs/${run}/reports`),
  captureUnitReport:(project:string,run:string,reportId:string)=>request<import('../../../sidecar/src/dynamic/unit/reports').UnitReportSnapshot>(`/projects/${project}/dynamic/unit-runs/${run}/reports`,{method:'POST',body:JSON.stringify({reportId})}),
  unitReportExport:(project:string,id:string,format:'json'|'markdown'|'pdf')=>downloadReport(`/projects/${project}/dynamic/unit-reports/${id}/${format}`,id,format),
  dynamicMissions: (projectId: string) => request<Mission[]>(`/projects/${projectId}/dynamic/missions`),
  dynamicRevision: (projectId: string, revisionId: string) => request<MissionRevision>(`/projects/${projectId}/dynamic/revisions/${revisionId}`),
  saveDynamicMission: (projectId: string, data: MissionInput & { contextScenario?: string }, missionId?: string) => request<MissionRevision>(`/projects/${projectId}/dynamic/missions${missionId ? `/${missionId}/revisions` : ''}`, { method: 'POST', body: JSON.stringify(data) }),
  dynamicRunArtifacts:(projectId:string,runId:string)=>request<import('../../../sidecar/src/dynamic/sharedEvidence/artifacts').RunArtifact[]>(`/projects/${projectId}/dynamic/runs/${runId}/evidence/artifacts`),
  shareDynamicRunArtifacts:(projectId:string,runId:string)=>request<{artifacts:import('../../../sidecar/src/dynamic/sharedEvidence/artifacts').RunArtifact[];copies:EvidenceCopy[];omitted:Array<{slot:string;reason:string}>}>(`/projects/${projectId}/dynamic/runs/${runId}/evidence/artifacts`,{method:'POST',body:'{}'}),
  dynamicEvidenceCopies:(projectId:string,runId:string)=>request<EvidenceCopy[]>(`/projects/${projectId}/dynamic/runs/${runId}/evidence`),
  syncDynamicEvidence:(projectId:string,runId:string)=>request<EvidenceCopy[]>(`/projects/${projectId}/dynamic/runs/${runId}/evidence/sync`,{method:'POST',body:'{}'}),
  deleteDynamicEvidenceCopy:(projectId:string,runId:string,id:string)=>request<EvidenceCopy>(`/projects/${projectId}/dynamic/runs/${runId}/evidence/${id}/delete`,{method:'POST',body:'{}'}),
  dynamicRecordedEvidenceBlob:async(projectId:string,runId:string,id:string,source:'local'|'shared'):Promise<Blob>=>{
    const token=sessionStorage.getItem('centinel:supabase-access-token');const suffix=source==='local'?`local/${id}`:`${id}/content`;
    const response=await fetch(`${BASE}/projects/${projectId}/dynamic/runs/${runId}/evidence/${suffix}`,{cache:'no-store',headers:token?{Authorization:`Bearer ${token}`}:{}});if(!response.ok)throw new ApiError('Recorded evidence is unavailable for this account or device.',response.status);return response.blob();
  },
  dynamicFindings:(projectId:string)=>request<DynamicFinding[]>(`/projects/${projectId}/dynamic/findings`),
  dynamicFinding:(projectId:string,id:string)=>request<FindingDetail>(`/projects/${projectId}/dynamic/findings/${id}`),
  collectDynamicFindings:(projectId:string,runId:string)=>request<DynamicFinding[]>(`/projects/${projectId}/dynamic/runs/${runId}/findings`,{method:'POST',body:'{}'}),
  reviewDynamicFinding:(projectId:string,id:string,input:ReviewFindingInput)=>request<DynamicFinding>(`/projects/${projectId}/dynamic/findings/${id}/review`,{method:'POST',body:JSON.stringify(input)}),
  remediateDynamicFinding:(projectId:string,id:string,input:RemediationInput)=>request<DynamicFinding>(`/projects/${projectId}/dynamic/findings/${id}/remediation`,{method:'POST',body:JSON.stringify(input)}),
  dynamicRuns: (projectId: string) => request<DynamicRun[]>(`/projects/${projectId}/dynamic/runs`),
  startDynamicRun: (projectId: string, revisionId: string, idempotencyKey: string, environmentId?: string, baselineRunId?:string) => request<DynamicRun>(`/projects/${projectId}/dynamic/runs`, { method: 'POST', body: JSON.stringify({ revisionId, idempotencyKey, ...(environmentId ? {environmentId} : {}),...(baselineRunId?{baselineRunId}:{}) }) }),
  stopDynamicRun: (projectId: string, runId: string) => request<DynamicRun>(`/projects/${projectId}/dynamic/runs/${runId}/cancel`, { method: 'POST', body: '{}' }),
  dynamicEvidenceBlob: async (filePath: string): Promise<Blob> => {
    const token = sessionStorage.getItem('centinel:supabase-access-token');
    const response = await fetch(`${BASE}/evidence-file?path=${encodeURIComponent(filePath)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new ApiError('This screenshot is unavailable on this device.', response.status);
    return response.blob();
  },

  dynamicEnvironments: (projectId: string) => request<EnvironmentProfile[]>(`/projects/${projectId}/dynamic/environments`),
  saveDynamicEnvironment: (projectId: string, data: EnvironmentInput, id?: string) => request<EnvironmentProfile>(`/projects/${projectId}/dynamic/environments${id ? `/${id}` : ''}`, {method:'POST',body:JSON.stringify(data)}),
  dynamicHooks: (projectId:string,id:string) => request<HookOperation[]>(`/projects/${projectId}/dynamic/environments/${id}/hooks`),
  startDynamicHook: (projectId:string,id:string,kind:HookKind,idempotencyKey:string) => request<HookOperation>(`/projects/${projectId}/dynamic/environments/${id}/hooks`,{method:'POST',body:JSON.stringify({kind,idempotencyKey})}),
  cancelDynamicHook: (projectId:string,id:string,operationId:string) => request<HookOperation>(`/projects/${projectId}/dynamic/environments/${id}/hooks/${operationId}/cancel`,{method:'POST',body:'{}'}),
  dynamicHookOutput: (projectId:string,id:string,operationId:string) => request<{availability:string;partial?:boolean;output?:string;result?:HookOperation['result'];reason?:string;sha256?:string}>(`/projects/${projectId}/dynamic/environments/${id}/hooks/${operationId}/output`),
  dynamicWorkspace: (projectId:string,id:string) => request<{authorization:WorkspaceAuthorization|null}>(`/projects/${projectId}/dynamic/environments/${id}/workspace`),
  inspectDynamicWorkspace: (projectId:string,id:string,directory:string) => request<{inspection:WorkspaceInspection}>(`/projects/${projectId}/dynamic/environments/${id}/workspace`,{method:'POST',body:JSON.stringify({operation:'inspect',directory})}),
  authorizeDynamicWorkspace: (projectId:string,id:string,data:Omit<WorkspaceAuthorization,'fingerprint'|'authorizedAt'>&{allowScripts:boolean;expectedFingerprint:string}) => request<{authorization:WorkspaceAuthorization}>(`/projects/${projectId}/dynamic/environments/${id}/workspace`,{method:'POST',body:JSON.stringify({operation:'authorize',...data})}),
  dynamicSession: (projectId:string,id:string) => request<{session:{availability:string;reference?:string;expiresAt?:string;reason?:string;version?:string};capture:import('../dynamic/types').SessionCaptureStatus|null}>(`/projects/${projectId}/dynamic/environments/${id}/session`),
  changeDynamicSession: (projectId:string,id:string,data:Record<string,unknown>) => {const endpoint=new URL(BASE);if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new ApiError('Signed-in sessions require a loopback Centinel service on this device.',400);return request<unknown>(`/projects/${projectId}/dynamic/environments/${id}/session`,{method:'POST',body:JSON.stringify(data)});},
  dynamicEnvironmentData: (projectId: string,id: string) => request<EnvironmentData>(`/projects/${projectId}/dynamic/environments/${id}/data`),
  recordDynamicEnvironmentData: (projectId:string,id:string,kind:'preparation'|'cleanup',outcome:'completed'|'failed',note:string) => request<EnvironmentData>(`/projects/${projectId}/dynamic/environments/${id}/${kind}`,{method:'POST',body:JSON.stringify({outcome,note})}),
  dynamicEnvironmentValues: (projectId: string, id: string) => request<{variableNames:string[]}>(`/projects/${projectId}/dynamic/environments/${id}/values`),
  saveDynamicEnvironmentValues: (projectId: string, id: string, values: Record<string,string>) => request<{variableNames:string[]}>(`/projects/${projectId}/dynamic/environments/${id}/values`, {method:'POST',body:JSON.stringify({values})}),
  saveDynamicPrivateInputs: (projectId:string,id:string,version:number,grants:import('../../../sidecar/src/dynamic/browser/privateInputs').PrivateInputGrant[]) => request<EnvironmentProfile>(`/projects/${projectId}/dynamic/environments/${id}/private-inputs`,{method:'POST',body:JSON.stringify({version,grants})}),
  saveDynamicDownloadPermissions: (projectId:string,id:string,version:number,downloads:import('../../../sidecar/src/dynamic/browser/fileTypes').DownloadGrant[]) => request<EnvironmentProfile>(`/projects/${projectId}/dynamic/environments/${id}/downloads`,{method:'POST',body:JSON.stringify({version,downloads})}),
  dynamicDownloadedFiles: (projectId:string,runId:string) => request<import('../../../sidecar/src/dynamic/environment/downloadVault').LocalDownload[]>(`/projects/${projectId}/dynamic/runs/${runId}/downloads`),
  getDynamicDownloadedFile: (projectId:string,runId:string,id:string) => {const endpoint=new URL(BASE);if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new ApiError('Downloaded copies require the local Centinel service on this device.',400);return request<import('../../../sidecar/src/dynamic/environment/downloadVault').LocalDownload&{base64:string}>(`/projects/${projectId}/dynamic/runs/${runId}/downloads/${id}`);},
  forgetDynamicDownloadedFile: (projectId:string,runId:string,id:string) => request<{availability:string}>(`/projects/${projectId}/dynamic/runs/${runId}/downloads/${id}`,{method:'DELETE'}),
  dynamicUploadFixtures: (projectId:string,id:string) => request<import('../../../sidecar/src/dynamic/browser/fileTypes').LocalUploadFixture[]>(`/projects/${projectId}/dynamic/environments/${id}/uploads`),
  saveDynamicUploadFixture: (projectId:string,id:string,data:{name:string;mimeType:string;base64:string;publicTestData:true}) => {const endpoint=new URL(BASE);if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.pathname!=='/'||endpoint.search||endpoint.hash)throw new ApiError('Test files require a loopback Centinel service on this device.',400);return request<import('../../../sidecar/src/dynamic/browser/fileTypes').LocalUploadFixture>(`/projects/${projectId}/dynamic/environments/${id}/uploads`,{method:'POST',body:JSON.stringify(data)});},
  forgetDynamicUploadFixture: (projectId:string,id:string,fixtureId:string) => request<{availability:string}>(`/projects/${projectId}/dynamic/environments/${id}/uploads/${fixtureId}`,{method:'DELETE'}),
  saveDynamicUploadPermissions: (projectId:string,id:string,version:number,uploads:import('../../../sidecar/src/dynamic/browser/fileTypes').UploadGrant[]) => request<EnvironmentProfile>(`/projects/${projectId}/dynamic/environments/${id}/uploads/permissions`,{method:'POST',body:JSON.stringify({version,uploads})}),
  preflightDynamicEnvironment: (projectId: string, id: string) => request<EnvironmentSnapshot>(`/projects/${projectId}/dynamic/environments/${id}/preflight`, {method:'POST',body:'{}'}),

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
  getSourceIndexStatus: (projectId: string, signal?: AbortSignal) =>
    request<import('../types').SourceIndexStatus>(`/projects/${encodeURIComponent(projectId)}/repository-index/build`, { signal }),
  resumeSourceIndex: (projectId: string) =>
    request<import('../types').SourceIndexStatus>(`/projects/${encodeURIComponent(projectId)}/repository-index/build`, { method: 'POST', body: '{}' }),
  listArtifacts: (projectId: string) =>
    request<Artifact[]>(`/projects/${projectId}/artifacts`),
  syncRepositoryIndex: (projectId: string, signal?: AbortSignal) =>
    request<{ state: 'none' | 'available' | 'prefetched' | 'unchanged' | 'incompatible'; fingerprint?: string; archiveSha256?: string }>(
      `/projects/${encodeURIComponent(projectId)}/repository-index/sync`, { method: 'POST', body: '{}', signal }),
  getSourcePresence: (projectId: string) =>
    request<{ hasSources: boolean }>(`/projects/${projectId}/artifacts?view=presence`).then(result => {
      if (!result || typeof result.hasSources !== 'boolean') {
        throw new ApiError('Restart the local development service to load project source status.', 503, 'sidecar_update_required');
      }
      return result;
    }),
  getArtifactContent: (projectId: string, artifactId: string, versionId?: string) =>
    request<{ versionId: string; content: string; contentHash: string; mimeType: string | null; textContent?: string; textExtraction?: { policy: string; pageCount: number; limitations: string[] } }>(`/projects/${projectId}/artifacts/${artifactId}/content${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`),
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
  listStaticSessions: (projectId: string, options?: { summary?: boolean }) =>
    request<StaticSession[]>(`/projects/${projectId}/static-sessions${options?.summary ? '?view=summary' : ''}`),
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
  retryStaticSession: (projectId: string, sessionId: string, data: { refreshSourceManifest?: boolean; idempotencyKey?: string; reuseValidatedBatches?: boolean } = {}) =>
    request<StaticSession>(`/projects/${projectId}/static-sessions/${sessionId}/retry`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getReviewSourceManifest: (projectId: string, sessionId: string) =>
    request<ReviewSourceManifest>(`/projects/${projectId}/static-sessions/${sessionId}/source-manifest`),
  getReviewArtifactContent: (projectId: string, sessionId: string, artifactId: string) =>
    request<{ versionId: string; content: string; contentHash: string; mimeType: string | null; textContent?: string; textExtraction?: { policy: string; pageCount: number; limitations: string[] } }>(`/projects/${projectId}/static-sessions/${sessionId}/source-artifacts/${artifactId}/content`),
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
import type { ProjectReadinessStatus } from '../types';
