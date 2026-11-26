import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseFindingRepository } from '../dynamic/findings/repository.js';
import type { ConversationReference, SavedConversationProblem } from './types.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { listClientArtifacts, readClientArtifactContent } from '../applicationApi.js';
import { SupabaseCentinelStore } from '../store/index.js';
import { SupabaseStaticReviewRepository } from '../review/supabaseRepository.js';
import { SupabaseAutoTestStore } from '../dynamic/autonomous/store.js';
import { DynamicContractError } from '../dynamic/types.js';
import { hash, type Evidence } from './service.js';
import { compactCanonicalJson } from '../report/canonical.js';
import { namedReviewScope } from './intent.js';
import { SupabaseConversationStore } from './store.js';
import type { StoreFinding } from '../store/types.js';
import { loadCurrentProjectFindings } from '../review/currentProjectFindings.js';
import { analysisMapFromEvents } from '../review/assessmentBatches.js';
import { deriveRiskLevel, inferPriority } from '../riskPolicy.js';
import { verifiedSourceText } from '../review/sourceText.js';

const qualityLabels = new Map([
  ['security', 'Security'], ['usability', 'Usability'], ['reliability', 'Reliability'],
  ['technical', 'Technical correctness'], ['business', 'Business behavior'],
]);

function findingQualityEvidence(findings: StoreFinding[], paths: Map<string, string>) {
  const examples = new Map<string, { quality: string; title: string; impact: string; path?: string }>();
  for (const finding of findings) {
    const category = finding.category?.toLowerCase();
    const domain = finding.location?.domain;
    const quality = qualityLabels.get(category) ?? (typeof domain === 'string' ? qualityLabels.get(domain) : undefined);
    const impact = finding.description?.trim();
    if (!quality || !impact || examples.has(quality) || finding.severity?.toLowerCase() === 'info' || ['dismissed', 'fixed'].includes(finding.status)) continue;
    examples.set(quality, { quality, title: (finding.title || 'Saved finding').slice(0, 160), impact: impact.slice(0, 260),
      path: finding.artifactId ? paths.get(finding.artifactId)?.slice(0, 160) : undefined });
  }
  return [...examples.values()];
}

const OPEN_FINDING_STATUSES = new Set(['new', 'accepted', 'carryover']);
const MODULE_NAMES = new Map([
  ['product', 'Products'], ['products', 'Products'], ['catalog', 'Catalog'], ['catalogue', 'Catalog'],
  ['order', 'Orders'], ['orders', 'Orders'], ['checkout', 'Checkout'], ['cart', 'Cart'], ['carts', 'Cart'],
  ['inventory', 'Inventory'], ['user', 'Users'], ['users', 'Users'], ['customer', 'Customers'], ['customers', 'Customers'],
  ['account', 'Accounts'], ['accounts', 'Accounts'], ['payment', 'Payments'], ['payments', 'Payments'],
  ['auth', 'Authentication'], ['authentication', 'Authentication'], ['shipping', 'Shipping'], ['returns', 'Returns'],
]);

function inferredModule(path: string) {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const candidates = [...segments.slice(0, -1).reverse(), (segments.at(-1) ?? '').replace(/\.[^.]+$/, '')];
  for (const candidate of candidates) {
    const normalized = candidate.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const match = normalized.map(token => MODULE_NAMES.get(token)).find(Boolean);
    if (match) return match;
  }
  return undefined;
}

function currentStatusLabel(status: StoreFinding['status'] | undefined) {
  if (!status) return undefined;
  if (status === 'fixed') return 'Resolved';
  if (status === 'dismissed') return 'Dismissed';
  if (status === 'accepted') return 'Accepted';
  return 'Open';
}

async function currentBrowserStatus(client: SupabaseClient, projectId: string, runId: string | undefined, signal: AbortSignal) {
  if (!runId) return undefined;
  try {
    const observations = await client.from('dynamic_finding_observations').select('finding_id')
      .eq('project_id', projectId).eq('run_id', runId).limit(20).abortSignal(signal);
    if (observations.error) return undefined;
    const ids = [...new Set((observations.data ?? []).map(row => row.finding_id as string))];
    if (ids.length !== 1 || (observations.data?.length ?? 0) === 20) return undefined;
    const { finding } = await new SupabaseFindingRepository(client).get(projectId, ids[0]);
    if (finding.projectId !== projectId) return undefined;
    return ({ open: 'Open', in_progress: 'In progress', resolved: 'Resolved' })[finding.remediation];
  } catch { return undefined; }
}

function sourceReferences(finding: StoreFinding, source: { id: string; filePath: string; contentHash: string } | undefined,
  manifest: Array<{ id: string; versionId?: string; contentHash: string; filePath: string }> | null) {
  const location = finding.location ?? {};
  const locator = location.sourceLocator && typeof location.sourceLocator === 'object'
    ? location.sourceLocator as Record<string, unknown> : {};
  const refs: Array<{ artifactId?: string | null; filePath: string; lineNumber?: number | null; sourceVersion?: string | null; excerpt?: string; relation: 'code' | 'document' | 'requirement' }> = [];
  if (source) refs.push({ artifactId: source.id, filePath: source.filePath,
    lineNumber: typeof location.lineNumber === 'number' ? location.lineNumber : typeof locator.lineStart === 'number' ? locator.lineStart : null,
    sourceVersion: source.contentHash, excerpt: finding.evidenceText || (typeof locator.excerpt === 'string' ? locator.excerpt : undefined), relation: 'code' });
  const related = Array.isArray(location.relatedLocations) ? location.relatedLocations : [];
  for (const value of related.slice(0, 6)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const relatedSource = typeof item.artifactId === 'string' && typeof item.filePath === 'string'
      ? manifest?.find(candidate => candidate.id === item.artifactId
        && (candidate.contentHash === item.sourceVersion || candidate.versionId === item.sourceVersion)) : undefined;
    if (!relatedSource) continue;
    refs.push({ artifactId: relatedSource.id, filePath: relatedSource.filePath,
      lineNumber: typeof item.lineNumber === 'number' ? item.lineNumber : null,
      sourceVersion: relatedSource.contentHash, excerpt: typeof item.evidence === 'string' ? item.evidence : undefined, relation: 'code' });
  }
  return [...new Map(refs.map(item => [JSON.stringify([item.artifactId, item.filePath, item.lineNumber, item.sourceVersion]), item])).values()];
}

function moduleEvidence(findings: StoreFinding[], manifest: Array<{ id: string; versionId?: string; contentHash: string; filePath: string }> | null,
  analysisMap: ReturnType<typeof analysisMapFromEvents>) {
  const groups = new Map<string, Set<string>>();
  for (const finding of findings) {
    const source = (manifest ?? []).find(item => matchesFindingSource(item, finding));
    if (!source) continue;
    const locator = finding.location?.sourceLocator && typeof finding.location.sourceLocator === 'object'
      ? finding.location.sourceLocator as Record<string, unknown> : {};
    const analysis = locator.analysis && typeof locator.analysis === 'object' ? locator.analysis as Record<string, unknown> : {};
    const feature = typeof analysis.featureId === 'string' ? analysisMap?.features.find(item => item.id === analysis.featureId) : undefined;
    // A path is a file citation, not a logical module claim. Infer only from
    // the saved feature/function inventory; otherwise the UI shows the file.
    const module = feature ? inferredModule(feature.label) : undefined;
    if (!module) continue;
    const files = groups.get(module) ?? new Set<string>();
    files.add(source.filePath);
    groups.set(module, files);
  }
  return [...groups].map(([module, files]) => ({ module, files: [...files].sort().slice(0, 8), inferred: true as const })).slice(0, 8);
}

function savedCodeProblem(finding: StoreFinding, source: { id: string; versionId?: string; contentHash: string; filePath: string } | undefined,
  manifest: Array<{ id: string; versionId?: string; contentHash: string; filePath: string }> | null, reviewId: string,
  excerpt?: string, currentStatus?: string, includeCurrentStatus = false): SavedConversationProblem {
  const location = finding.location ?? {};
  const sourceLocator = location.sourceLocator && typeof location.sourceLocator === 'object'
    ? location.sourceLocator as Record<string, unknown> : {};
  const path = source?.filePath ?? (typeof location.filePath === 'string' ? location.filePath : undefined);
  const lineNumber = typeof location.lineNumber === 'number' ? location.lineNumber
    : typeof sourceLocator.lineStart === 'number' ? sourceLocator.lineStart : undefined;
  const risk = deriveRiskLevel(finding.severity, finding.priority)
    ?? deriveRiskLevel(finding.severity, inferPriority(finding.severity, finding.category));
  const references = sourceReferences(finding, source, manifest);
  return {
    kind: 'code' as const, title: finding.title?.slice(0, 200) || 'Saved Code problem', reviewId,
    domain: typeof location.domain === 'string' ? location.domain : undefined,
    category: finding.category || undefined, severity: finding.severity, priority: finding.priority, risk,
    originalStatus: finding.status, ...(includeCurrentStatus && (currentStatus ? { currentStatus } : { currentStatusUnavailable: true })),
    location: path ? `${path}${lineNumber ? `:${lineNumber}` : ''}` : undefined,
    lineNumber, description: finding.description?.slice(0, 480) || undefined,
    recommendation: finding.recommendation?.slice(0, 320) || undefined,
    ...(excerpt ? { excerpt: excerpt.slice(0, 900) } : {}), evidenceUnavailable: !excerpt,
    sourceReferences: references,
    findingId: finding.id,
  };
}

function boundedEvidenceRows<T>(rows: T[], budget: number): T[] {
  let remaining = budget - 2;
  return rows.filter(row => {
    const length = compactCanonicalJson(row).length + 1;
    if (length > remaining) return false;
    remaining -= length;
    return true;
  });
}

const automationDirectories = new Set(['cypress', 'e2e', 'playwright', 'selenium', 'test-automation', 'automation']);

function sourceWindow(text: string, citedLine: unknown) {
  if (typeof citedLine !== 'number' || !Number.isSafeInteger(citedLine) || citedLine < 1) return undefined;
  const firstLine = Math.max(1, citedLine - 2);
  const lines: string[] = [];
  let offset = 0;
  for (let line = 1; line <= citedLine + 2; line++) {
    const newline = text.indexOf('\n', offset);
    const end = newline < 0 ? text.length : newline;
    if (line >= firstLine) lines.push(text.slice(offset, Math.min(end, offset + 220)).replace(/\r$/, ''));
    if (newline < 0) {
      if (line < citedLine) return undefined;
      break;
    }
    offset = newline + 1;
  }
  const window = lines.join('\n');
  return window.trim() ? { text: window, firstLine, citedLine } : undefined;
}

function matchesFindingSource(
  source: { id: string; versionId?: string; contentHash: string },
  finding: { artifactId?: string | null; artifactVersionId?: string | null; sourceVersion?: string | null },
) {
  if (source.id !== finding.artifactId || !source.versionId) return false;
  if (finding.artifactVersionId) return source.versionId === finding.artifactVersionId;
  // Some Reviews save the validated content hash without copying the artifact-version ID to the finding.
  return !!source.contentHash && finding.sourceVersion === source.contentHash;
}

export async function resolveConversationEvidence(client: SupabaseClient, ownerId: string, projectId: string, references: ConversationReference[], signal: AbortSignal, includeSourceWindow = false, requestText = '') {
  const repository = new SupabaseStaticReviewRepository(client);
  const application = new CentinelApplicationRepository(client, ownerId);
  const evidence = new Map<string, Evidence>();
  const add = (id: string, data: unknown, extra: Partial<Evidence> = {}) => {
    const text = compactCanonicalJson(data);
    if (text.length > 20000) throw new DynamicContractError(400, 'This evidence is too large. Select an individual problem.');
    evidence.set(id, { id, text, hash: hash(data), ...extra });
  };
  for (const reference of references) {
    signal.throwIfAborted();
    let codeObjective: string | undefined;
    let browserObjective: string | undefined;
    if (reference.reviewId) {
      const review = await repository.getReview(reference.reviewId);
      if (!review || review.projectId !== projectId) throw new DynamicContractError(404, 'The attached Review is unavailable in this project.');
      const manifest = review.sourceManifestId ? await repository.loadSourceManifestArtifacts(review.sourceManifestId) : null;
      let traceability: Awaited<ReturnType<SupabaseStaticReviewRepository['getTraceabilitySnapshot']>> = null;
      try { traceability = await repository.getTraceabilitySnapshot(review.id); }
      catch { signal.throwIfAborted(); }
      const store = new SupabaseCentinelStore(client);
      const all = await store.listFindings(projectId, review.id);
      const selected = reference.findingId ? all.filter(finding => finding.id === reference.findingId) : [];
      if (reference.findingId && selected.length !== 1) throw new DynamicContractError(404, 'The attached problem is unavailable in this Review.');
      const scopedSources = (manifest ?? []).filter(source => !reference.findingId || selected.some(finding => matchesFindingSource(source, finding)));
      let analysisMap: ReturnType<typeof analysisMapFromEvents> = null;
      try { analysisMap = analysisMapFromEvents(await repository.getHarnessEvents(projectId, review.id)); }
      catch { signal.throwIfAborted(); }
      const textCache = new Map<string, Promise<string | null>>();
      const readFrozen = (source: { id: string; versionId?: string; contentHash: string }) => {
        if (!source.versionId) return Promise.resolve(null);
        const key = `${source.id}:${source.versionId}`;
        let pending = textCache.get(key);
        if (!pending) {
          pending = readClientArtifactContent(client, ownerId, source.id, source.versionId, signal, projectId, source.contentHash)
            .catch(() => { signal.throwIfAborted(); return null; });
          textCache.set(key, pending);
        }
        return pending;
      };
      // Old saved rows can omit fields that current StoreFinding rows require.
      // Keep those records visible, while still excluding explicitly closed or informational findings.
      const openFindings = all.filter(finding => (finding.status == null || OPEN_FINDING_STATUSES.has(finding.status))
        && finding.severity?.toLowerCase() !== 'info');
      const savedProblems = boundedEvidenceRows(openFindings.slice(0, 12).map(finding => {
        const source = (manifest ?? []).find(item => matchesFindingSource(item, finding));
        const problem = savedCodeProblem(finding, source, manifest, review.id);
        return { ...problem, evidenceUnavailable: undefined, sourceReferences: problem.sourceReferences?.map(({ excerpt: _excerpt, ...sourceReference }) => sourceReference) };
      }), 8000);
      let selectedCurrentStatus: string | undefined;
      let selectedCurrentStatusUnavailable = false;
      if (selected.length) {
        selectedCurrentStatusUnavailable = true;
        try {
          const projectFindings = await store.listFindings(projectId);
          const current = await loadCurrentProjectFindings(client, projectId, projectFindings);
          const selectedId = selected[0].id;
          const projection = current.find(finding => finding.id === selectedId || finding.latestOccurrence?.findingId === selectedId
            || finding.lineageHistory?.some(item => item.findingId === selectedId));
          if (projection) {
            selectedCurrentStatus = currentStatusLabel(projection.status);
            selectedCurrentStatusUnavailable = !selectedCurrentStatus;
          }
        } catch { signal.throwIfAborted(); }
      }
      const affectedFiles = [...new Set(openFindings.flatMap(finding => {
        const source = (manifest ?? []).find(item => matchesFindingSource(item, finding));
        const savedPath = typeof finding.location?.filePath === 'string' ? finding.location.filePath : undefined;
        return source?.filePath ? [source.filePath] : savedPath ? [savedPath] : [];
      }))].slice(0, 16);
      const requirements = traceability?.status === 'available' ? boundedEvidenceRows(traceability.records.slice(0, 30).map(record => ({
        id: record.requirementId, title: record.title?.slice(0, 240), state: record.state,
      })), 2200) : undefined;
      const coverage = traceability?.status === 'available' && traceability.summary ? [
        `${traceability.summary.complete} requirements with complete mappings`,
        `${traceability.summary.incomplete} requirements with incomplete mappings`,
        `${traceability.summary.missing} requirements with missing mappings`,
        ...(traceability.summary.attention ? [`${traceability.summary.attention} requirements need attention`] : []),
        ...(traceability.summary.unavailable ? [`${traceability.summary.unavailable} requirements have unavailable evidence`] : []),
      ] : [];
      const originalRequestId = review.config?.conversationRequestId;
      const originalRequest = typeof originalRequestId === 'string' && /^[a-f0-9-]{36}$/i.test(originalRequestId)
        ? await new SupabaseConversationStore(client).get(projectId, originalRequestId) : null;
      const configuredObjective = !originalRequestId && typeof review.config?.instructions === 'string'
        ? review.config.instructions.trim() : '';
      const boilerplateObjective = /^review project sources against the configured requirements and standards\.?$/i.test(configuredObjective);
      const objective = originalRequest?.ownerId === ownerId && originalRequest.reviewId === review.id ? originalRequest.input.text
        : configuredObjective && !boilerplateObjective ? configuredObjective : undefined;
      codeObjective = objective?.slice(0, 500);
      add('review:' + review.id, { name: review.name, status: review.status, summary: review.summary?.slice(0, 1800),
        coverageIncomplete: review.progress?.coverage === 'partial' || undefined,
        objective: codeObjective,
        scopeMode: review.config?.scopeMode === 'full' || review.config?.scopeMode === 'focused' ? review.config.scopeMode : undefined,
        findingCount: openFindings.length, sourceCount: manifest?.length ?? null,
        scopeExamples: scopedSources.slice(0, 6).map(source => source.filePath),
        qualityEvidence: findingQualityEvidence(openFindings, new Map((manifest ?? []).map(source => [source.id, source.filePath]))),
        findingExamples: openFindings.slice(0, 8).map(finding => ({ title: finding.title?.slice(0, 200), status: finding.status,
          category: finding.category, domain: finding.location?.domain })),
        moreFindings: Math.max(0, openFindings.length - 8), omittedSourceCount: Math.max(0, scopedSources.length - 16),
        problems: savedProblems, moreProblems: Math.max(0, openFindings.length - savedProblems.length),
        affectedFiles, modules: moduleEvidence(openFindings, manifest, analysisMap), coverage, requirements,
        requirementsUnavailable: traceability?.status !== 'available',
        manifestId: review.sourceManifestId },
      { unavailable: !manifest });
      for (const finding of selected) {
        const source = scopedSources.find(item => matchesFindingSource(item, finding));
        let excerpt: string | null = null;
        let nearby: ReturnType<typeof sourceWindow>;
        if (source?.versionId) {
          const text = await readFrozen(source);
          if (text && finding.evidenceText && text.includes(finding.evidenceText)) excerpt = finding.evidenceText;
          if (includeSourceWindow && !excerpt && text) nearby = sourceWindow(text, finding.location?.lineNumber);
        }
        const problem = savedCodeProblem(finding, source, manifest, review.id, excerpt ?? undefined, selectedCurrentStatus, true);
        if (selectedCurrentStatusUnavailable) problem.currentStatusUnavailable = true;
        add('finding:' + finding.id, { title: finding.title, description: finding.description, recommendation: finding.recommendation, category: finding.category,
          problem,
          originalStatus: finding.status, reviewId: review.id, location: finding.location, excerpt, requirementId: finding.requirementId,
          requirement: traceability?.records.find(record => record.requirementId === finding.requirementId) ?? null,
          path: source?.filePath ?? (includeSourceWindow && typeof finding.location?.filePath === 'string' ? finding.location.filePath : null),
          ...(nearby ? { nearby } : {}) },
        { artifactId: source?.id, versionId: source?.versionId, unavailable: !excerpt });
      }
      // Bind scoped code execution to the selected frozen source identities.
      for (const source of scopedSources.slice(0, 16)) {
        add('source:' + source.id + ':' + source.versionId, { path: source.filePath, hash: source.contentHash, versionId: source.versionId },
          { artifactId: source.id, versionId: source.versionId, unavailable: !source.versionId });
      }
    }
    if (reference.autoTestId) {
      const session = await new SupabaseAutoTestStore(client, ownerId).get(projectId, reference.autoTestId);
      if (!session || session.projectId !== projectId) throw new DynamicContractError(404, 'The attached browser check is unavailable.');
      const tests = reference.testId ? session.tests.filter(test => test.id === reference.testId) : session.tests;
      if (reference.testId && tests.length !== 1) throw new DynamicContractError(404, 'The attached browser problem is unavailable.');
      browserObjective = session.request?.text?.split('\nVerification goal:', 1)[0]?.trim().slice(0, 500)
        || undefined;
      const browserTests = tests.filter(test => test.kind !== 'unit');
      const hasObservedResult = (results: typeof browserTests[number]['checkResults']) => (results ?? []).some(result => result.verdict !== 'not_tested');
      const evidenceAttempt = (test: typeof browserTests[number]) => hasObservedResult(test.checkResults) ? 'current' as const
        : hasObservedResult(test.firstAttempt?.checkResults) ? 'earlier' as const
          : test.runId || !test.firstAttempt?.runId ? 'current' as const : 'earlier' as const;
      const resultsFor = (test: typeof browserTests[number], attempt = evidenceAttempt(test)) => attempt === 'earlier'
        ? test.firstAttempt?.checkResults ?? [] : test.checkResults ?? [];
      const runIdFor = (test: typeof browserTests[number], attempt = evidenceAttempt(test)) => attempt === 'earlier'
        ? test.firstAttempt?.runId ?? undefined : test.runId ?? undefined;
      const currentExplanation = (test: typeof browserTests[number]) => test.explanation?.trim() || undefined;
      const earlierExplanation = (test: typeof browserTests[number]) => test.firstAttempt?.explanation?.trim() || undefined;
      const failedButNotConfirmed = (test: typeof browserTests[number]) => test.state === 'failed'
        && test.firstAttempt?.state === 'failed' && !!test.firstAttempt.runId && test.runId === test.firstAttempt.runId;
      const hasBrowserProof = (test: typeof browserTests[number]) => session.stage === 'completed'
        && test.state === 'failed' && !failedButNotConfirmed(test);
      const coverageFor = (test: typeof browserTests[number]) => session.stage === 'failed' || session.stage === 'cancelled'
        || ['blocked', 'not_tested', 'cancelled'].includes(test.state) ? 'stopped' as const
        : session.stage !== 'completed' || test.state === 'uncertain' || failedButNotConfirmed(test)
          || test.checks?.some(check => check.required && !resultsFor(test).some(result =>
            result.checkId === check.id && (result.verdict === 'passed' || result.verdict === 'failed'))) ? 'partial' as const : undefined;
      const completeAssertions = browserTests.length > 0 && browserTests.every(test => runIdFor(test) && test.checks?.length
        && test.checks.every(check => resultsFor(test).some(result => result.checkId === check.id
          && (result.verdict === 'passed' || result.verdict === 'failed'))));
      const failedAssertions = browserTests.reduce((count, test) => count + (runIdFor(test)
        ? new Set(resultsFor(test).filter(result => result.verdict === 'failed').map(result => result.checkId)).size : 0), 0);
      const selectedTest = reference.testId ? browserTests[0] : undefined;
      const browserChecks = (test: typeof browserTests[number], attempt = evidenceAttempt(test)) => resultsFor(test, attempt).slice(0, 8).map(result => {
        const definition = test.checks?.find(check => check.id === result.checkId);
        const expected = definition as unknown as Record<string, unknown> | undefined;
        const expectedValue = typeof expected?.expected === 'string' || typeof expected?.expected === 'number' ? String(expected.expected) : undefined;
        const observed = result.observed?.trim() ?? '';
        const description = typeof expected?.description === 'string' ? expected.description.slice(0, 160) : '';
        return { check: description || 'Saved assertion', expected: description || expectedValue,
          observed: !observed || /^expected .* absent\.?$/i.test(observed) ? 'This was not shown on the page.' : observed.slice(0, 220),
          verdict: result.verdict };
      });
      const sourceScope = [...new Set(browserTests.flatMap(test => (Array.isArray(test.sourceRefs) ? test.sourceRefs : [])
        .map(ref => ref?.path).filter((path): path is string => typeof path === 'string' && !!path)))].slice(0, 16);
      const selectedEvidenceAttempt = selectedTest ? evidenceAttempt(selectedTest) : 'current';
      const browserStatus = selectedTest ? await currentBrowserStatus(client, projectId, runIdFor(selectedTest), signal) : undefined;
      const selectedRunId = selectedTest ? runIdFor(selectedTest) : undefined;
      const browserProblem = selectedTest ? {
        kind: 'browser' as const, title: (selectedTest.name || 'Saved Browser problem').slice(0, 200), category: 'Browser',
        originalStatus: selectedTest.state, description: selectedTest.goal?.slice(0, 480),
        ...(browserStatus ? { currentStatus: browserStatus } : { currentStatusUnavailable: true }),
        location: selectedTest.sourceRefs?.[0] ? `${selectedTest.sourceRefs[0].path}${selectedTest.sourceRefs[0].line ? `:${selectedTest.sourceRefs[0].line}` : ''}` : undefined,
        browserCoverage: coverageFor(selectedTest),
        browserProof: hasBrowserProof(selectedTest),
        browserEvidenceAttempt: selectedEvidenceAttempt,
        browserChecks: browserChecks(selectedTest).filter(item => item.verdict !== 'not_tested').map(item => ({ expected: item.expected || 'Unavailable', observed: item.observed })),
        aiExplanation: (currentExplanation(selectedTest) || earlierExplanation(selectedTest))?.slice(0, 480) || undefined,
        aiExplanationFromEarlier: !currentExplanation(selectedTest) && !!earlierExplanation(selectedTest),
        aiExplanationRunId: currentExplanation(selectedTest) ? selectedTest.runId : selectedTest.firstAttempt?.runId ?? undefined,
        ...(selectedTest.firstAttempt && { firstAttempt: {
          runId: selectedTest.firstAttempt.runId ?? undefined, state: selectedTest.firstAttempt.state,
          browserChecks: browserChecks(selectedTest, 'earlier').filter(item => item.verdict !== 'not_tested')
            .map(item => ({ expected: item.expected || 'Unavailable', observed: item.observed })),
          aiExplanation: earlierExplanation(selectedTest)?.slice(0, 480) || undefined,
        } }),
        runId: selectedRunId, testId: selectedTest.id,
      } : undefined;
      const serializableTests = boundedEvidenceRows(browserTests.slice(0, reference.testId ? 1 : 20).map(test => {
        const attempt = evidenceAttempt(test);
        const priorChecks = browserChecks(test, 'earlier');
        const hasPriorAttemptEvidence = !!test.firstAttempt?.runId || priorChecks.length > 0 || !!earlierExplanation(test);
        return {
        id: test.id, name: (test.name || 'Saved Browser test').slice(0, 120), goal: test.goal?.slice(0, 300) ?? '', state: test.state,
        runId: runIdFor(test), checks: browserChecks(test), explanation: (currentExplanation(test) || earlierExplanation(test))?.slice(0, 480) || undefined,
        explanationFromEarlier: !currentExplanation(test) && !!earlierExplanation(test),
        explanationRunId: currentExplanation(test) ? test.runId ?? undefined : test.firstAttempt?.runId ?? undefined,
        evidenceAttempt: attempt,
        browserProof: hasBrowserProof(test), browserCoverage: coverageFor(test),
        ...(hasPriorAttemptEvidence && attempt === 'current' ? { earlierAttempt: {
          runId: test.firstAttempt?.runId ?? undefined, checks: priorChecks,
          explanation: earlierExplanation(test)?.slice(0, 480),
        } } : {}),
        definitions: test.checks, controls: test.controls,
        startPath: test.startPath,
        requirementRef: test.requirementRef,
        sources: (test.sourceRefs ?? []).slice(0, 12),
      }; }), 12000);
      add('browser:' + session.id + (reference.testId ? ':' + reference.testId : ''), {
        repository: session.repository, stage: session.stage, objective: browserObjective,
        ...(reference.testId ? { selectedTestId: reference.testId } : {}),
        failedAssertions: completeAssertions || failedAssertions ? failedAssertions : null,
        assertionCountPartial: (!completeAssertions && failedAssertions > 0) || session.stage !== 'completed',
        provenProblemCount: session.stage === 'completed' ? browserTests.filter(hasBrowserProof).length : null,
        failedTests: browserTests.filter(test => test.state === 'failed').length,
        testCount: browserTests.length,
        testCountPartial: session.stage !== 'completed',
        passedTests: browserTests.filter(test => test.state === 'passed').length,
        incompleteTests: browserTests.filter(test => !['passed', 'failed'].includes(test.state)).length,
        sourceScope, problem: browserProblem, moreTests: Math.max(0, browserTests.length - serializableTests.length), tests: serializableTests,
      }, { unavailable: browserTests.some(test => !runIdFor(test) || !resultsFor(test).length) });
    }
    if (reference.artifactId) {
      const source = (await listClientArtifacts(application, projectId)).find(item => item.id === reference.artifactId && !item.currency?.deprecated);
      if (!source?.versionId) throw new DynamicContractError(404, 'The attached source version is unavailable.');
      const bytes = await application.downloadFrozenArtifactVersion({ projectId, versionId: source.versionId,
        artifactId: source.id, expectedContentHash: source.contentHash }, signal);
      let text: string | undefined;
      try {
        const extracted = await verifiedSourceText(source, bytes, signal);
        if (!extracted.text.includes('\0')) text = extracted.text;
      } catch {
        signal.throwIfAborted();
      }
      const identity = { artifactId: source.id, versionId: source.versionId };
      if (!text?.trim()) {
        add('artifact:' + source.id, { path: source.filePath, limitation: 'Readable text is unavailable for this file.' }, { ...identity, unavailable: true });
      } else {
        let content = text.slice(0, 12_000);
        while (JSON.stringify(content).length > 16_000) content = content.slice(0, Math.floor(content.length / 2));
        add('artifact:' + source.id, { path: source.filePath, content,
          ...(content.length < text.length && { limitation: 'Only the beginning of this file is supplied.' }) }, identity);
      }
    }
  }
  const checkGroups = new Map<string, { reviewId?: string; autoTestId?: string; checkId?: string }>();
  for (const reference of references) {
    if (reference.findingId || reference.testId) continue;
    const checkId = typeof reference.checkId === 'string' && /^[a-f0-9-]{36}$/i.test(reference.checkId) ? reference.checkId : undefined;
    if (!checkId && !(reference.reviewId && reference.autoTestId)) continue;
    const key = checkId ?? `${reference.reviewId}:${reference.autoTestId}`;
    const prior = checkGroups.get(key) ?? {};
    checkGroups.set(key, { ...prior, ...(reference.reviewId ? { reviewId: reference.reviewId } : {}),
      ...(reference.autoTestId ? { autoTestId: reference.autoTestId } : {}), ...(checkId ? { checkId } : {}) });
  }
  for (const [key, refs] of checkGroups) {
    const review = refs.reviewId ? evidence.get(`review:${refs.reviewId}`) : undefined;
    const browser = refs.autoTestId ? evidence.get(`browser:${refs.autoTestId}`) : undefined;
    const codeObjective = review ? JSON.parse(review.text).objective : undefined;
    const browserObjective = browser ? JSON.parse(browser.text).objective : undefined;
    add(`check:${refs.checkId ?? key}`, { reviewId: refs.reviewId, autoTestId: refs.autoTestId,
      codeObjective: typeof codeObjective === 'string' ? codeObjective : undefined,
      browserObjective: typeof browserObjective === 'string' ? browserObjective : undefined });
  }
  if (!references.length) {
    const project = await application.getProject(projectId);
    if (!project) throw new DynamicContractError(404, 'Project unavailable.');
    const sources = await listClientArtifacts(application, projectId, signal);
    const module = namedReviewScope(requestText);
    if (module) {
      const matches = sources.flatMap(source => {
        if (source.source !== 'repository' || !source.versionId || source.currency?.deprecated) return [];
        const path = source.filePath.replace(/\\/g, '/').replace(/^\.\//, '');
        const normalized = path.toLowerCase();
        const repositoryPrefix = /^local-repositories\/[^/]+\//.exec(normalized)?.[0] ?? '';
        const relative = normalized.slice(repositoryPrefix.length);
        const folders = normalized.split('/').slice(0, -1);
        const roots = folders.flatMap((folder, index) => folder === module || module === 'automation' && automationDirectories.has(folder)
          ? [path.split('/').slice(0, index + 1).join('/')] : []);
        const exact = (value: string) => value === module || value.startsWith(module + '/');
        const root = exact(normalized) ? path.slice(0, module.length)
          : exact(relative) ? path.slice(0, repositoryPrefix.length + module.length) : roots[0];
        return root ? [{ source, path, root }] : [];
      });
      const roots = [...new Set(matches.map(item => item.root))].sort();
      add('module:' + projectId, { module, roots: roots.slice(0, 8), rootCount: roots.length, count: matches.length });
      if (roots.length === 1 && matches.length <= 100) {
        for (const { source, path } of matches.sort((a, b) => a.path.localeCompare(b.path))) {
          add('module-source:' + source.id, { path, versionId: source.versionId, hash: source.contentHash },
            { artifactId: source.id, versionId: source.versionId });
        }
      }
      return [...evidence.values()];
    }
    add('project:' + projectId, { name: project.name, description: project.description, sources: sources.slice(0, 100).map(item => ({ id: item.id, path: item.filePath })),
      limitation: 'Inventory only. Attach checks or source files for evidence-based explanations and code verification.' });
  }
  return [...evidence.values()];
}
