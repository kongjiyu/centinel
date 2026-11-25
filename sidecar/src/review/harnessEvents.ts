const publicEvents = new Set([
  'model_attempt',
  'review_analysis_map_saved',
  'review_analysis_batch_saved',
  'review_live_finding_titles',
  'review_assessment_batch_started',
  'review_analysis_batch_unverified',
  'review_assessment_validated',
  'review_retry_scheduled',
  'review_assessment_rejected',
  'review_assessment_repair_scheduled',
  'review_candidate_support_scheduled',
  'review_candidate_support_incomplete',
  'review_candidate_support_saved',
  'review_candidate_support_limited',
  'review_candidate_support_conflict',
  'review_batch_needs_verification',
  'review_batch_cache_reused',
  'review_batch_cache_rejected',
  'review_source_batches_finished',
  'review_batches_planned',
]);

export function isPublicReviewHarnessEvent(event: string) {
  return event.startsWith('harness_step_') || publicEvents.has(event);
}
