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
  replyToTurnId?: string;
  /** Optional display names, aligned with references. Never used to resolve evidence. */
  referenceLabels?: Array<string | null>;
};

export type SavedConversationExplanation = {
  sections: Array<{
    evidenceId?: string;
    title: string;
    summary?: string;
    facts?: Array<{ label: string; value: string }>;
    points?: string[];
    excerpt?: string;
    sourceWindow?: { text: string; firstLine: number; citedLine: number };
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
  /** Names derived from authorized, reference-bound evidence, aligned with input.references. */
  resolvedAttachmentNames?: Array<string | null>;
  context?: Array<{ id: string; hash: string; artifactId?: string; versionId?: string; unavailable?: boolean }>;
  recall?: { turns: number; status: 'loaded' | 'limited' | 'unavailable' | 'recalled' | 'missing' };
  replyTo?: { turnId: string; status: 'resolved' | 'unavailable' };
  replyOrigin?: 'saved_recall' | 'saved_evidence';
  answerUnavailable?: boolean;
  questionOptions?: string[];
  selectedOption?: number;
  reviewContinuation?: { question: string; sourceRequestId?: string; text?: string };
  fallbackScope?: string[];
  fallbackReason?: 'browser_startup';
  scope?: string[];
  executionSources?: Array<{ id: string; versionId?: string; hash: string }>;
  verificationBindings?: Array<{ evidenceId: string; paths: string[]; criteriaHash: string }>;
  policyVersion: string;
  reviewId?: string;
  autoTestId?: string;
  failureStage?: 'context' | 'planning' | 'validation' | 'execution';
  validationReason?: 'response_format' | 'citation_missing' | 'citation_unknown' | 'quote_unmatched' | 'outcome_unverified'
    | 'scope_unbound' | 'mode_conflict' | 'evidence_unavailable' | 'current_evidence_required' | 'question_options';
  failureReason?: 'context_limit' | 'missing_reference' | 'browser_startup' | 'assessment_hold' | 'provider_paused';
  error?: string;
  events: Array<{ stage: string; at: string; permission?: ConversationInput['permission'] }>;
};
