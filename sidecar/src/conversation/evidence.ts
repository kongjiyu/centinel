import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationReference } from './types.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { listClientArtifacts, readClientArtifactContent } from '../applicationApi.js';
import { SupabaseCentinelStore } from '../store/index.js';
import { SupabaseStaticReviewRepository } from '../review/supabaseRepository.js';
import type { AutoTestStore } from '../dynamic/autonomous/store.js';
import { DynamicContractError } from '../dynamic/types.js';
import { hash, type Evidence } from './service.js';
import { compactCanonicalJson } from '../report/canonical.js';
import { namedReviewScope } from './intent.js';
import type { Artifact } from '../artifacts.js';
import type { StaticReviewRepository } from '../review/types.js';
import type { StoreFinding, StoreProject } from '../store/types.js';

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

export async function resolveConversationEvidence(client: SupabaseClient, ownerId: string, projectId: string, references: ConversationReference[], signal: AbortSignal, includeSourceWindow = false, requestText = '', autoTests?: AutoTestStore) {
  const application = new CentinelApplicationRepository(client, ownerId);
  return resolveSavedConversationEvidence(projectId, references, signal, includeSourceWindow, requestText, {
    repository: new SupabaseStaticReviewRepository(client),
    project: () => application.getProject(projectId),
    artifacts: () => listClientArtifacts(application, projectId, signal),
    findings: reviewId => new SupabaseCentinelStore(client).listFindings(projectId, reviewId),
    content: source => readClientArtifactContent(client, ownerId, source.id, source.versionId, signal, projectId, source.contentHash),
    autoTests,
  });
}

type EvidenceSources = {
  repository: Pick<StaticReviewRepository, 'getReview' | 'loadSourceManifestArtifacts' | 'getTraceabilitySnapshot'>;
  project: () => Promise<Pick<StoreProject, 'name' | 'description'> | null>;
  artifacts: () => Promise<Artifact[]>;
  findings: (reviewId: string) => Promise<Array<Pick<StoreFinding, 'id' | 'artifactId' | 'artifactVersionId' | 'title' | 'description' | 'recommendation' | 'status' | 'location' | 'evidenceText' | 'requirementId'>>>;
  content: (source: Artifact) => Promise<string>;
  autoTests?: AutoTestStore;
};

export async function resolveSavedConversationEvidence(projectId: string, references: ConversationReference[], signal: AbortSignal,
  includeSourceWindow: boolean, requestText: string, sources: EvidenceSources) {
  const { repository, autoTests } = sources;
  const evidence = new Map<string, Evidence>();
  const add = (id: string, data: unknown, extra: Partial<Evidence> = {}) => {
    const text = compactCanonicalJson(data);
    if (text.length > 20000) throw new DynamicContractError(400, 'This evidence is too large. Select an individual problem.');
    evidence.set(id, { id, text, hash: hash(data), ...extra });
  };
  for (const reference of references) {
    signal.throwIfAborted();
    if (reference.reviewId) {
      const review = await repository.getReview(reference.reviewId);
      if (!review || review.projectId !== projectId) throw new DynamicContractError(404, 'The attached Review is unavailable in this project.');
      const manifest = review.sourceManifestId ? await repository.loadSourceManifestArtifacts(review.sourceManifestId) : null;
      const traceability = reference.findingId ? await repository.getTraceabilitySnapshot(review.id) : null;
      const all = await sources.findings(review.id);
      const selected = reference.findingId ? all.filter(finding => finding.id === reference.findingId) : [];
      if (reference.findingId && selected.length !== 1) throw new DynamicContractError(404, 'The attached problem is unavailable in this Review.');
      const scopedSources = (manifest ?? []).filter(source => !reference.findingId || selected.some(finding => finding.artifactId === source.id && finding.artifactVersionId === source.versionId));
      add('review:' + review.id, { name: review.name, status: review.status, summary: review.summary?.slice(0, 1800),
        findingCount: all.length, sourceCount: manifest?.length ?? null,
        findingExamples: all.slice(0, 8).map(finding => ({ title: finding.title.slice(0, 200), status: finding.status })),
        moreFindings: Math.max(0, all.length - 8), omittedSourceCount: Math.max(0, scopedSources.length - 16), manifestId: review.sourceManifestId },
      { unavailable: !manifest });
      for (const finding of selected) {
        const source = manifest?.find(item => item.id === finding.artifactId && item.versionId === finding.artifactVersionId);
        let excerpt: string | null = null;
        let nearby: ReturnType<typeof sourceWindow>;
        if (source?.versionId) {
          try {
            const text = await sources.content(source);
            if (finding.evidenceText && text.includes(finding.evidenceText)) excerpt = finding.evidenceText;
            if (includeSourceWindow && !excerpt) nearby = sourceWindow(text, finding.location?.lineNumber);
          } catch { signal.throwIfAborted(); }
        }
        add('finding:' + finding.id, { title: finding.title, description: finding.description, recommendation: finding.recommendation,
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
      const session = await autoTests?.get(projectId, reference.autoTestId);
      if (!session || session.projectId !== projectId) throw new DynamicContractError(404, 'The attached browser check is unavailable.');
      const tests = reference.testId ? session.tests.filter(test => test.id === reference.testId) : session.tests;
      if (reference.testId && tests.length !== 1) throw new DynamicContractError(404, 'The attached browser problem is unavailable.');
      add('browser:' + session.id + (reference.testId ? ':' + reference.testId : ''), {
        repository: session.repository, stage: session.stage, tests: tests.map(test => ({ id: test.id, name: test.name, goal: test.goal,
          runId: test.runId, state: test.state, checks: test.checkResults ?? [], definitions: test.checks,
          controls: test.controls, startPath: test.startPath, requirementRef: test.requirementRef, sources: test.sourceRefs })),
      }, { unavailable: tests.some(test => !test.runId || !test.checkResults?.length) });
    }
    if (reference.artifactId) {
      const source = (await sources.artifacts()).find(item => item.id === reference.artifactId && !item.currency?.deprecated);
      if (!source?.versionId) throw new DynamicContractError(404, 'The attached source version is unavailable.');
      const text = await sources.content(source);
      add('artifact:' + source.id, { path: source.filePath, content: text }, { artifactId: source.id, versionId: source.versionId });
    }
  }
  if (!references.length) {
    const project = await sources.project();
    if (!project) throw new DynamicContractError(404, 'Project unavailable.');
    const artifacts = await sources.artifacts();
    const module = namedReviewScope(requestText);
    if (module) {
      const matches = artifacts.flatMap(source => {
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
    add('project:' + projectId, { name: project.name, description: project.description, sources: artifacts.slice(0, 100).map(item => ({ id: item.id, path: item.filePath })),
      limitation: 'Inventory only. Attach checks or source files for evidence-based explanations and code verification.' });
  }
  return [...evidence.values()];
}
