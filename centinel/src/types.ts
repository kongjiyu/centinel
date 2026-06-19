export type Project = {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
};

export type AiProvider = 'mimo' | 'gemini' | 'custom';
export type AiApiFormat = 'openai-compatible' | 'anthropic-compatible' | 'google-native';

export type AiProviderSetting = {
  id: 'text' | 'vision';
  label: string;
  provider: AiProvider;
  apiFormat: AiApiFormat;
  hasApiKey: boolean;
  apiKeyPreview: string;
  baseUrl: string;
  model: string;
  updatedAt: string;
};

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
  type: 'screenshot' | 'action_trace' | 'ai_request' | 'ai_response' | 'console_log' | 'debug_log' | 'session_summary';
  filePath: string;
  summary: string;
  createdAt: string;
};

export type ArtifactType = 'requirement' | 'design' | 'source_code' | 'coding_standard' | 'other';
export type ArtifactSource = 'documents' | 'repository' | 'drive';

export type Artifact = {
  id: string;
  projectId: string;
  type: ArtifactType;
  source: ArtifactSource;
  fileName: string;
  filePath: string;
  originalPath: string | null;
  contentHash: string;
  createdAt: string;
};

export type ReviewType = 'requirement_review' | 'code_review' | 'requirement_to_code_traceability' | 'cross_artifact_consistency';

export type StaticSessionStatus = 'queued' | 'running' | 'success' | 'failure' | 'cancelled';

export type StaticSession = {
  id: string;
  projectId: string;
  name: string;
  reviewType: ReviewType;
  status: StaticSessionStatus;
  configJson: string;
  progressJson: string;
  remarks: string;
  finalSummary: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

export type Finding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  source: 'static' | 'dynamic';
  severity: string;
  title: string;
  description: string;
  status: 'new' | 'accepted' | 'dismissed' | 'fixed';
  createdAt: string;
  artifactId: string | null;
  category: string;
  evidenceText: string;
  recommendation: string;
  confidence: string;
  fromRemarks: boolean;
};

export type ReviewProgress = {
  stage: string;
  message: string;
  steps: { label: string; status: 'pending' | 'active' | 'done' }[];
  startedAt: string;
  updatedAt: string;
};

export type ReviewArtifact = {
  id: string;
  sessionId: string;
  projectId: string;
  title: string;
  content: string;
  artifactType: string;
  createdAt: string;
};

export type Screen =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'project-detail'; projectId: string }
  | { name: 'dynamic-session'; projectId: string; sessionId: string }
  | { name: 'static-session'; projectId: string; sessionId: string }
  | { name: 'evidence-browser'; projectId: string }
  | { name: 'requirements'; projectId: string }
  | { name: 'settings' };

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
