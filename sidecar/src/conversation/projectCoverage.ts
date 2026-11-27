import type { SupabaseClient } from '@supabase/supabase-js';
import { listClientArtifacts, readClientArtifactContent } from '../applicationApi.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { SupabaseStaticReviewRepository } from '../review/supabaseRepository.js';
import { SupabaseAutoTestStore } from '../dynamic/autonomous/store.js';
import type { AutoTestSession } from '../dynamic/autonomous/orchestrator.js';
import { detectRoutes, type DetectedRoute } from '../dynamic/autonomous/routeDetector.js';

const HISTORY_LIMIT = 50;
const ROW_LIMIT = 16;
const uncheckedLabels: Record<string, string> = { queued: 'Queued', running: 'In progress', blocked: 'Blocked', cancelled: 'Stopped', not_tested: 'Not run' };
const requirementKey = (value: string) => /\bREQ[-_ ]?(\d+)\b/i.exec(value)?.[1];
const escapeCell = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\|`*_\[\]<>]/g, '\\$&').trim().slice(0, 180);
type Area = { key: string; label: string; tag?: string; requirementId?: string; sourcePath?: string };

export function documentedAreas(text: string): Area[] {
  return [...text.matchAll(/^#{1,6}\s+(REQ[-_ ]?\d+)\s*(?:[:—–-]\s*)?([^\r\n]+)$/gim)].map(match =>
    ({ key: requirementKey(match[1])!, label: match[2].trim(), tag: match[1].toUpperCase() }));
}

export function formatProjectCoverage(areas: Area[], sessions: AutoTestSession[], sourceCount: number | null, currentReview: {
  covered: number; partial: number; missing: string[]; total: number; reportedGaps?: string[];
} | null, sourceInventory: string[], inventoryLimited: boolean, unavailable: boolean, routes: DetectedRoute[] = []) {
  const lines: string[] = [];
  const savedTests = sessions.flatMap(session => session.tests.filter(test => test.kind !== 'unit')
    .map(test => ({ test, covered: (test.state === 'passed' || test.state === 'failed')
      && Boolean(test.runId && test.checkResults?.some(result => result.verdict === 'passed' || result.verdict === 'failed')) })));
  const testState = (covered: boolean, state: string) => covered ? state === 'passed' ? 'Passed' : 'Failed'
    : uncheckedLabels[state] ?? 'No confirmed outcome';
  const summarizeTests = (items: typeof savedTests) => items.slice(0, 3).map(({ test, covered }) =>
    `${escapeCell(test.name)} (${testState(covered, test.state).toLowerCase()})`).join(', ')
    + (items.length > 3 ? ` and ${items.length - 3} more` : '');
  const areasByKey = new Map<string, Area>();
  const requirementIds = new Map<string, string>();
  for (const area of areas) {
    if (!areasByKey.has(area.key)) areasByKey.set(area.key, area);
    if (area.requirementId) requirementIds.set(area.requirementId, area.key);
  }
  const uniqueAreas = [...areasByKey.values()];
  const testKey = (ref?: string | null) => ref ? requirementIds.get(ref.toLowerCase()) ?? requirementKey(ref) ?? ref.toLowerCase() : '';
  if (uniqueAreas.length) {
    lines.push('**Documented project scope**', '');
    const sourcePaths = [...new Set(areas.flatMap(area => area.sourcePath ? [escapeCell(area.sourcePath)] : []))];
    if (sourcePaths.length) lines.push(`Requirements found in ${sourcePaths.join(', ')}.`, '');
    lines.push('| Area | Saved Browser outcomes | Still unchecked |', '| --- | --- | --- |');
    for (const area of uniqueAreas.slice(0, ROW_LIMIT)) {
      const tests = savedTests.filter(({ test }) => testKey(test.requirementRef) === area.key);
      const outcomes = summarizeTests(tests.filter(item => item.covered));
      const unchecked = summarizeTests(tests.filter(item => !item.covered));
      lines.push(`| ${escapeCell(area.label)}${area.tag ? ` (${escapeCell(area.tag)})` : ''} | ${outcomes || '—'} | ${unchecked || (tests.length ? '—' : 'No explicitly linked test.')} |`);
    }
    if (uniqueAreas.length > ROW_LIMIT) lines.push('', `Showing ${ROW_LIMIT} of ${uniqueAreas.length} documented areas.`);
    lines.push('', 'Each result covers its recorded assertions. The table reports gaps visible in the saved tests.');
  } else {
    lines.push('**Discoverable scope**', '', sourceCount === null
      ? 'The source inventory and documented behavior list are unavailable.'
      : `The saved inventory has ${sourceCount} source files. A documented behavior list is unavailable.`);
    if (routes.length) {
      lines.push('', '| Route found in code | Saved Browser coverage |', '| --- | --- |');
      for (const route of routes.slice(0, ROW_LIMIT)) {
        const observed = route.kind === 'page' && savedTests.some(({ test, covered }) => covered && test.startPath === route.path);
        lines.push(`| ${escapeCell([route.method, route.path].filter(Boolean).join(' '))} | ${observed ? 'A saved test started on this page.' : 'No directly linked result.'} |`);
      }
    } else if (sourceInventory.length) lines.push('', ...sourceInventory.slice(0, 8).map(path => `- ${escapeCell(path)}`));
  }
  const unlinked = savedTests.filter(({ test }) => !areasByKey.has(testKey(test.requirementRef)))
    .sort((a, b) => Number(b.covered) - Number(a.covered));
  if (unlinked.length) {
    lines.push('', '**Other recorded Browser tests**', '', ...unlinked.slice(0, 8).map(({ test, covered }) =>
      `- ${escapeCell(test.name)} · ${testState(covered, test.state)}`));
    if (unlinked.length > 8) lines.push(`- ${unlinked.length - 8} more saved tests in the inspected history.`);
  } else if (!savedTests.length && !unavailable) lines.push('', 'No Browser tests were found in the inspected history.');
  lines.push('', '**Code Review coverage**', '');
  if (currentReview) {
    lines.push(`- ${currentReview.covered} of ${currentReview.total} current files appear in a completed Review manifest without recorded coverage gaps.`);
    if (currentReview.partial) lines.push(`- ${currentReview.partial} current files appear only in partial Review manifests.`);
    if (currentReview.reportedGaps?.length) lines.push(`- Partial Reviews reported gaps involving ${currentReview.reportedGaps.slice(0, 6).map(escapeCell).join(', ')}.`);
    if (currentReview.missing.length) lines.push(`- ${currentReview.missing.length} current files have no matching completed Review manifest. Examples: ${currentReview.missing.slice(0, 6).map(escapeCell).join(', ')}.`);
  } else lines.push('The current source versions or completed Review history could not be loaded.');
  if (inventoryLimited || unavailable) lines.push('', 'Coverage is limited to the records ORIN could load. Missing evidence leaves the scope open.');
  return lines.join('\n');
}

export async function loadProjectCoverage(client: SupabaseClient, ownerId: string, projectId: string, signal: AbortSignal) {
  const application = new CentinelApplicationRepository(client, ownerId);
  const repository = new SupabaseStaticReviewRepository(client);
  const [sourcesResult, requirementsResult, historyResult, sessionsResult] = await Promise.allSettled([
    listClientArtifacts(application, projectId, signal),
    application.listRequirements(projectId),
    repository.listReviews(projectId),
    new SupabaseAutoTestStore(client, ownerId).list(projectId, HISTORY_LIMIT + 1),
  ]);
  signal.throwIfAborted();
  const sources = sourcesResult.status === 'fulfilled' ? sourcesResult.value : [];
  const requirements = requirementsResult.status === 'fulfilled' ? requirementsResult.value : [];
  const history = historyResult.status === 'fulfilled' ? historyResult.value : [];
  const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : [];
  const current = sources.filter(source => !source.currency?.deprecated && source.versionId);
  const areas: Area[] = requirements.map(requirement => {
    const key = requirementKey(requirement.title);
    return { key: key ?? requirement.id.toLowerCase(), requirementId: requirement.id.toLowerCase(), tag: key ? `REQ-${key}` : undefined,
      label: requirement.title.replace(/^\s*REQ[-_ ]?\d+\s*[:—–-]?\s*/i, '') || requirement.title };
  });
  const requirementDocs = current.filter(source => /(?:^|[/\\])(?:[^/\\]*-)?requirements\.(?:md|txt)$/i.test(source.filePath)).slice(0, 3);
  const documents = await Promise.allSettled(requirementDocs.map(source =>
    readClientArtifactContent(client, ownerId, source.id, source.versionId, signal, projectId, source.contentHash)));
  documents.forEach((document, index) => {
    if (document.status === 'fulfilled') areas.push(...documentedAreas(document.value.slice(0, 24_000))
      .map(area => ({ ...area, sourcePath: requirementDocs[index].filePath })));
  });
  const reviews = history.filter(review => review.sourceManifestId && ['pending_approval', 'completed', 'approved'].includes(review.status)).slice(0, HISTORY_LIMIT);
  const manifestMatches = new Map<string, 'covered' | 'partial'>();
  const versions = new Map(current.map(source => [source.id, source.versionId]));
  const currentPaths = new Map(current.map(source => [source.id, source.filePath]));
  const reportedGaps = new Set<string>();
  let unavailable = [sourcesResult, requirementsResult, historyResult, sessionsResult, ...documents].some(result => result.status === 'rejected');
  const routeSources = !areas.length ? current.filter(source => source.source === 'repository' && /\.(?:[cm]?[jt]sx?|html?)$/i.test(source.filePath)) : [];
  const routeFiles: Array<{ path: string; text: string }> = [];
  for (let index = 0; index < Math.min(24, routeSources.length); index += 4) {
    signal.throwIfAborted();
    await Promise.all(routeSources.slice(index, index + 4).map(async source => {
      try {
        const content = await readClientArtifactContent(client, ownerId, source.id, source.versionId, signal, projectId, source.contentHash);
        routeFiles.push({ path: source.filePath, text: content.slice(0, 24_000) });
        if (content.length > 24_000) unavailable = true;
      } catch { signal.throwIfAborted(); unavailable = true; }
    }));
  }
  for (let index = 0; index < reviews.length; index += 4) {
    signal.throwIfAborted();
    await Promise.all(reviews.slice(index, index + 4).map(async review => {
      const manifest = await repository.loadSourceManifestArtifacts(review.sourceManifestId!).catch(() => null);
      if (!manifest) { unavailable = true; return; }
      const sameVersionPaths = new Set<string>();
      for (const item of manifest) {
        if (!item.versionId || versions.get(item.id) !== item.versionId) continue;
        const path = currentPaths.get(item.id);
        if (path) sameVersionPaths.add(path);
        if (manifestMatches.get(item.id) === 'covered') continue;
        manifestMatches.set(item.id, review.progress?.coverage === 'partial' || review.modelStatus !== 'succeeded' ? 'partial' : 'covered');
      }
      for (const part of review.progress?.unverifiedParts ?? []) {
        for (const path of part.files) if (sameVersionPaths.has(path)) reportedGaps.add(path);
      }
    }));
  }
  signal.throwIfAborted();
  const covered = [...manifestMatches.values()].filter(value => value === 'covered').length;
  const reviewCoverage = sourcesResult.status === 'fulfilled' && historyResult.status === 'fulfilled' ? {
    covered, partial: manifestMatches.size - covered, total: current.length,
    missing: current.filter(source => !manifestMatches.has(source.id)).map(source => source.filePath),
    reportedGaps: [...reportedGaps].sort(),
  } : null;
  return formatProjectCoverage(areas, sessions.slice(0, HISTORY_LIMIT), sourcesResult.status === 'fulfilled' ? current.length : null, reviewCoverage,
  current.map(source => source.filePath), history.length > HISTORY_LIMIT || sessions.length > HISTORY_LIMIT || routeSources.length > 24,
  unavailable, detectRoutes(routeFiles.sort((a, b) => a.path.localeCompare(b.path))).filter(route => route.kind !== 'client_call'));
}
