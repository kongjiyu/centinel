import type { Project, AiProviderSetting, AiTestResult } from '../types';

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
};
