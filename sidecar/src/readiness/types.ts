import type { Artifact } from '../artifacts.js';

export type ReadinessCategory = 'repository' | 'requirements' | 'design' | 'standards';
export type ReadinessState = 'missing' | 'incomplete' | 'completed';
export type ReadinessFailureCode = 'assessment_paused' | 'not_configured' | 'secret_unavailable' | 'codex_not_connected' | 'rate_limited' | 'quota_exhausted' | 'credits_exhausted' | 'billing_required' | 'context_limit' | 'malformed_response' | 'timeout' | 'persistence' | 'source_changes' | 'assessment_failed';
export type ReadinessReference = { artifactId: string; path: string; excerpt: string; sourceVersion?: string; contentHash?: string };
export type ReadinessGap = { id: string; category: ReadinessCategory; title: string; description: string; recommendation: string; severity: 'warning' | 'blocking'; references: ReadinessReference[] };
export type ReadinessCriterionResult = { id: string; status: 'pass' | 'gap' | 'unknown'; basis: string; references: ReadinessReference[] };
export type ReadinessCategoryResult = { id: ReadinessCategory; label: string; state: ReadinessState; sourceCount: number; checksPassed: number; checksTotal: number; gapIds: string[]; criteria?: ReadinessCriterionResult[] };
export type ReadinessAssessment = { id: string; projectId: string; sourceFingerprint: string; assessedAt: string; categories: ReadinessCategoryResult[]; findings: ReadinessGap[]; policyVersion?: string };
export type ReadinessStatus = { projectId: string; requestId: string | null; status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'paused'; trigger: string | null; requestedAt: string | null; startedAt: string | null; completedAt: string | null; error: string | null; errorCode?: ReadinessFailureCode | null; snapshot: ReadinessAssessment | null; stale: boolean };
export type ReadinessSourceIssue = 'authorization_required' | 'sync_failed' | 'partial_import' | 'unsupported_format' | 'content_unavailable' | 'content_changed' | 'version_missing';
export type ReadinessArtifact = { artifact: Artifact; content: string | null; error?: string; unavailableReason?: ReadinessSourceIssue };
export type ReadinessInput = { projectId: string; description: string; artifacts: ReadinessArtifact[]; sourceFingerprint: string };
