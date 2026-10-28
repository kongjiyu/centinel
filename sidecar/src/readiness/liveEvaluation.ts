/** Explicit local acceptance runner. Uses an existing Centinel Codex login to
 * assess fictional fixtures; never reads/writes a live project or exports auth. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServer } from '../model/codex.js';
import { ConfiguredTextModelProvider } from '../review/modelProvider.js';
import { runReadinessEvaluation, READINESS_EVALUATION_FIXTURES } from './evaluation.js';
import { createReadinessEvaluationRun } from './evaluationRun.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const homeArg = option('--codex-home');
  if (!homeArg) throw new Error('Specify --codex-home with an existing Centinel account directory under data/codex.');
  const homesRoot = await fs.realpath(path.join(root, 'data/codex'));
  const home = await fs.realpath(path.resolve(homeArg));
  if (path.dirname(home).toLowerCase() !== homesRoot.toLowerCase()) throw new Error('Use a Centinel-managed Codex home under data/codex.');
  const backend = new CodexAppServer(home, undefined, 180_000);
  try {
    const status = await backend.status();
    if (!status.available) throw new Error('Codex provider is unavailable. Check the local provider startup and credential-directory protection.');
    if (!status.connected) throw new Error('Sign in to Codex in Centinel before running live readiness acceptance.');
    const catalog = await backend.models();
    const selected = option('--model');
    const model = selected ? catalog.find(item => item.id === selected) : catalog.find(item => item.isDefault);
    if (!model) throw new Error('Select an available --model from the Centinel Codex model catalog.');
    const requested = option('--cases')?.split(',');
    const fixtures = requested ? READINESS_EVALUATION_FIXTURES.filter(item => requested.includes(item.id)) : READINESS_EVALUATION_FIXTURES;
    if (!fixtures.length || requested?.some(id => !fixtures.some(fixture => fixture.id === id))) throw new Error('Unknown readiness fixture case.');
    const run = await createReadinessEvaluationRun(path.resolve(root, 'evidence/readiness-evaluations'), fixtures, model.id);
    console.log(JSON.stringify({ event: 'evaluation_started', ...run.metadata, outputDirectory: run.directory }));
    const provider = new ConfiguredTextModelProvider({ codexBackend: backend, settings: {
      ownerId: 'readiness-fixture-evaluation', provider: 'codex', apiFormat: 'codex-app-server',
      model: model.id, apiKey: '', baseUrl: '',
    } });
    const results = [];
    for (const fixture of fixtures) {
      console.log(JSON.stringify({ event: 'case_started', fixtureId: fixture.id, model: model.id }));
      const report = await runReadinessEvaluation(provider, [fixture]);
      results.push(...report.cases);
      await run.save(results);
      console.log(JSON.stringify({ event: 'case_finished', fixtureId: fixture.id, passed: report.cases[0]?.passed,
        failureCode: report.cases[0]?.failureCode,
        states: report.cases[0]?.categories.map(item => ({ category: item.category, expected: item.expectedState, actual: item.engineState })),
        totals: report.totals }));
      // A provider outage cannot establish semantic accuracy; avoid sending
      // the remaining corpus into the same blocked provider repeatedly.
      if (report.cases[0]?.executionError) break;
    }
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } finally { backend.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error instanceof Error && /Specify|Use a Centinel|Sign in|Select an available|Unknown readiness|Codex provider is unavailable/.test(error.message)
    ? error.message : 'Live readiness evaluation could not finish. Inspect the safe case report and provider connection.'); process.exitCode = 1; });
}
