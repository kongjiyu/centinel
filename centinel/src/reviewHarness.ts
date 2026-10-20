export type HarnessEvent = {
  id?: string;
  reviewId: string;
  event: string;
  stage?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
};

export type ReviewHarnessTrace = {
  workflow: { version: string; reference: string; stages: Array<{ id: string; label: string; steps: string[] }> };
  review: { id: string; name: string; status: string; progress: { stage: string; completedStages: string[] } | null; modelStatus: string; updatedAt: string };
  events: HarnessEvent[];
};

export function stepLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

export function harnessStepState(events: HarnessEvent[], step: string, terminal: boolean): string {
  const related = events.filter(event => event.detail?.step === step);
  if (!related.length) return 'Not recorded';
  // Artifact reads may run multiple times; show their least-complete outcome.
  const executions = new Map<string, string>();
  for (const event of related) {
    const id = String(event.detail?.executionId ?? step);
    // Supabase timestamps can tie; a started row must not overwrite its outcome.
    if (event.event !== 'harness_step_started' || !executions.has(id)) executions.set(id, event.event);
  }
  const outcomes = [...executions.values()];
  if (outcomes.includes('harness_step_failed')) return 'Failed';
  if (outcomes.includes('harness_step_cancelled')) return 'Cancelled';
  if (outcomes.includes('harness_step_started')) return terminal ? 'Interrupted' : 'In progress';
  return 'Completed';
}
