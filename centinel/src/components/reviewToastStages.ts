/** Shared, plain-language labels for the four Review progress stages shown in the toast. */
export const REVIEW_TOAST_STAGES = ['understanding_context', 'code_review', 'requirement_validation', 'summarizing'] as const;

const STAGE_LABELS: Record<string, string> = {
  understanding_context: 'Understanding context',
  code_review: 'Code review',
  requirement_validation: 'Requirement validation',
  summarizing: 'Summarizing',
};

export function reviewToastStageLabel(stageId: string): string {
  return STAGE_LABELS[stageId] ?? stageId.replace(/_/g, ' ');
}

export function reviewToastStageStatus(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'active') return 'In progress';
  if (status === 'pending') return 'Not started';
  return status.replace(/_/g, ' ');
}

export function reviewToastStageIndex(stageId: string): number {
  return (REVIEW_TOAST_STAGES as readonly string[]).indexOf(stageId);
}
