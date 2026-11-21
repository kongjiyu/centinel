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
  /** Optional display names, aligned with references. Never used to resolve evidence. */
  referenceLabels?: Array<string | null>;
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
  replyFormat?: 'markdown';
  citations?: string[];
  /** Names derived from authorized, reference-bound evidence, aligned with input.references. */
  resolvedAttachmentNames?: Array<string | null>;
  recall?: { status: "recalled" | "missing" | "unavailable"; turns: 0 | 1 };
  context?: Array<{ id: string; hash: string; artifactId?: string; versionId?: string; unavailable?: boolean }>;
  scope?: string[];
  executionSources?: Array<{ id: string; versionId?: string; hash: string }>;
  verificationBindings?: Array<{ evidenceId: string; paths: string[]; criteriaHash: string }>;
  policyVersion: string;
  reviewId?: string;
  autoTestId?: string;
  error?: string;
  events: Array<{ stage: string; at: string; permission?: ConversationInput['permission'] }>;
};
