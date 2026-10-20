/** Deterministic-only acceptance over two downloaded public Git checkouts.
 * Never authenticates, calls a model, executes upstream scripts, or writes project data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessRepositoryReadiness } from './engine.js';
import { READINESS_POLICY_VERSION } from './policy.js';
import { runStaticAnalysis } from '../staticEngine.js';
import type { ReadinessArtifact } from './types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = [
  { name: 'cors', repo: 'expressjs/cors', revision: '5317ebe670db2aaebc1d496eb5d33493deefb3ed', reviewUrl: 'https://github.com/expressjs/cors/pull/385' },
  { name: 'serve-static', repo: 'expressjs/serve-static', revision: '109a299c26d2d532027bb6e66e50e365eeb8fcdd', reviewUrl: 'https://github.com/expressjs/serve-static/pull/246' },
];
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const results = [];
for (const fixture of fixtures) {
  const directory = path.join(root, 'data/public-acceptance-2026-10-19', fixture.name);
  const git = (args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  if (git(['rev-parse', 'HEAD']).trim() !== fixture.revision || git(['status', '--porcelain']).trim()) {
    throw new Error(`Expected a clean pinned public checkout: ${fixture.repo}`);
  }
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const inputs: ReadinessArtifact[] = await Promise.all(files.map(async filePath => {
    const content = await fs.readFile(path.join(directory, filePath), 'utf8');
    return { content, artifact: { id: sha256(`${fixture.repo}:${filePath}`), projectId: fixture.repo,
      type: /\.(js|ts|jsx|tsx)$/.test(filePath) ? 'source_code' as const : 'other' as const,
      source: 'repository' as const, fileName: path.basename(filePath), filePath, originalPath: `${fixture.repo}/${filePath}`,
      versionId: fixture.revision, contentHash: sha256(content), createdAt: '2026-10-19T00:00:00.000Z' } };
  }));
  const inventory = inputs.map(item => ({ path: item.artifact.filePath, hash: item.artifact.contentHash, bytes: Buffer.byteLength(item.content!) }));
  const staticReadiness = assessRepositoryReadiness({ projectId: fixture.repo, description: '', artifacts: inputs,
    sourceFingerprint: sha256(JSON.stringify(inventory)) });
  const byId = new Map(inputs.map(item => [item.artifact.id, item.content!]));
  const ruleCandidates = await runStaticAnalysis(fixture.repo, inputs.map(item => item.artifact), `offline-${fixture.name}`, {
    contentReader: async artifact => byId.get(artifact.id)!,
  });
  results.push({ ...fixture, policyVersion: READINESS_POLICY_VERSION, inventory,
    repositoryReadiness: staticReadiness, semanticReadiness: 'held_by_user', modelReview: 'held_by_user',
    modelRequests: 0, ruleCandidates: ruleCandidates.map(({ ruleId, filePath, lineNumber, severity, category, message }) =>
      ({ ruleId, filePath, lineNumber, severity, category, message })),
    limitations: ['Offline check uses Git-tracked text files; this is not a live imported-source inventory.',
      'Repository readiness checks source/configuration structure only, not build or runtime behavior.',
      'Rule candidates are untriaged signals, not confirmed defects. No AI outcome assessment was run.'] });
}
const directory = path.join(root, 'evidence/public-repositories-2026-10-19');
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, 'static-results.json'), JSON.stringify({ mode: 'deterministic-only', results }, null, 2));
console.log(JSON.stringify(results.map(item => ({ repo: item.repo, revision: item.revision, files: item.inventory.length,
  readiness: item.repositoryReadiness.result.state, checksPassed: item.repositoryReadiness.result.checksPassed,
  checksTotal: item.repositoryReadiness.result.checksTotal, ruleCandidates: item.ruleCandidates.length, modelRequests: 0 }))));
