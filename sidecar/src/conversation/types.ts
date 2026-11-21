export type ConversationReference = {
  reviewId?: string;
  autoTestId?: string;
  findingId?: string;
  testId?: string;
  artifactId?: string;
};

export type ConversationInput = {
  id: string;
  text: string;
  mode: 'code' | 'browser' | 'both';
  permission: 'ask' | 'auto' | 'bypass';
  references: ConversationReference[];
};

export type SavedConversationExplanation = {
  sections: Array<{
    title: string;
    summary?: string;
    facts?: Array<{ label: string; value: string }>;
    points?: string[];
    excerpt?: string;
    limitations?: string[];
    checks?: Array<{ test: string; check: string; expected?: string; observed?: string; verdict: string; runId?: string }>;
  }>;
  hasMore?: boolean;
};

export type ConversationRequest = {
  id: string;
  projectId: string;
  ownerId: string;
  revision: number;
  workerId?: string;
  leaseUntil?: string;
  createdAt: string;
  updatedAt: string;
  input: ConversationInput;
  inputHash: string;
  state: 'accepted' | 'planning' | 'awaiting_permission' | 'running' | 'completed' | 'failed' | 'paused' | 'interrupted' | 'cancelled';
  action?: 'explain' | 'suggest' | 'code' | 'browser' | 'clarify';
  reply?: string;
  explanation?: SavedConversationExplanation;
  replyFormat?: 'markdown';
  citations?: string[];
  context?: Array<{ id: string; hash: string; artifactId?: string; versionId?: string; unavailable?: boolean }>;
  recall?: { turns: number; status: 'loaded' | 'limited' | 'unavailable' };
  replyOrigin?: 'saved_recall' | 'saved_evidence';
  fallbackScope?: string[];
  fallbackReason?: 'browser_startup';
  scope?: string[];
  executionSources?: Array<{ id: string; versionId?: string; hash: string }>;
  verificationBindings?: Array<{ evidenceId: string; paths: string[]; criteriaHash: string }>;
  policyVersion: string;
  reviewId?: string;
  autoTestId?: string;
  failureStage?: 'context' | 'planning' | 'validation' | 'execution';
  error?: string;
  events: Array<{ stage: string; at: string; permission?: ConversationInput['permission'] }>;
};
