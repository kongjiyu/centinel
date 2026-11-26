export type ConversationReference = {
  checkId?: string;
  checkFocus?: string;
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

export type SavedConversationProblem = {
  kind: 'code' | 'browser';
  title: string;
  reviewId?: string;
  domain?: string;
  sourceReferences?: Array<{ artifactId?: string | null; filePath: string; lineNumber?: number | null; sourceVersion?: string | null; excerpt?: string; relation: 'code' | 'document' | 'requirement' }>;
  category?: string;
  severity?: string;
  priority?: string | null;
  risk?: 'critical' | 'high' | 'medium' | 'low' | null;
  originalStatus?: string;
  currentStatus?: string;
  currentStatusUnavailable?: boolean;
  location?: string;
  lineNumber?: number;
  description?: string;
  recommendation?: string;
  excerpt?: string;
  sourceWindow?: { text: string; firstLine: number; citedLine: number };
  evidenceUnavailable?: boolean;
  browserChecks?: Array<{ expected: string; observed: string }>;
  browserCoverage?: 'stopped' | 'partial';
  /** False when an incomplete or unconfirmed run has observations but no saved Browser proof. */
  browserProof?: boolean;
  browserEvidenceAttempt?: 'current' | 'earlier';
  aiExplanationFromEarlier?: boolean;
  aiExplanationRunId?: string;
  firstAttempt?: { runId?: string; state?: string; browserChecks?: Array<{ expected: string; observed: string }>; aiExplanation?: string };
  aiExplanation?: string;
  runId?: string;
  findingId?: string;
  testId?: string;
};

export type SavedConversationCheck = {
  mode: 'code' | 'browser' | 'both';
  objective?: string;
  objectiveUnavailable?: boolean;
  code?: {
    objective?: string;
    status?: string;
    coverageIncomplete?: boolean;
    summary?: string;
    scopeMode?: 'full' | 'focused';
    sourceCount?: number | null;
    sourceScope?: string[];
    problems?: SavedConversationProblem[];
    problemCount?: number | null;
    moreProblems?: number;
    modules?: Array<{ module: string; files: string[]; inferred: true }>;
    affectedFiles?: string[];
    coverage?: string[];
    requirements?: Array<{ id: string; title: string; state: string }>;
    requirementsUnavailable?: boolean;
    qualityEvidence?: Array<{ quality: string; impact: string; path?: string }>;
  };
  browser?: {
    status?: string;
    objective?: string;
    testCount?: number | null;
    testCountPartial?: boolean;
    provenProblemCount?: number | null;
    failedAssertionCount?: number | null;
    assertionCountPartial?: boolean;
    passedTestCount?: number | null;
    testsWithoutVerdict?: number | null;
    sourceScope?: string[];
    tests?: Array<{ id: string; name: string; state: string; runId?: string; checks: Array<{ check: string; expected?: string; observed?: string; verdict: string }>; explanation?: string; explanationFromEarlier?: boolean; explanationRunId?: string; browserProof?: boolean; browserCoverage?: 'stopped' | 'partial'; evidenceAttempt?: 'current' | 'earlier'; earlierAttempt?: { runId?: string; checks: Array<{ check: string; expected?: string; observed?: string; verdict: string }>; explanation?: string } }>;
    moreTests?: number;
  };
};

export type SavedConversationExplanation = {
  sections: Array<{
    evidenceId?: string;
    presentation?: 'problem' | 'check' | 'code' | 'browser';
    originalBrowserRunId?: string;
    problem?: SavedConversationProblem;
    check?: SavedConversationCheck;
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

export type ConversationQuestionAnswer = {
  kind: 'option' | 'custom';
  text: string;
  selectedOption?: number;
  automatic: boolean;
  answeredAt: string;
};

export type ConversationQuestion = {
  id: string;
  createdAt: string;
  text: string;
  options: string[];
  answer?: ConversationQuestionAnswer;
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
  /** Clarifications and answers stay together on this original request. */
  questions?: ConversationQuestion[];
  /** The one unanswered question, indexed for cross-project queue reads. */
  pendingQuestionId?: string;
  /** The answer used to resume planning for the current turn. */
  continuation?: { questionId: string; question: string; answer: string; answerKind: 'option' | 'custom'; automatic: boolean; text: string };
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
  events: Array<{ stage: string; at: string; permission?: ConversationInput['permission']; activity?: ConversationActivity }>;
};

export type ConversationActivity = {
  count?: number;
  references?: Array<{ id: string; label: string }>;
  scopePaths?: string[];
};
