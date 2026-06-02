export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type AiCompatibilityMode = 'openai' | 'anthropic';

export type AiProviderSetting = {
  id: 'text' | 'vision';
  label: string;
  compatibilityMode: AiCompatibilityMode;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  updatedAt: string;
};

export type AiTestResult = {
  status: string;
  message?: string;
  raw?: string;
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
  type: 'screenshot' | 'action_trace' | 'ai_response' | 'console_log' | 'session_summary';
  filePath: string;
  summary: string;
  createdAt: string;
};

export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'settings' };
