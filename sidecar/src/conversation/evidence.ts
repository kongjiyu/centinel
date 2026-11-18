import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationReference } from './types.js';
import { CentinelApplicationRepository } from '../applicationRepository.js';
import { listClientArtifacts, readClientArtifactContent } from '../applicationApi.js';
import { SupabaseCentinelStore } from '../store/index.js';
import { SupabaseStaticReviewRepository } from '../review/supabaseRepository.js';
import { SupabaseAutoTestStore } from '../dynamic/autonomous/store.js';
import { DynamicContractError } from '../dynamic/types.js';
import { hash, type Evidence } from './service.js';
import { compactCanonicalJson } from '../report/canonical.js';

export async function resolveConversationEvidence(client: SupabaseClient, ownerId: string, projectId: string, references: ConversationReference[], signal: AbortSignal) {
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
    if (reference.reviewId) {
      const review = await repository.getReview(reference.reviewId);
      if (!review || review.projectId !== projectId) throw new DynamicContractError(404, 'The attached Review is unavailable in this project.');
      const manifest = review.sourceManifestId ? await repository.loadSourceManifestArtifacts(review.sourceManifestId) : null;
      const traceability = await repository.getTraceabilitySnapshot(review.id);
      const all = await new SupabaseCentinelStore(client).listFindings(projectId, review.id);
      const selected = reference.findingId ? all.filter(finding => finding.id === reference.findingId) : all;
      if (reference.findingId && selected.length !== 1) throw new DynamicContractError(404, 'The attached problem is unavailable in this Review.');
      if (selected.length > 12) throw new DynamicContractError(400, 'This Review has many problems. Attach individual problems instead.');
      add('review:' + review.id, { name: review.name, status: review.status, summary: review.summary, manifestId: review.sourceManifestId,
        sources: (manifest ?? []).map(item => ({ artifactId: item.id, versionId: item.versionId, hash: item.contentHash, path: item.filePath })) },
      { unavailable: !manifest });
      for (const finding of selected) {
        const source = manifest?.find(item => item.id === finding.artifactId && item.versionId === finding.artifactVersionId);
        let excerpt: string | null = null;
        if (source?.versionId) {
          try {
            const text = await readClientArtifactContent(client, ownerId, source.id, source.versionId, signal, projectId, source.contentHash);
            if (finding.evidenceText && text.includes(finding.evidenceText)) excerpt = finding.evidenceText;
          } catch { signal.throwIfAborted(); }
        }
        add('finding:' + finding.id, { title: finding.title, description: finding.description, recommendation: finding.recommendation,
          originalStatus: finding.status, reviewId: review.id, location: finding.location, excerpt, requirementId: finding.requirementId,
          requirement: traceability?.records.find(record => record.requirementId === finding.requirementId) ?? null, path: source?.filePath ?? null },
        { artifactId: source?.id, versionId: source?.versionId, unavailable: !excerpt });
      }
      // Bind scoped code execution to the selected frozen source identities.
      for (const source of manifest ?? []) {
        if (selected.length && !selected.some(finding => finding.artifactId === source.id)) continue;
        add('source:' + source.id + ':' + source.versionId, { path: source.filePath, hash: source.contentHash, versionId: source.versionId },
          { artifactId: source.id, versionId: source.versionId, unavailable: !source.versionId });
      }
    }
    if (reference.autoTestId) {
      const session = await new SupabaseAutoTestStore(client, ownerId).get(projectId, reference.autoTestId);
      if (!session || session.projectId !== projectId) throw new DynamicContractError(404, 'The attached browser check is unavailable.');
      const tests = reference.testId ? session.tests.filter(test => test.id === reference.testId) : session.tests;
      if (reference.testId && tests.length !== 1) throw new DynamicContractError(404, 'The attached browser problem is unavailable.');
      add('browser:' + session.id + (reference.testId ? ':' + reference.testId : ''), {
        repository: session.repository, stage: session.stage, tests: tests.map(test => ({ id: test.id, name: test.name, goal: test.goal,
          runId: test.runId, state: test.state, checks: test.checkResults ?? [], definitions: test.checks,
          controls: test.controls ?? [], startPath: test.startPath, requirementRef: test.requirementRef, sources: test.sourceRefs })),
      }, { unavailable: tests.some(test => !test.runId || !test.checkResults?.length) });
    }
    if (reference.artifactId) {
      const source = (await listClientArtifacts(application, projectId)).find(item => item.id === reference.artifactId && !item.currency?.deprecated);
      if (!source?.versionId) throw new DynamicContractError(404, 'The attached source version is unavailable.');
      const text = await readClientArtifactContent(client, ownerId, source.id, source.versionId, signal, projectId, source.contentHash);
      add('artifact:' + source.id, { path: source.filePath, content: text }, { artifactId: source.id, versionId: source.versionId });
    }
  }
  if (!references.length) {
    const project = await application.getProject(projectId);
    if (!project) throw new DynamicContractError(404, 'Project unavailable.');
    const sources = await listClientArtifacts(application, projectId);
    add('project:' + projectId, { name: project.name, description: project.description, sources: sources.slice(0, 100).map(item => ({ id: item.id, path: item.filePath })),
      limitation: 'Inventory only. Attach checks or source files for evidence-based explanations and code verification.' });
  }
  return [...evidence.values()];
}
