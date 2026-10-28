import crypto from 'node:crypto';
import type { ReviewAuditEvent } from './types.js';

/** Engineering owns these boundaries; model output cannot skip a gate. */
export const REVIEW_HARNESS = {
  version: 'centinel-harness-v1',
  reference: 'https://github.com/alibaba/open-code-review',
  stages: [
    { id: 'freezing_sources', label: 'Freeze and validate sources', steps: ['select_sources', 'freeze_manifest', 'inspect_source', 'read_source', 'load_grounding', 'load_traceability', 'capture_traceability', 'load_dispositions', 'assess_evidence', 'save_assessment'] },
    { id: 'indexing_context', label: 'Build review context', steps: ['index_sources', 'retrieve_context'] },
    { id: 'deterministic_analysis', label: 'Run deterministic checks', steps: ['run_rules', 'check_rule'] },
    { id: 'model_analysis', label: 'Review with configured model', steps: ['map_feature_paths', 'build_request', 'resolve_provider', 'run_model', 'validate_response', 'validate_grounding', 'validate_source_evidence', 'challenge_support', 'validate_support'] },
    { id: 'persisting_evidence', label: 'Validate and save evidence', steps: ['validate_locations', 'deduplicate_findings', 'save_traceability', 'save_findings', 'correlate_findings'] },
  ],
} as const;

export class ReviewHarness {
  private buffered: Array<Omit<ReviewAuditEvent, 'createdAt'>> | null = null;
  constructor(private readonly context: { reviewId: string; projectId: string }, private readonly record: (event: Omit<ReviewAuditEvent, 'createdAt'>) => Promise<void>, private readonly recordBatch?: (events: Array<Omit<ReviewAuditEvent, 'createdAt'>>) => Promise<void>) {}

  /** Free synchronous rule checks may share a write; paid operations stay immediate. */
  async bufferRuleEvents<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.recordBatch || this.buffered) return operation();
    this.buffered = [];
    try { return await operation(); }
    finally {
      const events = this.buffered;
      this.buffered = null;
      if (events.length) await this.recordBatch(events);
    }
  }

  private async emit(event: Omit<ReviewAuditEvent, 'createdAt'>) {
    if (this.buffered && event.stage === 'deterministic_analysis' && event.detail?.step === 'check_rule') this.buffered.push(event);
    else await this.record(event);
  }

  async step<T>(stage: string, step: string, input: Record<string, unknown>, operation: () => Promise<T>, output?: (value: T) => Record<string, unknown>): Promise<T> {
    const executionId = crypto.randomUUID();
    const started = performance.now();
    await this.emit({ ...this.context, event: 'harness_step_started', stage, detail: { executionId, step, input, harnessVersion: REVIEW_HARNESS.version } });
    try {
      const value = await operation();
      await this.emit({ ...this.context, event: 'harness_step_completed', stage, detail: { executionId, step, durationMs: Math.round(performance.now() - started), output: output?.(value) ?? {} } });
      return value;
    } catch (error) {
      // Persist outcomes, never credentials, prompts, model thoughts, or raw exceptions.
      const cancelled = error instanceof Error && /Abort|Cancel/i.test(error.name);
      await this.emit({ ...this.context, event: cancelled ? 'harness_step_cancelled' : 'harness_step_failed', stage, detail: { executionId, step, durationMs: Math.round(performance.now() - started), outcome: cancelled ? 'cancelled' : 'failed' } });
      throw error;
    }
  }
}
