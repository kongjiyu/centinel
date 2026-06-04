import type { Project, AiProviderSetting, AiTestResult, DynamicSession, DynamicEvidence, Artifact, StaticSession, Finding, ReviewArtifact } from '../types';

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
    compatibilityMode: 'openai' | 'anthropic';
    apiKey: string;
    baseUrl: string;
    model: string;
  }) =>
    request<AiProviderSetting>(`/settings/ai/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  testAiProvider: (id: 'text' | 'vision') =>
    request<AiTestResult>(`/settings/ai/${id}/test`, { method: 'POST' }),

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
  createStaticSession: (projectId: string, data: {
    name: string;
    reviewType: string;
    artifactIds: string[];
    remarks?: string;
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
    request<{ reportPath: string }>(`/projects/${projectId}/reports/export`, {
      method: 'POST',
    }),
};
