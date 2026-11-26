import type { Evidence } from './service.js';
import type { ConversationReference } from './types.js';

function name(value: unknown, fileName = false): string | null {
  if (typeof value !== 'string') return null;
  const display = fileName ? value.split(/[\\/]/).pop() ?? '' : value;
  return display.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 160) || null;
}

/** Resolve names only from the same authorized, UUID-bound evidence that the planner sees. */
export function resolveAttachmentNames(references: ConversationReference[], evidence: Evidence[]): Array<string | null> {
  const byId = new Map(evidence.map(item => [item.id, item.text]));
  return references.map(ref => {
    const id = ref.findingId ? 'finding:' + ref.findingId
      : ref.testId ? 'browser:' + ref.autoTestId + ':' + ref.testId
      : ref.artifactId ? 'artifact:' + ref.artifactId
      : ref.reviewId ? 'review:' + ref.reviewId : ref.autoTestId ? 'browser:' + ref.autoTestId : null;
    if (!id) return null;
    const source = byId.get(id);
    if (!source) return null;
    try {
      const item = JSON.parse(source);
      if (ref.findingId) return item?.reviewId === ref.reviewId ? name(item.title) : null;
      if (ref.testId) return Array.isArray(item?.tests) ? name(item.tests.find((test: { id?: string }) => test?.id === ref.testId)?.name) : null;
      if (ref.artifactId) return name(item?.path, true);
      if (!ref.reviewId && Array.isArray(item?.tests) && item.tests.length === 1) return name(item.tests[0]?.name);
      return name(item?.name);
    } catch { return null; }
  });
}
