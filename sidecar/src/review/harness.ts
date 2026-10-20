import crypto from 'node:crypto';
import type { ReviewAuditEvent } from './types.js';

/** Engineering owns these boundaries; model output cannot skip a gate. */
export const REVIEW_HARNESS = {
  version: 'centinel-harness-v1',
  reference: 'https://github.com/alibaba/open-code-review',
  stages: [
    { id: 'freezing_sources', label: 'Freeze and validate sources', steps: ['select_sources', 'freeze_manifest', 'inspect_source', 'read_source', 'load_grounding', 'load_traceability', 'load_dispositions', 'assess_evidence', 'save_assessment'] },
    { id: 'indexing_context', label: 'Build review context', steps: ['index_sources', 'retrieve_context'] },
    { id: 'deterministic_analysis', label: 'Run deterministic checks', steps: ['run_rules', 'check_rule'] },
    { id: 'model_analysis', label: 'Review with configured model', steps: ['build_request', 'resolve_provider', 'run_model', 'validate_grounding'] },
    { id: 'persisting_evidence', label: 'Validate and save evidence', steps: ['validate_locations', 'deduplicate_findings', 'save_traceability', 'save_findings', 'correlate_findings'] },
  ],
} as const;

export class ReviewHarness {
  constructor(private readonly context: { reviewId: string; projectId: string }, private readonly record: (event: Omit<ReviewAuditEvent, 'createdAt'>) => Promise<void>) {}

  async step<T>(stage: string, step: string, input: Record<string, unknown>, operation: () => Promise<T>, output?: (value: T) => Record<string, unknown>): Promise<T> {
    const executionId = crypto.randomUUID();
    const started = performance.now();
    await this.record({ ...this.context, event: 'harness_step_started', stage, detail: { executionId, step, input, harnessVersion: REVIEW_HARNESS.version } });
    try {
      const value = await operation();
      await this.record({ ...this.context, event: 'harness_step_completed', stage, detail: { executionId, step, durationMs: Math.round(performance.now() - started), output: output?.(value) ?? {} } });
      return value;
    } catch (error) {
      // Persist outcomes, never credentials, prompts, model thoughts, or raw exceptions.
      const cancelled = error instanceof Error && /Abort|Cancel/i.test(error.name);
      await this.record({ ...this.context, event: cancelled ? 'harness_step_cancelled' : 'harness_step_failed', stage, detail: { executionId, step, durationMs: Math.round(performance.now() - started), outcome: cancelled ? 'cancelled' : 'failed' } });
      throw error;
    }
  }
}
