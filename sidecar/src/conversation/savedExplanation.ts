import type { ConversationPlan, Evidence } from './service.js';
import type { SavedConversationExplanation } from './types.js';

function savedText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/** Explain the record selected by a mention. Its text never determines an action. */
export function explainSavedSelection(evidence: Evidence[], request: string): ConversationPlan | null {
  const shortRequest = /^(?:please\s+)?(?:explain|summari[sz]e)[.!?]?$/i.test(request.trim());
  if (!shortRequest && !/\b(?:explain|summari[sz]e|tell me about)\s+(?:what\s+)?(?:this|the|these|those)\s+(?:saved\s+|attached\s+)?(?:checks?|problems?|reviews?|findings?|results?)\b/i.test(request)) return null;
  const findings = evidence.filter(item => item.id.startsWith('finding:'));
  const selectedReviews = new Set(findings.map(item => JSON.parse(item.text).reviewId));
  const items: Array<{ id: string; text: string; section: SavedConversationExplanation['sections'][number] }> = [];
  for (const item of evidence) {
    if (item.id.startsWith('finding:')) {
      const data = JSON.parse(item.text);
      const title = savedText(data.title, 200);
      if (!title) continue;
      const detail = savedText(data.description, 480);
      const recommendation = savedText(data.recommendation, 280);
      const location = savedText(data.path, 160);
      const excerpt = savedText(data.excerpt, 220);
      const limitations = excerpt ? [] : ['The original source excerpt is unavailable.'];
      items.push({ id: item.id, text: [`Saved problem: ${title}.`, detail, location && `Source: ${location}.`,
        excerpt ? `Saved excerpt: “${excerpt}”` : limitations[0], recommendation && `Saved recommendation: ${recommendation}`].filter(Boolean).join(' '),
        section: { title, summary: detail, facts: [location && { label: 'Source', value: location },
          data.originalStatus && { label: 'Saved status', value: savedText(data.originalStatus, 50) }].filter(Boolean),
          excerpt, points: recommendation ? [`Saved recommendation: ${recommendation}`] : [], limitations } });
    } else if (item.id.startsWith('review:') && !selectedReviews.has(item.id.slice('review:'.length))) {
      const data = JSON.parse(item.text);
      if (!Number.isSafeInteger(data.findingCount)) continue;
      const examples = Array.isArray(data.findingExamples) ? data.findingExamples.slice(0, 3).map((finding: { title?: unknown }) => savedText(finding.title, 120)).filter(Boolean) : [];
      const summary = savedText(data.summary, 400);
      const name = savedText(data.name, 180);
      const overview = `The saved Code check recorded ${data.findingCount} ${data.findingCount === 1 ? 'finding' : 'findings'}.`;
      items.push({ id: item.id, text: [`The saved Code check${name ? ` “${name}”` : ''} recorded ${data.findingCount} findings.`,
        summary && `Saved summary: ${summary}`, examples.length && `Examples: ${examples.join(', ')}.`,
        item.unavailable && 'Its original source manifest is unavailable.'].filter(Boolean).join(' '),
        section: { title: name || 'Saved Code check', summary: [overview, summary].filter(Boolean).join(' '),
          facts: [Number.isSafeInteger(data.sourceCount) && { label: 'Files in saved manifest', value: String(data.sourceCount) },
            data.status && { label: 'Saved review status', value: savedText(data.status, 50).replaceAll('_', ' ') }].filter(Boolean),
          points: examples, limitations: item.unavailable ? ['The original source manifest is unavailable.'] : [] } });
    } else if (item.id.startsWith('browser:')) {
      const data = JSON.parse(item.text);
      if (!Array.isArray(data.tests)) continue;
      const checks: NonNullable<SavedConversationExplanation['sections'][number]['checks']> = [];
      const observations = data.tests.slice(0, 3).map((test: { name?: unknown; state?: unknown; runId?: unknown;
        checks?: Array<{ checkId?: string; verdict?: unknown; observed?: unknown }>; definitions?: Array<{ id?: string; kind?: string; expected?: unknown; description?: unknown }> }) => {
        const name = savedText(test.name, 100) || 'Browser test';
        const observation = savedText(test.checks?.[0]?.observed, 160);
        const verdict = ['passed', 'failed', 'uncertain', 'blocked', 'cancelled'].find(state => state === test.state) ?? 'no verdict';
        const runId = savedText(test.runId, 64) || undefined;
        for (const outcome of test.checks?.slice(0, 3) ?? []) {
          const definition = test.definitions?.find(record => record.id === outcome.checkId);
          checks.push({ test: name, check: savedText(definition?.description, 160) || 'Saved assertion',
            expected: definition?.kind === 'visible_text' ? savedText(definition.expected, 160) : undefined,
            observed: savedText(outcome.observed, 220), verdict: savedText(outcome.verdict, 30) || 'No verdict', runId });
        }
        if (!test.checks?.length) checks.push({ test: name, check: 'Test result', verdict, runId });
        return `“${name}” recorded ${verdict}.${observation ? ` Saved observation: ${observation}` : ''}`;
      });
      items.push({ id: item.id, text: ['Saved Browser check.', ...observations, !observations.length && 'No test result was saved.'].filter(Boolean).join(' '),
        section: { title: 'Saved Browser check', summary: observations.length ? undefined : 'No test result was saved.', checks,
          limitations: [item.unavailable && 'Some tests are missing a saved run or assertion results.',
            (data.tests.length > 3 || data.tests.slice(0, 3).some((test: { checks?: unknown[] }) => (test.checks?.length ?? 0) > 3)) && 'Open the saved run for the full set of checks.'].filter(Boolean) } });
    }
  }
  if (!items.length) return null;
  const shown = items.slice(0, 4);
  return { action: 'explain', scope: [], citations: shown.map(item => item.id),
    reply: shown.map(item => item.text).join('\n\n') + (items.length > shown.length ? '\n\nSelect an individual item for more detail.' : ''),
    explanation: { sections: shown.map(item => item.section), hasMore: items.length > shown.length } };
}
