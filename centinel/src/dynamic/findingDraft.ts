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
