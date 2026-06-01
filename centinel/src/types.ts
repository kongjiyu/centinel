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

export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'settings' };
