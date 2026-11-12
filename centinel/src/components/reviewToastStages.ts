import { REVIEW_WORKFLOW_STAGES } from '../reviewNarrative';
import type { ReviewProgress } from '../types';

export function reviewToastStages(progress: ReviewProgress) {
  if (!progress.stage) return progress.stages;
  return REVIEW_WORKFLOW_STAGES.map(({ id, title }) => ({
    id,
    label: title,
    status: progress.completedStages?.includes(id) ? 'done' : progress.stage === id ? 'active' : 'pending',
    thoughts: [],
  }));
}

export function reviewToastStageStatus(status: string): string {
  if (status === 'done') return 'Done';
  if (status === 'active') return 'In progress';
  if (status === 'pending') return 'Not started';
  return status.replace(/_/g, ' ');
}
