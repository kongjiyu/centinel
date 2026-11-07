import type { DynamicTestDraft, Finding } from '../types';

const clip = (value: string, limit: number) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/**
 * Turn a Review finding into an editable Dynamic test draft. The draft names
 * the expected fixed behaviour; the tester still chooses checks and starts it.
 */
export function findingToDynamicDraft(finding: Finding): DynamicTestDraft {
  const expected = finding.recommendation.trim() || finding.description.trim();
  return {
    name: clip(`Verify fix: ${finding.title}`, 120),
    goal: clip(`Check in the running application that this Review finding no longer occurs: ${finding.title}.${expected ? ` Expected after the fix: ${expected}` : ''}`, 1800),
    ...(finding.sessionId ? { reviewId: finding.sessionId } : {}),
  };
}

/**
 * Turn a Review into an editable Dynamic test draft. The goal points at the
 * criteria the tester links to the checks, not every requirement the Review
 * covered, so changing the selected criterion never leaves a misleading goal.
 * The planner separately lists exactly those checks and criteria.
 */
export function reviewToDynamicDraft(review: { id: string; name: string }): DynamicTestDraft {
  return {
    name: clip(`${review.name}: runtime check`, 120),
    goal: clip(`Check in the running application that the criteria selected for this test's checks (from ${review.name}) behave as specified. Other requirements in that Review are not in scope.`, 1800),
    reviewId: review.id,
  };
}
