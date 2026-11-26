import type { ConversationPlan, Evidence } from './service.js';
import type { SavedConversationCheck, SavedConversationExplanation, SavedConversationProblem } from './types.js';

function savedText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function isSavedObjectiveOnlyQuestion(requestText: string) {
  return /^(?:(?:what\s+(?:was|is)\s+)?(?:(?:the|this|that|saved|original)\s+)?(?:(?:code|browser)\s+)?(?:check\s+)?(?:objective|goal)|what\s+(?:was|is)\s+(?:(?:the|this|that|saved|original)\s+)?(?:(?:code|browser)\s+)?(?:check\s+)?(?:objective|goal)(?:\s+of\s+(?:(?:the|this|that|saved)\s+)?check)?|what\s+was\s+this\s+check\s+for|what\s+did\s+(?:(?:the|this|that|saved)\s+)?check\s+(?:aim|set\s+out)\s+to\s+do)\s*[?.!]*$/i.test(requestText.trim());
}

function objectiveAnswer(check: SavedConversationCheck, requestText: string) {
  const text = requestText.trim().toLowerCase();
  const asksCode = /\bcode\b/.test(text);
  const asksBrowser = /\bbrowser\b/.test(text);
  if (asksCode && !asksBrowser) return check.code?.objective || 'Objective unavailable.';
  if (asksBrowser && !asksCode) return check.browser?.objective || 'Objective unavailable.';
  if (check.code?.objective && check.browser?.objective && check.code.objective !== check.browser.objective) {
    return `Saved Code objective: ${check.code.objective}\nSaved Browser objective: ${check.browser.objective}`;
  }
  return check.code?.objective || check.browser?.objective || 'Objective unavailable.';
}

export function presentCheckStatus(evidence: Evidence[]): ConversationPlan {
  const review = evidence.find(item => item.id.startsWith('review:'));
  const browser = evidence.find(item => item.id.startsWith('browser:'));
  const code = review && JSON.parse(review.text);
  const web = browser && JSON.parse(browser.text);
  const codeEnded = ['completed', 'success', 'pending_approval', 'approved', 'changes_requested'].includes(code?.status);
  const codeState = codeEnded ? 'review ended'
    : ['queued', 'prepared', 'running'].includes(code?.status) ? 'review in progress'
      : code ? 'review stopped or paused' : 'no Code Review saved';
  const webState = web?.stage === 'completed' ? 'check ended'
    : web?.stage === 'failed' || web?.stage === 'cancelled' ? 'check stopped'
      : web ? 'check in progress' : 'no Browser Check saved';
  const count = (value: unknown, label: string) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? ` · ${value} ${label}${value === 1 ? '' : 's'}` : '';
  const reply = review || browser ? [
    'Here’s where the saved Check stands.',
    '',
    `- **Code** — ${codeState}${count(code?.findingCount, 'saved finding')}.`,
    `- **Browser** — ${webState}${count(web?.failedAssertions, 'failed assertion')}${web?.assertionCountPartial && typeof web.failedAssertions === 'number' ? ' recorded so far' : ''}.`,
    ((review && !codeEnded) || (browser && web?.stage !== 'completed') || web?.assertionCountPartial || review?.unavailable || browser?.unavailable || code?.coverageIncomplete)
      && '- **Still open** — Some results or coverage are unavailable. Open the Check for the saved details.',
  ].filter(line => line !== false).join('\n') : 'I couldn’t find a saved Check for this project yet.';
  return { action: 'explain', reply, replyFormat: 'markdown', scope: [], citations: [review, browser].flatMap(item => item ? [item.id] : []) };
}

export function presentBrowserCoverage(evidence: Evidence[]) {
  const browser = evidence.find(item => item.id.startsWith('browser:'));
  if (!browser) return null;
  const saved = JSON.parse(browser.text);
  const failed = saved.failedAssertions;
  const count = Number.isSafeInteger(failed)
    ? saved.assertionCountPartial ? `I found ${failed} recorded failed Browser ${failed === 1 ? 'assertion' : 'assertions'}. Coverage is partial.`
      : `The Browser Check recorded ${failed} failed ${failed === 1 ? 'assertion' : 'assertions'}.`
    : 'The failed Browser assertion count is unavailable.';
  const unfinished = Array.isArray(saved.tests) ? saved.tests.filter((test: { state?: string }) =>
    !['passed', 'failed'].includes(test.state ?? '')) : [];
  const examples = unfinished.slice(0, 5).map((test: { name?: unknown; state?: unknown }) =>
    [savedText(test.name, 120), savedText(test.state, 30).replaceAll('_', ' ')].filter(Boolean).join(' · ')).filter(Boolean);
  return [count, examples.length && `\n\nTests without a verdict\n\n${examples.map((example: string) => `- ${example}`).join('\n')}`,
    unfinished.length > 5 && `\n\nSee the saved Check for ${unfinished.length - 5} more.`].filter(Boolean).join('');
}

/** Present saved evidence independently of the generated answer. */
export function presentSavedSelection(evidence: Evidence[], brief = false, requestText = ''): ConversationPlan | null {
  const evidenceById = new Map(evidence.map(item => [item.id, item]));
  const findingItems = evidence.filter(item => item.id.startsWith('finding:'));
  const selectedReviews = new Set(findingItems.map(item => JSON.parse(item.text).reviewId));
  const items: Array<{ id: string; text: string; overview: string; section: SavedConversationExplanation['sections'][number] }> = [];
  const handled = new Set<string>();

  for (const item of findingItems) {
    const data = JSON.parse(item.text);
    const title = savedText(data.title, 200);
    if (!title) continue;
    const detail = savedText(data.description, 480);
    const recommendation = savedText(data.recommendation, 320);
    const location = savedText(data.path, 500);
    const excerpt = typeof data.excerpt === 'string' ? data.excerpt.slice(0, 1200) : '';
    const sourceWindow = !excerpt ? data.nearby : undefined;
    const limitation = excerpt ? undefined : 'The original source excerpt is unavailable.';
    const requirement = savedText(data.requirement?.description, 420);
    const line = data.location?.lineNumber;
    const flow = Array.isArray(data.location?.logicFlow) ? data.location.logicFlow.slice(0, 5).map((entry: unknown) => savedText(entry, 400)).filter(Boolean) : [];
    const problem: SavedConversationProblem = data.problem && typeof data.problem === 'object' ? {
      ...data.problem, kind: 'code', title, reviewId: savedText(data.reviewId, 64) || undefined,
      ...(sourceWindow ? { sourceWindow } : {}), evidenceUnavailable: !excerpt,
    } : { kind: 'code', title, reviewId: savedText(data.reviewId, 64) || undefined,
      description: detail || undefined, recommendation: recommendation || undefined,
      location: location || undefined, excerpt: excerpt || undefined, sourceWindow, evidenceUnavailable: !excerpt };
    const status = problem.currentStatus ?? (problem.currentStatusUnavailable ? 'Unavailable' : undefined);
    const points = [...flow, requirement && `Saved requirement: ${requirement}`, recommendation && `Saved recommendation: ${recommendation}`].filter(Boolean);
    const overview = detail || `I found the saved record for “${title}”.`;
    items.push({ id: item.id, overview, text: [`Saved problem: ${title}.`, detail, location && `Source: ${location}.`,
      excerpt ? `Saved excerpt: “${excerpt}”` : limitation, recommendation && `Saved recommendation: ${recommendation}`,
      status && `Current status: ${status}.`].filter(Boolean).join(' '),
      section: { presentation: 'problem', title, problem,
        summary: detail, facts: [location && { label: 'Source', value: Number.isSafeInteger(line) && line > 0 ? `${location}:${line}` : location },
          data.originalStatus && { label: 'Saved status', value: savedText(data.originalStatus, 50) },
          status && { label: 'Current status', value: status }].filter(Boolean),
        excerpt, sourceWindow, points, limitations: limitation ? [limitation] : [] } });
    handled.add(item.id);
  }

  const checkReferences = evidence.filter(item => item.id.startsWith('check:')).map(item => ({ item, data: JSON.parse(item.text) }));
  const addCheck = (checkItem: Evidence | undefined, reviewItem: Evidence | undefined, browserItem: Evidence | undefined) => {
    if (reviewItem && selectedReviews.has(reviewItem.id.slice('review:'.length))) return;
    if (!reviewItem && !browserItem) return;
    const reviewData = reviewItem ? JSON.parse(reviewItem.text) : undefined;
    const browserData = browserItem ? JSON.parse(browserItem.text) : undefined;
    const browserProblemSelected = typeof browserData?.selectedTestId === 'string';
    if (browserProblemSelected) return;
    const codeObjective = savedText(reviewData?.objective, 500);
    const browserObjective = savedText(browserData?.objective, 500);
    const objective = codeObjective && codeObjective === browserObjective ? codeObjective
      : codeObjective && !browserData ? codeObjective : browserObjective && !reviewData ? browserObjective : undefined;
    const codeProblems: SavedConversationProblem[] = Array.isArray(reviewData?.problems) ? reviewData.problems.slice(0, 12) : [];
    const browserTests = Array.isArray(browserData?.tests) ? browserData.tests : [];
    const browserCheckRows = (checks: unknown) => Array.isArray(checks) ? checks.slice(0, 8).flatMap((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const check = value as Record<string, unknown>;
      return [{
        check: savedText(check.check, 180) || savedText(check.description, 180) || 'Saved assertion',
        expected: savedText(check.expected, 220) || undefined,
        observed: savedText(check.observed, 220) || undefined,
        verdict: savedText(check.verdict, 30) || 'unavailable',
      }];
    }) : [];
    const check: SavedConversationCheck = {
      mode: reviewData && browserData ? 'both' : reviewData ? 'code' : 'browser',
      ...(objective ? { objective } : {}),
      objectiveUnavailable: !codeObjective && !browserObjective,
      ...(reviewData && { code: {
        objective: codeObjective || undefined,
        status: savedText(reviewData.status, 50) || undefined,
        ...(reviewData.coverageIncomplete === true && { coverageIncomplete: true }),
        summary: savedText(reviewData.summary, 400) || undefined,
        scopeMode: reviewData.scopeMode === 'full' || reviewData.scopeMode === 'focused' ? reviewData.scopeMode : undefined,
        sourceCount: Number.isSafeInteger(reviewData.sourceCount) ? reviewData.sourceCount : null,
        sourceScope: Array.isArray(reviewData.scopeExamples) ? reviewData.scopeExamples.slice(0, 8).map((path: unknown) => savedText(path, 300)).filter(Boolean) : [],
        problems: codeProblems, problemCount: Number.isSafeInteger(reviewData.findingCount) ? reviewData.findingCount : null,
        moreProblems: Number.isSafeInteger(reviewData.moreProblems) ? reviewData.moreProblems : 0,
        modules: Array.isArray(reviewData.modules) ? reviewData.modules.slice(0, 8) : [],
        affectedFiles: Array.isArray(reviewData.affectedFiles) ? reviewData.affectedFiles.slice(0, 16) : [],
        coverage: Array.isArray(reviewData.coverage) ? reviewData.coverage.slice(0, 5) : [],
        requirements: Array.isArray(reviewData.requirements) ? reviewData.requirements.slice(0, 30) : undefined,
        requirementsUnavailable: reviewData.requirementsUnavailable === true,
        qualityEvidence: Array.isArray(reviewData.qualityEvidence) ? reviewData.qualityEvidence.slice(0, 8) : [],
      } }),
      ...(browserData && { browser: {
        status: savedText(browserData.stage, 50) || undefined,
        objective: browserObjective || undefined,
        testCount: Number.isSafeInteger(browserData.testCount) ? browserData.testCount : browserTests.length,
        testCountPartial: browserData.testCountPartial === true,
        provenProblemCount: browserData.provenProblemCount === null ? null
          : Number.isSafeInteger(browserData.provenProblemCount) ? browserData.provenProblemCount
            : Number.isSafeInteger(browserData.failedTests) ? browserData.failedTests : null,
        failedAssertionCount: Number.isSafeInteger(browserData.failedAssertions) ? browserData.failedAssertions : null,
        assertionCountPartial: browserData.assertionCountPartial === true,
        passedTestCount: Number.isSafeInteger(browserData.passedTests) ? browserData.passedTests : null,
        testsWithoutVerdict: Number.isSafeInteger(browserData.incompleteTests) ? browserData.incompleteTests : null,
        sourceScope: Array.isArray(browserData.sourceScope) ? browserData.sourceScope.slice(0, 16) : [],
        tests: browserTests.slice(0, 20).map((test: { id?: unknown; name?: unknown; state?: unknown; runId?: unknown; checks?: unknown[]; explanation?: unknown; explanationFromEarlier?: unknown; explanationRunId?: unknown; browserProof?: unknown; browserCoverage?: unknown; evidenceAttempt?: unknown; earlierAttempt?: { runId?: unknown; checks?: unknown[]; explanation?: unknown } }) => ({
          id: savedText(test.id, 64), name: savedText(test.name, 120), state: savedText(test.state, 30), runId: savedText(test.runId, 64) || undefined,
          checks: browserCheckRows(test.checks),
          explanation: savedText(test.explanation, 480) || undefined,
          explanationFromEarlier: test.explanationFromEarlier === true,
          explanationRunId: savedText(test.explanationRunId, 64) || undefined,
          browserProof: typeof test.browserProof === 'boolean' ? test.browserProof : undefined,
          browserCoverage: test.browserCoverage === 'stopped' || test.browserCoverage === 'partial' ? test.browserCoverage : undefined,
          evidenceAttempt: test.evidenceAttempt === 'earlier' || test.evidenceAttempt === 'current' ? test.evidenceAttempt : undefined,
          earlierAttempt: test.earlierAttempt ? { runId: savedText(test.earlierAttempt.runId, 64) || undefined,
            checks: browserCheckRows(test.earlierAttempt.checks), explanation: savedText(test.earlierAttempt.explanation, 480) || undefined } : undefined,
        })),
        moreTests: Number.isSafeInteger(browserData.moreTests) ? browserData.moreTests : Math.max(0, browserTests.length - 20),
      } }),
    };
    const codeCount = check.code?.problemCount;
    const codeCountText = codeCount === null || codeCount === undefined ? 'The saved Code problem count is unavailable.'
      : `The saved Code check recorded ${codeCount} ${codeCount === 1 ? 'problem' : 'problems'}${['queued', 'running', 'failed', 'blocked', 'cancelled'].includes(check.code?.status ?? '') ? ' so far' : ''}.`;
    const browserCount = check.browser?.provenProblemCount;
    const assertionCount = check.browser?.failedAssertionCount;
    const browserCoverageNote = check.browser?.testCountPartial
      ? ['failed', 'cancelled'].includes(check.browser.status ?? '')
        ? 'The Browser Check stopped before it finished. Remaining behavior is unchecked.'
        : 'Some Browser behavior remains unchecked.'
      : check.browser?.assertionCountPartial || (check.browser?.testsWithoutVerdict ?? 0) > 0
        ? 'Some Browser results are incomplete. Remaining behavior is unchecked.' : '';
    const codeCoverageNote = check.code?.coverageIncomplete ? 'Some Code coverage remains unchecked.' : '';
    const possibleCauses = (check.browser?.tests ?? []).filter(test => test.explanation && test.browserProof === false)
      .slice(0, 3).map(test => `Possible cause for ${test.name || 'a Browser test'} (saved AI explanation): ${test.explanation}`);
    const objectiveLine = objective ? `Saved objective: ${objective}.`
      : codeObjective && browserObjective ? `Saved Code objective: ${codeObjective}. Saved Browser objective: ${browserObjective}.`
        : codeObjective ? `Saved Code objective: ${codeObjective}.`
          : browserObjective ? `Saved Browser objective: ${browserObjective}.` : 'The saved objective is unavailable.';
    const metrics = [
      check.code && codeCountText,
      check.browser && (browserCount === null || browserCount === undefined ? check.browser.testCountPartial
        ? 'A Browser-proven problem count is not available because the saved Check did not finish.'
        : 'The Browser-proven problem count is unavailable.'
        : `The saved Browser check confirmed ${browserCount} Browser-proven ${browserCount === 1 ? 'problem' : 'problems'}${check.browser.testCountPartial ? ' so far' : ''}.`),
      check.browser && (assertionCount === null || assertionCount === undefined ? 'The failed Browser assertion count is unavailable.'
        : `The saved Browser check recorded ${assertionCount} failed Browser ${assertionCount === 1 ? 'assertion' : 'assertions'}${check.browser.assertionCountPartial ? ' so far' : ''}.`),
    ].filter((value): value is string => typeof value === 'string');
    const overview = [metrics.join(' '), codeCoverageNote, browserCoverageNote, ...possibleCauses].filter(Boolean).join(' ')
      || 'Saved Check details are unavailable.';
    const files = [...new Set([...(check.code?.sourceScope ?? []), ...(check.browser?.sourceScope ?? [])])];
    const qualities = (check.code?.qualityEvidence ?? []).map(item => [savedText(item.quality, 50), savedText(item.path, 300), savedText(item.impact, 260)].filter(Boolean).join(' · ')).filter(Boolean);
    const codeMore = check.code?.moreProblems ? `${check.code.moreProblems} more Code problems are in the saved result.` : '';
    const browserMore = check.browser?.moreTests ? `${check.browser.moreTests} more Browser tests are in the saved result.` : '';
    const limitations = [reviewItem?.unavailable && 'The original source manifest is unavailable.',
      codeCoverageNote,
      browserCoverageNote,
      check.browser?.failedAssertionCount === null && 'The failed Browser assertion count is unavailable.',
      check.code?.requirementsUnavailable && 'Requirement coverage is unavailable for this Review.'].filter((value): value is string => typeof value === 'string');
    const title = savedText(reviewData?.name, 180) || (browserData?.testCount === 1 ? savedText(browserTests[0]?.name, 180) : '') || 'Saved Check';
    const facts: NonNullable<SavedConversationExplanation['sections'][number]['facts']> = [];
    if (objective) facts.push({ label: 'Objective', value: objective });
    if (check.code?.scopeMode) facts.push({ label: 'Requested source scope', value: check.code.scopeMode === 'full' ? 'Full' : 'Focused' });
    if (Number.isSafeInteger(check.code?.sourceCount)) facts.push({ label: 'Files in saved manifest', value: String(check.code?.sourceCount) });
    const browserDetails = check.browser?.tests?.slice(0, 8).map(test => {
      const status = savedText(test.state, 30) || 'status unavailable';
      const checks = test.checks.map(assertion => [assertion.check,
        assertion.expected && `expected ${assertion.expected}`,
        assertion.observed && `observed ${assertion.observed}`,
        assertion.verdict !== 'unavailable' && `result ${assertion.verdict}`].filter(Boolean).join('; '));
      return [`Browser test ${test.name || 'Saved test'}: ${status}${status === 'failed' && test.browserProof === false ? ', not counted as proven' : ''}.`,
        ...checks.map(check => `${check}.`), test.explanation && `Possible cause (saved AI explanation): ${test.explanation}`].filter(Boolean).join(' ');
    }) ?? [];
    const text = [title, objectiveLine, overview, files.length ? `Saved source paths: ${files.join(', ')}.` : '',
      qualities.length ? `Saved quality examples: ${qualities.join('; ')}.` : '', ...browserDetails, codeMore, browserMore, ...limitations].filter(Boolean).join(' ');
    const objectiveOnly = isSavedObjectiveOnlyQuestion(requestText);
    const directObjectiveAnswer = objectiveOnly ? objectiveAnswer(check, requestText) : undefined;
    const id = checkItem?.id ?? reviewItem?.id ?? browserItem!.id;
    items.push({ id, overview: overview, text, section: { presentation: 'check', title, check, summary: savedText(reviewData?.summary, 400),
      facts,
      points: qualities, limitations } });
    if (directObjectiveAnswer) items[items.length - 1].overview = directObjectiveAnswer;
    if (checkItem) handled.add(checkItem.id);
    if (reviewItem) handled.add(reviewItem.id);
    if (browserItem) handled.add(browserItem.id);
  };

  for (const { item, data } of checkReferences) {
    const reviewItem = typeof data.reviewId === 'string' ? evidenceById.get(`review:${data.reviewId}`) : undefined;
    const browserItem = typeof data.autoTestId === 'string' ? [...evidenceById.values()].find(candidate => candidate.id === `browser:${data.autoTestId}`) : undefined;
    addCheck(item, reviewItem, browserItem);
  }
  for (const item of evidence.filter(candidate => candidate.id.startsWith('review:') && !handled.has(candidate.id))) {
    if (!selectedReviews.has(item.id.slice('review:'.length))) addCheck(undefined, item, undefined);
  }
  for (const item of evidence.filter(candidate => candidate.id.startsWith('browser:') && !handled.has(candidate.id))) {
    const data = JSON.parse(item.text);
    if (typeof data.selectedTestId === 'string' && data.problem) {
      const problem = data.problem as SavedConversationProblem;
      const title = savedText(problem.title, 200) || 'Saved Browser problem';
      const observations = (problem.browserChecks ?? []).slice(0, 8);
      const status = savedText(problem.originalStatus, 30) || 'Unavailable';
      const coverage = problem.browserCoverage === 'stopped' ? 'The Browser Check stopped before it finished. Remaining behavior is unchecked.'
        : problem.browserCoverage === 'partial' ? 'Browser verification is incomplete. Remaining behavior is unchecked.' : '';
      const browserProof = typeof problem.browserProof === 'boolean' ? problem.browserProof
        : problem.browserCoverage === undefined && status === 'failed';
      const aiExplanation = savedText(problem.aiExplanation, 480);
      const overview = [browserProof ? `${title} has a saved failed Browser result.` : `${title} has a saved Browser observation.`,
        aiExplanation && `Possible cause (saved AI explanation): ${aiExplanation}`, coverage].filter(Boolean).join(' ');
      items.push({ id: item.id, overview,
        text: [browserProof ? `Saved Browser problem: ${title}.` : `Saved Browser observation: ${title}.`, savedText(problem.description, 480),
          `Saved result: ${status}.`, ...observations.map(check => `Expected ${savedText(check.expected, 220)}; the page showed ${savedText(check.observed, 220)}.`),
          aiExplanation && `Possible cause (saved AI explanation): ${aiExplanation}`, coverage].filter(Boolean).join(' '),
        section: { presentation: 'problem', title, problem, summary: savedText(problem.description, 480),
          originalBrowserRunId: savedText(problem.runId, 64) || undefined,
          checks: observations.map(check => ({ test: title, check: 'Saved assertion', expected: check.expected, observed: check.observed,
            verdict: status, runId: problem.runId })),
          facts: [{ label: 'Saved result', value: status }],
          limitations: [coverage, item.unavailable ? 'Some saved Browser results are unavailable.' : ''].filter(Boolean) } });
      handled.add(item.id);
    } else addCheck(undefined, undefined, item);
  }

  if (!items.length) return null;
  const shown = items.slice(0, 4);
  return { action: 'explain', scope: [], citations: shown.map(item => item.id),
    ...(brief && { replyFormat: 'markdown' as const }),
    reply: shown.map(item => brief || isSavedObjectiveOnlyQuestion(requestText)
      ? item.overview : item.text).join(brief ? ' ' : '\n\n') + (items.length > shown.length ? '\n\nSelect an individual item for more detail.' : ''),
    explanation: { sections: shown.map(item => ({ ...item.section, evidenceId: item.id })), hasMore: items.length > shown.length } };
}
