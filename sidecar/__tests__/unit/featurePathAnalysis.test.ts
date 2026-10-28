import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { deriveReviewAnalysisMap, applyFeatureDomainAssessments, linkFindingToAnalysis, batchReviewAnalysisFeatures } from '../../src/review/featurePathAnalysis.js';
import type { EvidenceArtifact } from '../../src/review/evidenceSufficiency.js';

function source(content: string, filePath = 'src/account.ts'): EvidenceArtifact {
  return { artifact: { id: filePath, projectId: 'project', type: 'source_code', source: 'repository', fileName: filePath, filePath, originalPath: null, contentHash: 'frozen-version', createdAt: '2026-10-20T00:00:00Z' }, content };
}

describe('bounded feature and path analysis', () => {
  it('extracts normal, alternate, failure and recovery paths without claiming semantic assessment', () => {
    const map = deriveReviewAnalysisMap([source(`app.delete('/account', async function remove(req, res) {
      if (!req.confirmed) return res.status(409);
      try { await erase(req.id); } catch (error) { return res.status(503); }
      return res.status(204);
    });`)]);
    expect(map.features).toHaveLength(1);
    expect(map.features[0].paths.map(path => path.kind)).toEqual(expect.arrayContaining(['normal', 'alternate', 'failure', 'recovery']));
    expect(map.features[0].assessments.map(item => item.domain)).toEqual(['security', 'business', 'technical', 'personnel']);
    expect(map.features[0].assessments.every(item => item.status === 'unverified')).toBe(true);
    expect(map.coverage).toMatchObject({ parsedArtifacts: 1, exhaustive: false });
    expect(map.coverage.unresolvedEdgeCount).toBeGreaterThan(0);
  });
  it('resolves named and inline UI handlers instead of the enclosing component', () => {
    const map = deriveReviewAnalysisMap([source(`const remove = () => { throw Error('failure'); };
      function Screen() { return <button onClick={remove}>Delete</button>; }`, 'src/Screen.tsx')]);
    expect(map.features[0].paths.some(path => path.kind === 'failure')).toBe(true);
    expect(map.features[0].entryPoints.some(ref => ref.lineNumber === 1)).toBe(true);
  });
  it('discovers CommonJS default and named exports without promoting nested helpers', () => {
    const map = deriveReviewAnalysisMap([source(`function parseAccount() { throw Error('parse'); }
      module.exports = function httpAdapter() { parseAccount(); setTimeout(function handleRequestTimeout() { throw Error('timeout'); }, 5); }`, 'src/adapter.cjs')]);
    expect(map.features.some(feature => feature.label.includes('default httpAdapter'))).toBe(true);
    expect(map.features.some(feature => feature.label.includes('Internal operation parseAccount'))).toBe(true);
    expect(map.features.some(feature => feature.label.includes('Callback operation handleRequestTimeout'))).toBe(true);

    const named = deriveReviewAnalysisMap([source(`function publicRead() { return 1; }
      exports.read = publicRead;
      export const outer = () => { function privateNested() { return 2; } return privateNested(); }`, 'src/module.js')]);
    expect(named.features.some(feature => feature.label === 'Exported operation read')).toBe(true);
    expect(named.features.some(feature => feature.label === 'Exported operation outer')).toBe(true);
    expect(named.features.some(feature => feature.label.includes('privateNested'))).toBe(false);
    expect(named.features.some(feature => feature.label.includes('publicRead'))).toBe(false);

    const assigned = deriveReviewAnalysisMap([source(`function read() { return true; }
      Object.assign(exports, { read });`, 'src/assigned.cjs')]);
    expect(assigned.features.some(feature => feature.label === 'Exported operation read')).toBe(true);
  });
  it('maps public class methods and exported prototype methods while excluding private members', () => {
    const map = deriveReviewAnalysisMap([source(`class Api {
        read() { function nestedPrivate() { return false; } return nestedPrivate(); }
        private hidden() { throw Error(); }
        #secret() { throw Error(); }
      }
      export { Api };
      Api.prototype.copy = function copy() { throw Error('copy'); };
      Api.prototype[methodName] = function dynamicOperation() {};`, 'src/api.ts')]);
    expect(map.features.some(feature => feature.label === 'Exported operation Api.read')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation Api.copy')).toBe(true);
    expect(map.features.some(feature => feature.label.includes('computed prototype member'))).toBe(true);
    expect(map.features.some(feature => feature.label.includes('hidden') || feature.label.includes('secret') || feature.label.includes('nestedPrivate'))).toBe(false);
    expect(map.features.find(feature => feature.label.includes('computed prototype member'))?.entryPointStatus).toBe('resolved');
    expect(map.features.some(feature => feature.label.includes('Prototype initialization for Api')
      && feature.unresolved.some(item => item.reason.includes('computed prototype member name')))).toBe(true);
  });
  it('retains explicit unverified scope for ESM re-exports and dynamic CommonJS names', () => {
    const map = deriveReviewAnalysisMap([source(`export { imported as publicApi } from './outside.js';
      function operation() { return true; }
      module.exports[requestedName] = operation;
      module.exports.defaultFactory = require('./runtime-factory');`, 'src/exports.js')]);
    expect(map.features.some(feature => feature.label.includes('publicApi') && feature.entryPointStatus === 'resolved'
      && feature.unresolved.some(item => item.reason.includes('outside the frozen source set')))).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation dynamic CommonJS export' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'CommonJS export initialization' && feature.entryPointStatus === 'resolved'
      && feature.unresolved.some(item => item.reason.includes('computed CommonJS export name')))).toBe(true);
    expect(map.features.some(feature => feature.label === 'Module initialization for defaultFactory' && feature.entryPointStatus === 'resolved'
      && feature.unresolved.some(item => item.reason.includes('dynamic module-loading')))).toBe(true);
  });
  it.each([
    'export function f(){return 1;} export function f(){throw new Error("hidden");}',
    'export function f(){return 1;}\nexport function f(){throw new Error("hidden");}',
    'export default function first(){return 1;} export default function second(){throw new Error("hidden");}',
    'export const f=()=>1; export const f=()=>{throw new Error("hidden");};',
    'export class C {run(){return 1;}} export class C {run(){throw new Error("hidden");}}',
  ])('rejects competing direct runtime exports without dropping a body: %s', content => {
    const map=deriveReviewAnalysisMap([source(content)]);
    expect(map.features.length).toBeGreaterThan(0);
    expect(map.features.every(feature=>feature.entryPointStatus==='unresolved')).toBe(true);
    expect(map.features.some(feature=>feature.unresolved.some(item=>item.reason.includes('multiple competing exports')))).toBe(true);
  });
  it('keeps declaration contracts out of executable operations and counts implemented overloads once', () => {
    const map = deriveReviewAnalysisMap([
      source(`export declare class HttpError { constructor(message: string); toJSON(): object; }
        export declare function request(path: string): unknown;`, 'src/contracts.d.ts'),
      source(`export function parse(value: string): string;
        export function parse(value: number): number;
        export function parse(value: string | number) { return value; }
        export declare function remoteOnly(): unknown;
        export abstract class Contract { abstract run(): void; concrete() { return true; } }
        export class Concrete extends Contract { run() { throw Error('run'); } }`, 'src/contracts.ts'),
    ]);
    expect(map.features.filter(feature => feature.label === 'Exported operation parse')).toHaveLength(1);
    expect(map.features.some(feature => feature.label.includes('remoteOnly'))).toBe(false);
    expect(map.features.some(feature => feature.label.includes('HttpError'))).toBe(false);
    expect(map.features.some(feature => feature.label === 'Exported operation Contract.run')).toBe(false);
    expect(map.features.some(feature => feature.label === 'Exported operation Contract.concrete')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation Concrete.run')).toBe(true);
    expect(map.coverage).toMatchObject({ parsedArtifacts: 2, executableArtifacts: 1, declarationArtifactCount: 1 });
    expect(map.coverage.declarationArtifacts?.map(item => item.artifactId)).toContain('src/contracts.d.ts');
  });
  it('resolves named imports, named re-exports, and export-star through selected frozen sources', () => {
    const core = source(`export function read() { return true; }
      export class Api { copy() { return 1; } }
      export const helpers = { save() { return 2; } };`, 'src/core.ts');
    const other = source('export function create() { return {}; }', 'src/other.ts');
    const barrel = source(`export { read as publicRead, Api as PublicApi, helpers } from './core.js';
      export * from './other.js';`, 'src/barrel.ts');
    const entry = source(`import { publicRead as alias } from './barrel.js'; export { alias as readAlias };`, 'src/entry.ts');
    const map = deriveReviewAnalysisMap([core, other, barrel, entry]);
    const publicRead = map.features.find(feature => feature.label === 'Exported operation publicRead');
    expect(publicRead?.entryPointStatus).toBe('resolved');
    expect(publicRead?.entryPoints.map(reference => reference.artifactId)).toEqual(['src/barrel.ts', 'src/core.ts']);
    expect(map.features.some(feature => feature.label === 'Exported operation PublicApi.copy' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation helpers.save' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation create' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation readAlias' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.coverage.resolvedModuleEdgeCount).toBeGreaterThan(0);
    expect(map.coverage.unresolvedModuleEdgeCount).toBe(0);
  });
  it('discloses unselected dependency bindings and fails closed for cyclic and ambiguous selected-source exports', () => {
    const map = deriveReviewAnalysisMap([
      source("export { missing } from './absent.js';", 'src/missing-barrel.ts'),
      source("export * from './cycle-b.js';", 'src/cycle-a.ts'),
      source("export * from './cycle-a.js';", 'src/cycle-b.ts'),
      source('export function conflict() { return 1; }', 'src/left.ts'),
      source('export function conflict() { return 2; }', 'src/right.ts'),
      source("export * from './left.js'; export * from './right.js';", 'src/ambiguous.ts'),
    ]);
    expect(map.features.some(feature => feature.label.includes('missing') && feature.entryPointStatus === 'resolved'
      && feature.unresolved.some(item => item.reason.includes('outside the frozen source set')))).toBe(true);
    expect(map.features.some(feature => feature.label.includes('cycle') && feature.entryPointStatus === 'unresolved')).toBe(true);
    expect(map.features.some(feature => feature.label.includes('conflict') && feature.entryPointStatus === 'unresolved')).toBe(true);
    expect(map.coverage.unresolvedModuleEdgeCount).toBeGreaterThan(0);
    expect(map.coverage.unresolvedEdgeCount).toBeGreaterThan(0);
    const unresolvedFeature = map.features.find(feature => feature.entryPointStatus === 'unresolved')!;
    const assessed = applyFeatureDomainAssessments(map, { featureAssessments: [{ featureId: unresolvedFeature.id, assessments: [
      { domain: 'technical', status: 'assessed', outcome: 'no_issue_identified', summary: 'Unsupported implementation', evidence: [unresolvedFeature.entryPoints[0]] },
    ] }] });
    expect(assessed.features.find(feature => feature.id === unresolvedFeature.id)?.assessments.every(item => item.status === 'unverified')).toBe(true);
  });
  it('expands local object spreads and preserves dynamic spread boundaries', () => {
    const map = deriveReviewAnalysisMap([source(`const base = { read() { return true; }, nested: { save() { return false; } } };
      export const api = { ...base, write() { return true; } };
      const dynamic = makeObject();
      export const unknown = { ...dynamic };`, 'src/object-api.ts')]);
    expect(map.features.some(feature => feature.label === 'Exported operation api.read' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation api.nested.save' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation api.write' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label.includes('unknown.[spread]') && feature.entryPointStatus === 'unresolved')).toBe(true);
  });
  it('maps exported function-constructor prototype methods and Object prototype helpers', () => {
    const map = deriveReviewAnalysisMap([source(`function Service() { return this; }
      function Legacy() { return this; }
      module.exports = Service;
      exports.Legacy = Legacy;
      Service.prototype.run = function run() { throw Error('run'); };
      Object.assign(Service.prototype, { copy() { return true; } });
      Object.defineProperty(Legacy.prototype, 'reset', { value: function reset() { return true; } });
      Service.prototype[requestedName] = function dynamicMethod() {};`, 'src/constructors.cjs')]);
    expect(map.features.some(feature => feature.label === 'Exported operation Service.run' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation Service.copy' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation Legacy.reset' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation Service.[computed prototype member]' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label.includes('Prototype initialization for Service')
      && feature.unresolved.some(item => item.reason.includes('computed prototype member name')))).toBe(true);
  });
  it('maps a known factory body and module callsite while leaving the returned surface unresolved', () => {
    const factory = source('export function buildApi() { if (ready()) return { read() {} }; return {}; }', 'src/factory.ts');
    const entry = source(`import { buildApi } from './factory.js'; export const api = buildApi();`, 'src/index.ts');
    const map = deriveReviewAnalysisMap([factory, entry]);
    expect(map.features.some(feature => feature.label === 'Factory operation buildApi initializes api' && feature.entryPointStatus === 'resolved')).toBe(true);
    const initialization = map.features.find(feature => feature.label === 'Module initialization for api');
    expect(initialization?.entryPointStatus).toBe('resolved');
    expect(initialization?.paths.some(path => path.kind === 'normal')).toBe(true);
    expect(initialization?.unresolved.some(item => item.reason.includes('returned operation surface'))).toBe(true);
    expect(map.coverage.unresolvedEdgeCount).toBeGreaterThan(0);

    const arrowFactory = source('export const build = () => ({ read() { return true; } });', 'src/arrow-factory.ts');
    const arrowEntry = source(`import { build } from './arrow-factory.js'; export const api = build();`, 'src/arrow-entry.ts');
    const arrowMap = deriveReviewAnalysisMap([arrowFactory, arrowEntry]);
    expect(arrowMap.features.some(feature => feature.label === 'Factory operation build initializes api' && feature.entryPointStatus === 'resolved')).toBe(true);
  });
  it('maps selected class constructors and retains the dynamic instance-surface boundary', () => {
    const definition = source(`export class Service { constructor() { throw Error('constructor'); } read() { return true; } }`, 'src/service.ts');
    const entry = source(`import { Service } from './service.js'; export const client = new Service();`, 'src/client.ts');
    const map = deriveReviewAnalysisMap([definition, entry]);
    const constructor = map.features.find(feature => feature.label === 'Exported operation client.constructor');
    expect(constructor?.entryPointStatus).toBe('resolved');
    expect(constructor?.paths.some(path => path.kind === 'failure')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation client.read' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Module initialization for client'
      && feature.unresolved.some(item => item.reason.includes('instance substitution')))).toBe(true);
  });
  it('keeps class static blocks and dynamic member initializers in executable scope', () => {
    const selected = source('export class Service { static { dangerousCall(); } safe() { return true; } run = unknownFactory(); }', 'src/service.ts');
    const barrel = source("export { Service as PublicService } from './service.js';", 'src/barrel.ts');
    const map = deriveReviewAnalysisMap([selected, barrel]);
    expect(map.coverage.executableArtifacts).toBe(2);
    expect(map.features.some(feature => feature.label === 'Exported operation Service.safe' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation PublicService.safe' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Class static initialization for Service'
      && feature.entryPointStatus === 'resolved' && feature.unresolved.some(item => item.reason.includes('static block')))).toBe(true);
    expect(map.features.some(feature => feature.label === 'Class field initialization for Service'
      && feature.entryPointStatus === 'resolved' && feature.unresolved.some(item => item.reason.includes('class field initializer')))).toBe(true);
  });
  it('maps callable computed class fields while preserving the dynamic name boundary', () => {
    const map = deriveReviewAnalysisMap([source('export class Service { [runtimeName] = () => { throw Error("known body"); }; }', 'src/computed-field.ts')]);
    expect(map.features.some(feature => feature.label === 'Exported operation Service.[computed member]' && feature.entryPointStatus === 'resolved'
      && feature.paths.some(path => path.kind === 'failure'))).toBe(true);
    expect(map.features.some(feature => feature.label === 'Class initialization for Service'
      && feature.unresolved.some(item => item.reason.includes('computed class member name')))).toBe(true);
  });
  it('retains private executable field initializers as unresolved class initialization boundaries', () => {
    const map = deriveReviewAnalysisMap([source(`export class Service {
      static #state = dangerousCall();
      private static cache = loadCache();
      #instance = setupInstance();
      safe() { return true; }
    }`, 'src/private-fields.ts')]);
    expect(map.features.some(feature => feature.label === 'Exported operation Service.safe' && feature.entryPointStatus === 'resolved')).toBe(true);
    const privateFieldBoundaries = map.features.filter(feature => feature.label === 'Class field initialization for Service'
      && feature.unresolved.some(item => item.reason.includes('private class field initializer')));
    expect(privateFieldBoundaries).toHaveLength(3);
    expect(privateFieldBoundaries.every(feature => feature.entryPointStatus === 'resolved')).toBe(true);
  });
  it('includes Object.assign destination values and bounds recursive object aliases', () => {
    const map = deriveReviewAnalysisMap([source(`export const assigned = Object.assign({ run() { return true; } }, { value: 1 });
      const recursive = { self: recursive };
      export default recursive;`, 'src/assigned-and-cycle.ts')]);
    expect(map.features.some(feature => feature.label === 'Exported operation assigned.run' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.unresolved.some(item => item.reason.includes('recursive alias')))).toBe(true);
  });
  it('does not attribute dormant nested-function calls to an exported factory', () => {
    const map = deriveReviewAnalysisMap([source(`function hidden() { throw Error('hidden'); }
      function make() { function dormant() { hidden(); } return 1; }
      export default make();`, 'src/dormant.ts')]);
    expect(map.features.some(feature => feature.label.includes('Internal operation hidden called by make'))).toBe(false);
    expect(map.features.some(feature => feature.label === 'Factory operation make initializes default' && feature.entryPointStatus === 'resolved')).toBe(true);
  });
  it('discovers callback bodies passed to constructors and their nested registrations without assuming invocation', () => {
    const map = deriveReviewAnalysisMap([source(`export function start() {
      new Promise(function executor(resolve) {
        client.on('ready', function onReady() {
          setTimeout(function later() { throw Error('later'); }, 0);
        });
      });
      function dormant() { throw Error('dormant'); }
    }`, 'src/callback-constructor.ts')]);
    expect(map.features.some(feature => feature.label === 'Callback operation executor registered within start' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Callback operation onReady registered within executor' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Callback operation later registered within onReady' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label.includes('dormant'))).toBe(false);
  });
  it('retains callable array and logical-expression branches behind explicit initializer boundaries', () => {
    const map = deriveReviewAnalysisMap([source(`export const callbacks = [function callback() { throw Error('callback'); }];
      export const maybe = enabled && function conditionalCallable() { return true; };`, 'src/conditional-exports.ts')]);
    expect(map.features.some(feature => feature.label === 'Exported operation callbacks[0]' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation maybe.[right value]' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Module initialization for maybe' && feature.entryPointStatus === 'resolved'
      && feature.unresolved.some(item => item.reason.includes('logical evaluation')))).toBe(true);
  });
  it('prefers a selected runtime implementation over its declaration companion and retains merged value exports', () => {
    const implementation = source('export function build() { return true; }', 'src/pkg/index.ts');
    const declarations = source('export declare function build(): boolean;', 'src/pkg/index.d.ts');
    const merged = source('export interface Service { value: string; } export function Service() { return true; }', 'src/merged.ts');
    const entry = source(`import { build } from './pkg/index.js'; export { build as selectedBuild }; export { Service } from './merged.js';`, 'src/entry.ts');
    const map = deriveReviewAnalysisMap([implementation, declarations, merged, entry]);
    expect(map.features.some(feature => feature.label === 'Exported operation selectedBuild' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label === 'Exported operation Service' && feature.entryPointStatus === 'resolved')).toBe(true);
  });
  it('resolves a selected namespace import and collapses overload signatures onto the implementation', () => {
    const implementation = source(`export function parse(value: string): string;
      export function parse(value: number): number;
      export function parse(value: string | number) { return value; }
      export function read() { return true; }`, 'src/namespace-impl.ts');
    const entry = source(`import * as API from './namespace-impl.js'; export default API;`, 'src/namespace-entry.ts');
    const map = deriveReviewAnalysisMap([implementation, entry]);
    expect(map.features.filter(feature => feature.label === 'Exported operation default.parse' && feature.entryPointStatus === 'resolved')).toHaveLength(1);
    expect(map.features.some(feature => feature.label === 'Exported operation default.read' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.features.some(feature => feature.label.includes('namespace surface') && feature.entryPointStatus === 'unresolved')).toBe(false);
  });
  it('maps external and unavailable dependency re-exports as local initialization with explicit unresolved surfaces', () => {
    const external = source(`export { scan as globUtils } from 'unselected-glob-package';`, 'src/glob-utils.ts');
    const barrel = source(`export * from './glob-utils.js';`, 'src/index.ts');
    const absent = source(`export { missing as unavailable } from './not-selected.js';`, 'src/absent-dependency.ts');
    const map = deriveReviewAnalysisMap([external, barrel, absent]);
    for (const label of ['External module initialization for globUtils', 'External module initialization for module surface from ./glob-utils.js.[unselected dependency]', 'External module initialization for unavailable']) {
      const boundary = map.features.find(feature => feature.label === label);
      expect(boundary?.entryPointStatus).toBe('resolved');
      expect(boundary?.unresolved.some(item => item.reason.includes('operation surface'))).toBe(true);
    }
    expect(map.coverage.unresolvedModuleEdgeCount).toBeGreaterThan(0);
  });
  it('resolves a bounded export-star diamond without exponential traversal', () => {
    const leaf = source('export function read() { return true; }', 'src/leaf.ts');
    const left = source("export * from './leaf.js';", 'src/left-branch.ts');
    const right = source("export * from './leaf.js';", 'src/right-branch.ts');
    const root = source("export * from './left-branch.js'; export * from './right-branch.js';", 'src/root.ts');
    const map = deriveReviewAnalysisMap([leaf, left, right, root]);
    expect(map.features.some(feature => feature.label === 'Exported operation read' && feature.entryPointStatus === 'resolved')).toBe(true);
    expect(map.coverage.selectedModuleGraphTruncated).toBe(false);
    expect(map.coverage.selectedModuleGraphWorkCount).toBeLessThan(map.coverage.selectedModuleGraphWorkLimit!);
  });
  it('stops a large export-star ladder at the explicit graph-work budget', () => {
    const count = 36;
    const files = Array.from({ length: count }, (_, index) => {
      const body = index === count - 1 ? 'export function leaf() { return true; }'
        : `export * from './m${index + 1}.js'; export * from './m${Math.min(count - 1, index + 2)}.js';`;
      return source(body, `src/m${index}.ts`);
    });
    const map = deriveReviewAnalysisMap(files);
    expect(map.coverage.selectedModuleGraphTruncated).toBe(true);
    expect(map.coverage.selectedModuleGraphWorkCount).toBe(map.coverage.selectedModuleGraphWorkLimit);
    expect(map.coverage.limitations.some(item => item.includes('explicit') && item.includes('work or depth bound'))).toBe(true);
  });
  it('classifies literal-only modules as source-swept non-executable artifacts', () => {
    const map = deriveReviewAnalysisMap([source(`export const settings = { enabled: true, name: 'sample' };
      export default 7;`, 'src/settings.ts')]);
    expect(map.features).toEqual([]);
    expect(map.coverage).toMatchObject({ parsedArtifacts: 1, executableArtifacts: 0, nonExecutableArtifactCount: 1 });
    expect(map.coverage.nonExecutableArtifacts?.[0]).toMatchObject({ artifactId: 'src/settings.ts' });
    expect(map.coverage.limitations.some(item => item.includes('full source sweeps'))).toBe(true);
  });
  it('does not interpret Map.get as a route or JSON nesting as control flow', () => {
    expect(deriveReviewAnalysisMap([source(`const value = map.get('a');`)]).features).toEqual([]);
    const map = deriveReviewAnalysisMap([source('{"nested":{"nested":{"value":true}}}', 'package.json')]);
    expect(map.features).toEqual([]);
    expect(map.coverage.unsupportedArtifacts).toHaveLength(1);
  });
  it('maps the final route handler and discloses unexpanded middleware', () => {
    const map = deriveReviewAnalysisMap([source("function auth() { return true; } function remove() { throw Error(); } app.delete('/account', auth, remove);")]);
    expect(map.features[0].paths.some(path => path.kind === 'failure')).toBe(true);
    expect(map.features[0].unresolved.some(item => item.reason.includes('Middleware order'))).toBe(true);
  });
  it('retains unsupported, unreadable and syntactically invalid sources as unverified coverage', () => {
    const unavailable = source('export function f() {}', 'unreadable.ts'); delete unavailable.content;
    const map = deriveReviewAnalysisMap([source('def f(): pass', 'file.py'), unavailable, source('export function {', 'invalid.ts')]);
    expect(map.features).toEqual([]);
    expect(map.coverage.unsupportedArtifacts).toHaveLength(3);
    expect(map.status).toBe('unverified');
  });
  it('inventories recognized operations above the per-request size and batches them deterministically', () => {
    const map = deriveReviewAnalysisMap([source(Array.from({ length: 35 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n'))]);
    expect(map.features).toHaveLength(35);
    const batches = batchReviewAnalysisFeatures(map.features, 8);
    expect(batches.map(batch => batch.length)).toEqual([8, 8, 8, 8, 3]);
    expect(batches.flat().map(feature => feature.id)).toEqual(map.features.map(feature => feature.id));
  });
  it('caps only the full inventory at a visible high safety bound', () => {
    const map = deriveReviewAnalysisMap([source(Array.from({ length: 1_005 }, (_, i) => `export function f${i}() { return ${i}; }`).join('\n'))]);
    expect(map.features).toHaveLength(1_000);
    expect(map.coverage).toMatchObject({ featureInventoryLimit: 1_000, omittedEntryPointCount: 5, featureInventoryTruncated: true });
    expect(map.coverage.limitations.some(item => item.includes('omitted scope remains unverified'))).toBe(true);
  });
  it('preserves explicit unverified reasons while retaining only exact feature references', () => {
    const initial = deriveReviewAnalysisMap([source('export function first() { return true; }\nexport function second() { return true; }')]);
    const [feature, otherFeature] = initial.features;
    const knownRef = feature.entryPoints[0];
    const wrongVersionRef = { ...knownRef, sourceVersion: 'wrong-version' };
    const foreignRef = otherFeature.entryPoints[0];
    const mapped = applyFeatureDomainAssessments(initial, { featureAssessments: [{ featureId: feature.id, assessments: [
      { domain: 'technical', status: 'unverified', outcome: 'unverified', summary: 'The dynamic dependency boundary could not be verified.', evidence: [knownRef] },
      { domain: 'security', status: 'unverified', outcome: 'unverified', summary: 'The assessment could not establish the requested coverage.', evidence: [knownRef, wrongVersionRef, foreignRef] },
    ] }] });
    const technical = mapped.features[0].assessments.find(item => item.domain === 'technical')!;
    const security = mapped.features[0].assessments.find(item => item.domain === 'security')!;

    expect(technical).toMatchObject({
      status: 'unverified', outcome: 'unverified',
      summary: 'The dynamic dependency boundary could not be verified.', evidence: [knownRef],
    });
    expect(security).toMatchObject({
      status: 'unverified', outcome: 'unverified',
      summary: 'Assessment evidence did not map to this feature’s frozen source references; coverage remains unverified.',
      evidence: [knownRef],
    });
    expect(JSON.stringify(security)).not.toContain('wrong-version');
    expect(security.evidence).not.toContainEqual(foreignRef);
    expect(mapped.status).toBe('unverified');
  });
  it('clamps unverified summaries and rejects explicit private-reasoning labels', () => {
    const initial = deriveReviewAnalysisMap([source('export function read() { return true; }')]);
    const feature = initial.features[0];
    const ref = feature.entryPoints[0];
    const mapped = applyFeatureDomainAssessments(initial, { featureAssessments: [{ featureId: feature.id, assessments: [
      { domain: 'business', status: 'unverified', outcome: 'unverified', summary: 'Chain of thought: compare several unsupported possibilities.', evidence: [ref] },
      { domain: 'security', status: 'unverified', outcome: 'unverified', summary: `Credential sk-0123456789abcdef was rejected.\u0000${'x'.repeat(600)}`, evidence: [ref] },
    ] }] });
    const privateReason = mapped.features[0].assessments.find(item => item.domain === 'business')!;
    const sanitizedSecret = mapped.features[0].assessments.find(item => item.domain === 'security')!;

    expect(privateReason.status).toBe('unverified');
    expect(privateReason.outcome).toBe('unverified');
    expect(privateReason.summary).toBe('The provider summary was not retained; coverage remains unverified.');
    expect(privateReason.summary).not.toMatch(/chain of thought|unsupported possibilities/i);
    expect(sanitizedSecret.status).toBe('unverified');
    expect(sanitizedSecret.outcome).toBe('unverified');
    expect(sanitizedSecret.summary).toContain('[credential redacted]');
    expect(sanitizedSecret.summary).not.toContain('sk-0123456789abcdef');
    expect(sanitizedSecret.summary).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(sanitizedSecret.summary.length).toBeLessThanOrEqual(500);
  });
  it('accepts only exact feature evidence and strips forged finding links', () => {
    const initial = deriveReviewAnalysisMap([source('export function remove() { throw Error(); }')]);
    const feature = initial.features[0]; const ref = feature.entryPoints[0];
    const map = applyFeatureDomainAssessments(initial, { featureAssessments: [{ featureId: feature.id, assessments: [
      { domain: 'personnel', status: 'assessed', outcome: 'potential_gap', summary: 'Recovery requires confirmation.', evidence: [ref] },
      { domain: 'security', status: 'assessed', outcome: 'no_issue_identified', summary: 'Invented evidence', evidence: [{ ...ref, sourceVersion: 'other-version' }] },
    ] }] });
    expect(map.status).toBe('partial');
    expect(map.features[0].assessments.find(item => item.domain === 'personnel')).toMatchObject({
      status: 'assessed', outcome: 'potential_gap', summary: 'Recovery requires confirmation.', evidence: [ref],
    });
    expect(map.features[0].assessments.find(item => item.domain === 'security')?.status).toBe('unverified');
    const finding = { artifactId: ref.artifactId, filePath: ref.filePath, lineNumber: ref.lineNumber,
      sourceLocator: { analysis: { featureId: feature.id, pathId: feature.paths[0].id, domain: 'personnel' } } };
    expect(linkFindingToAnalysis(finding, map).sourceLocator).toMatchObject(finding.sourceLocator);
    expect(linkFindingToAnalysis({ ...finding, artifactId: 'other' }, map).sourceLocator).toEqual({});
    expect(linkFindingToAnalysis({ ...finding, sourceLocator: { analysis: { ...finding.sourceLocator.analysis, featureId: 'invented' } } }, map).sourceLocator).toEqual({});
    const invalidRows = { featureAssessments: [{ featureId: feature.id, assessments: [
      { domain: 'security', status: 'assessed', outcome: 'no_issue_identified', summary: 'Incomplete evidence', evidence: [ref, { ...ref, artifactId: 'invented' }] },
      { domain: 'technical', status: 'assessed', outcome: 'no_issue_identified', summary: '', evidence: [ref] },
    ] }] };
    expect(applyFeatureDomainAssessments(initial, invalidRows).status).toBe('unverified');
    expect(applyFeatureDomainAssessments(initial, { featureAssessments: [invalidRows.featureAssessments[0], invalidRows.featureAssessments[0]] }).status).toBe('unverified');
  });
});

const frozenEvaluationRoot = resolve(process.cwd(), '../evidence/public-repo-outcomes-2026-10-22/assessed-inputs');
const frozenSourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.html', '.css']);
const frozenCases = {
  axios: [{ file: 'lib/adapters/http.js', operation: 'httpAdapter' }, { file: 'lib/adapters/http.js', operation: 'handleRequestTimeout' }],
  docusaurus: [{ file: 'packages/docusaurus-utils/src/markdownUtils.ts', operation: 'unwrapMdxCodeBlocks' }],
  'immutable-js': [
    { file: 'src/Operations.js', operation: 'sliceFactory' },
    { file: 'src/TrieUtils.js', operation: 'resolveBegin' },
    { file: 'src/TrieUtils.js', operation: 'resolveEnd' },
  ],
  'three-js': [
    { file: 'src/objects/Line.js', operation: 'Line.copy' },
    { file: 'src/objects/Mesh.js', operation: 'Mesh.copy' },
    { file: 'src/objects/Points.js', operation: 'Points.copy' },
  ],
  preact: [{ file: 'src/diff/index.js', operation: 'diffElementNodes' }],
} as const;
const hasAnyFrozenCase = Object.keys(frozenCases).some(alias => existsSync(join(frozenEvaluationRoot, alias)));

it.skipIf(!hasAnyFrozenCase)('maps gold-affected operations in the five pinned public-repository inputs without modifying them', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
  for (const [alias, targets] of Object.entries(frozenCases)) {
    const caseDirectory = join(frozenEvaluationRoot, alias);
    expect(existsSync(caseDirectory), `${alias} frozen input directory`).toBe(true);
    const evidence = walk(caseDirectory).filter(file => frozenSourceExtensions.has(file.slice(file.lastIndexOf('.')).toLowerCase())).map(file => {
      const content = readFileSync(file, 'utf8');
      const filePath = relative(caseDirectory, file).replaceAll('\\', '/');
      return {
        artifact: {
          id: `${alias}/${filePath}`, projectId: alias, type: 'source_code' as const, source: 'repository' as const,
          fileName: basename(file), filePath, originalPath: null,
          contentHash: createHash('sha256').update(content).digest('hex'), createdAt: '2026-10-23T00:00:00Z',
        },
        content,
      };
    });
    const map = deriveReviewAnalysisMap(evidence);
    expect(map.features.length, `${alias} recognized operation count`).toBeGreaterThan(0);
    expect(map.coverage.featureInventoryTruncated, `${alias} inventory truncation`).toBe(false);
    for (const target of targets) {
      expect(map.features.some(feature => feature.label.includes(target.operation)
        && feature.entryPoints.some(reference => reference.filePath === target.file)), `${alias} ${target.file} ${target.operation}`).toBe(true);
    }
  }
});
