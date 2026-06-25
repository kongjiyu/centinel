import type { Project, AiProviderSetting, AiProvider, AiApiFormat, AiTestResult, DynamicSession, DynamicEvidence, Artifact, StaticSession, Finding, ReviewArtifact, Requirement, RequirementMapping, ReviewDecisionRecord, ReviewDecision } from '../types';

const BASE = 'http://localhost:37701';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  // Projects
  projects: () => request<Project[]>('/projects'),
  project: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (name: string, description: string, workspacePath: string) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description, workspacePath }),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  // AI Settings
  aiSettings: () => request<AiProviderSetting[]>('/settings/ai'),
  updateAiSetting: (id: 'text' | 'vision', data: {
    provider: AiProvider;
    apiFormat: AiApiFormat;
    apiKey: string;
    baseUrl: string;
    model: string;
  }) =>
    request<AiProviderSetting>(`/settings/ai/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  testAiProvider: (id: 'text' | 'vision', overrides?: {
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
    scope?: 'text' | 'vision';
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
        scope: 'text' | 'vision';
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
  exportDynamicSessionReport: (projectId: string, sessionId: string) =>
    request<{ reportPath: string; markdown: string }>(`/projects/${projectId}/dynamic-sessions/${sessionId}/report`, {
      method: 'POST',
    }),

  // Artifacts
  listArtifacts: (projectId: string) =>
    request<Artifact[]>(`/projects/${projectId}/artifacts`),
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
  getIndexStatus: (projectId: string) =>
    request<{ status: string; fileCount: number; error?: string }>(`/projects/${projectId}/index/status`),
  deleteArtifact: (projectId: string, artifactId: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/artifacts/${artifactId}`, {
      method: 'DELETE',
    }),

  // Static Sessions
  listStaticSessions: (projectId: string) =>
    request<StaticSession[]>(`/projects/${projectId}/static-sessions`),
  listActiveStaticSessions: () =>
    request<StaticSession[]>('/static-sessions/active'),
  createStaticSession: (projectId: string, data: {
    name: string;
    instructions: string;
  }) =>
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
  exportSessionReport: (projectId: string, sessionId: string) =>
    request<{ reportPath: string }>(`/projects/${projectId}/static-sessions/${sessionId}/report`, {
      method: 'POST',
    }),
  listReviewArtifacts: (projectId: string, sessionId: string) =>
    request<ReviewArtifact[]>(`/projects/${projectId}/static-sessions/${sessionId}/artifacts`),

  // Review Decisions (P0-3)
  listReviewDecisions: (projectId: string, sessionId: string) =>
    request<ReviewDecisionRecord[]>(
      `/projects/${projectId}/static-sessions/${sessionId}/decisions`
    ),
  submitReviewDecision: (
    projectId: string,
    sessionId: string,
    data: { decision: ReviewDecision; comment?: string; reviewer?: string }
  ) =>
    request<ReviewDecisionRecord>(
      `/projects/${projectId}/static-sessions/${sessionId}/decision`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // Unified Findings
  listFindings: (projectId: string) =>
    request<Finding[]>(`/projects/${projectId}/findings`),
  updateFinding: (projectId: string, findingId: string, status: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/findings/${findingId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Reports
  exportProjectReport: (projectId: string) =>
    request<{ reportPath: string; markdown: string }>(`/projects/${projectId}/reports/export`, {
      method: 'POST',
    }),

  // Requirements
  listRequirements: (projectId: string) =>
    request<Requirement[]>(`/projects/${projectId}/requirements`),
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
