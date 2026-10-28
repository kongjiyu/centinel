import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../src/artifacts.js';
import { chunkFrozenSource } from '../../src/review/sourceChunks.js';
import type { RetrievedContext } from '../../src/review/contextTypes.js';
import type { EvidenceArtifact } from '../../src/review/evidenceSufficiency.js';
import type { AnalysisEvidenceReference, ReviewAnalysisFeature } from '../../src/review/featurePathAnalysis.js';
import { selectEvidencePackets } from '../../src/review/evidencePacketSelection.js';

function item(id: string, filePath: string, content: string): EvidenceArtifact {
  return {
    artifact: {
      id, projectId: 'project', type: 'source_code', source: 'repository', fileName: filePath.split('/').at(-1)!,
      filePath, originalPath: null, versionId: `version-${id}`,
      contentHash: crypto.createHash('sha256').update(content, 'utf8').digest('hex'), createdAt: '2026-10-25T00:00:00Z',
    } as Artifact,
    content,
  };
}

function reference(source: EvidenceArtifact, lineNumber: number): AnalysisEvidenceReference {
  return { artifactId: source.artifact.id, filePath: source.artifact.filePath, lineNumber, sourceVersion: source.artifact.contentHash };
}

function feature(id: string, ...references: AnalysisEvidenceReference[]): ReviewAnalysisFeature {
  return { id, label: id, provisional: true, entryPoints: references, paths: [], assessments: [], unresolved: [] };
}

function retainedLines(source: EvidenceArtifact, ranges: Array<{ lineStart: number; lineEnd: number }>): string[] {
  const lines = source.content!.split('\n');
  return ranges.flatMap(range => lines.slice(range.lineStart - 1, range.lineEnd));
}

function contextForChunk(source: EvidenceArtifact, chunk: ReturnType<typeof chunkFrozenSource>[number]): RetrievedContext {
  return {
    files: [], totalSymbols: 1, estimatedTokens: Math.ceil(chunk.content.length / 4), reason: 'fixture',
    selectedChunks: [{
      artifactId: source.artifact.id, artifactVersionId: source.artifact.versionId!, filePath: source.artifact.filePath,
      contentHash: crypto.createHash('sha256').update(chunk.content, 'utf8').digest('hex'), ordinal: chunk.ordinal,
      content: chunk.content, lineStart: chunk.lineStart, lineEnd: chunk.lineEnd,
      startOffset: chunk.startOffset, endOffset: chunk.endOffset, kind: chunk.kind, indexOrdinal: chunk.ordinal,
    }],
  };
}

function chunkContext(source: EvidenceArtifact, content: string): RetrievedContext {
  const chunk = chunkFrozenSource({ id: source.artifact.id, filePath: source.artifact.filePath, type: source.artifact.type }, source.content!)
    .find(candidate => candidate.content === content || candidate.kind === 'function');
  if (!chunk) throw new Error('Expected an exact TypeScript source chunk.');
  return contextForChunk(source, chunk);
}

describe('selected evidence packets', () => {
  it('keeps exact mapped units, their local dependencies, and module state without blank-line masking', () => {
    const content = [
      'let state = initialize();',
      'function initialize() { return true; }',
      'function entry() { return helper(state); }',
      'function helper(value: boolean) { return value; }',
      'function unrelated() { return false; }',
    ].join('\r\n');
    const source = item('flow', 'flow.ts', content);
    const selection = selectEvidencePackets([source], [feature('flow-entry', reference(source, 3))]).byArtifactId.get('flow');

    expect(selection?.diagnostics).toMatchObject({ method: 'ast_dependency_units', fallbackReason: null, selectedUnitCount: 3 });
    expect(selection?.ranges).toEqual([{ lineStart: 1, lineEnd: 4 }]);
    expect(retainedLines(source, selection!.ranges).join('\n')).toBe(content.split('\n').slice(0, 4).join('\n'));
    expect(retainedLines(source, selection!.ranges).join('\n')).not.toContain('unrelated');
  });

  it('traverses module initialization when a reverse caller selects a different artifact', () => {
    const entry = item('entry', 'a.ts', 'export function authorize(value: boolean) { return value; }');
    const caller = item('caller', 'b.ts', [
      "import { authorize } from './a';",
      'const config = buildState();',
      'function buildState() { return { enabled: true }; }',
      'function caller() { return authorize(config.enabled); }',
      'function unrelated() { return false; }',
    ].join('\n'));
    const selection = selectEvidencePackets([entry, caller], [feature('authorize', reference(entry, 1))]);
    const callerPacket = selection.byArtifactId.get('caller');

    expect(callerPacket?.ranges).toEqual([{ lineStart: 1, lineEnd: 4 }]);
    expect(retainedLines(caller, callerPacket!.ranges)).toEqual(caller.content!.split('\n').slice(0, 4));
  });

  it('does not treat same-name references in unrelated artifacts as callers', () => {
    const selected = item('selected', 'selected.ts', 'function run() { return true; }');
    const unrelated = item('unrelated', 'unrelated.ts', 'function read() { const callback = run; return callback(); }');
    const selection = selectEvidencePackets([selected, unrelated], [feature('run', reference(selected, 1))]);

    expect(selection.byArtifactId.has('selected')).toBe(true);
    expect(selection.byArtifactId.has('unrelated')).toBe(false);
  });

  it('preserves a full-source fallback without treating dormant function bodies as module initialization', () => {
    const root = item('root', 'root.ts', [
      "import { duplicate } from './dup';",
      "import { additional } from './helper';",
      'function entry() { return duplicate(); }',
      'function retainedByFallback() { return additional(); }',
    ].join('\n'));
    const duplicateA = item('duplicate-a', 'dup.ts', 'export function duplicate() { return 1; }');
    const duplicateB = item('duplicate-b', './dup.ts', 'export function duplicate() { return 2; }');
    const helper = item('helper', 'helper.ts', 'export function additional() { return true; }');
    const selection = selectEvidencePackets([root, duplicateA, duplicateB, helper], [feature('entry', reference(root, 3))]);

    expect(selection.byArtifactId.get('root')?.diagnostics).toMatchObject({ method: 'full_source_fallback', fallbackReason: 'selected_module_unresolved' });
    expect(selection.byArtifactId.get('root')?.ranges).toEqual([{ lineStart: 1, lineEnd: 4 }]);
    expect(selection.byArtifactId.has('helper')).toBe(false);
  });

  it('keeps named export declarations without treating every exported binding as executed', () => {
    const source = item('exports', 'exports.ts', [
      'export function publicApi() { return exportHelper(); }',
      'function exportHelper() { return false; }',
      'export { publicApi };',
      'function initialize() { return true; }',
      'const ready = initialize();',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('module-init', reference(source, 5))]).byArtifactId.get('exports');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(retained).toContain('export { publicApi };');
    expect(retained).toContain('function initialize() { return true; }');
    expect(retained).not.toContain('function publicApi()');
    expect(retained).not.toContain('function exportHelper()');
  });

  it('keeps transitive local function dependencies through simple aliases in a selected function body', () => {
    const source = item('aliases', 'aliases.ts', [
      'export function inspect() {',
      '  const guard = authorize;',
      '  return guard();',
      '}',
      'function authorize() { return checkOwner(); }',
      'function checkOwner() { return true; }',
      'function unrelated() { return false; }',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('inspect', reference(source, 1))]).byArtifactId.get('aliases');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(retained).toContain('function authorize() { return checkOwner(); }');
    expect(retained).toContain('function checkOwner() { return true; }');
    expect(retained).not.toContain('function unrelated');
  });

  it('traverses tagged-template call targets during module initialization', () => {
    const source = item('tagged', 'tagged.ts', [
      'function tag(strings: TemplateStringsArray) { return taggedHelper(strings[0]); }',
      'function taggedHelper(value: string) { return value; }',
      'const result = tag`ready`;',
      'function unrelated() { return false; }',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('tagged-init', reference(source, 3))]).byArtifactId.get('tagged');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(retained).toContain('function tag(strings: TemplateStringsArray)');
    expect(retained).toContain('function taggedHelper(value: string)');
    expect(retained).not.toContain('function unrelated');
  });

  it('keeps class accessor closures when a class is retained as a value', () => {
    const source = item('accessors', 'accessors.ts', [
      'function register() { return registrationHelper(); }',
      'function registrationHelper() { return true; }',
      'class Hooks { get enabled() { return register(); } run() { return dormant(); } }',
      'function dormant() { return false; }',
      'const hooks = Hooks.prototype;',
      'export function inspect() { return hooks.enabled; }',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('inspect', reference(source, 6))]).byArtifactId.get('accessors');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(retained).toContain('function register() { return registrationHelper(); }');
    expect(retained).toContain('function registrationHelper() { return true; }');
    expect(retained).not.toContain('function dormant()');
  });

  it('traverses an aliased class constructor used during module initialization', () => {
    const source = item('constructor-alias', 'constructor-alias.ts', [
      'function initialize() { return true; }',
      'class Worker { constructor() { initialize(); } }',
      'const Alias = Worker;',
      'const instance = new Alias();',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('constructor-alias', reference(source, 4))]).byArtifactId.get('constructor-alias');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(retained).toContain('class Worker { constructor() { initialize(); } }');
    expect(retained).toContain('function initialize() { return true; }');
  });

  it('uses a full-source fallback when a mutable constructor alias is reassigned', () => {
    const source = item('mutable-alias', 'mutable-alias.ts', [
      'function initialize() { return true; }',
      'class First {}',
      'class Second { constructor() { initialize(); } }',
      'let Alias = First;',
      'Alias = Second;',
      'export function create() { return new Alias(); }',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('create', reference(source, 6))]).byArtifactId.get('mutable-alias');

    expect(selection?.diagnostics).toMatchObject({ method: 'full_source_fallback', fallbackReason: 'dynamic_scope' });
    expect(retainedLines(source, selection!.ranges).join('\n')).toContain('class Second { constructor() { initialize(); } }');
  });

  it.each([
    ['global computed dispatch', "function dispatch(name: string) { const handler = globalThis[name]; return handler(); }"],
    ['namespace computed dispatch', "import * as api from './api'; function dispatch(name: string) { return api[name](); }"],
    ['Reflect export lookup', 'function dispatch(key: string) { return Reflect.get(exports, key); }'],
  ])('uses a full-source fallback for %s', (_label, entry) => {
    const content = `${entry}\nfunction dynamicallyReachable() { return true; }`;
    const source = item('dynamic', 'dynamic.ts', content);
    const selection = selectEvidencePackets([source], [feature('dynamic-entry', reference(source, 1))]).byArtifactId.get('dynamic');

    expect(selection?.diagnostics).toMatchObject({ method: 'full_source_fallback', fallbackReason: 'dynamic_scope' });
    expect(selection?.ranges).toEqual([{ lineStart: 1, lineEnd: 2 }]);
  });

  it('retains complete selected classes and class definition effects while omitting pure unrelated classes', () => {
    const content = [
      'class Base {}',
      'class Selected extends Base {',
      '  run() { return helper(); }',
      '}',
      'class PureUnused {}',
      'class StaticField { static value = initialize(); }',
      'class ComputedMember { [computedKey()]() { return true; } }',
      '@register() class Decorated {}',
      'class ParameterDecorated { constructor(@register value: unknown) {} }',
      'function helper() { return true; }',
      'function initialize() { return true; }',
      'function computedKey() { return "key"; }',
      'function register() { return () => undefined; }',
    ].join('\n');
    const source = item('classes', 'classes.ts', content);
    const selection = selectEvidencePackets([source], [feature('selected-class', reference(source, 2))]).byArtifactId.get('classes');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(selection?.diagnostics.method).toBe('ast_dependency_units');
    expect(retained).toContain('class Selected extends Base');
    expect(retained).toContain('class Base {}');
    expect(retained).toContain('function helper() { return true; }');
    expect(retained).toContain('class StaticField { static value = initialize(); }');
    expect(retained).toContain('class ComputedMember { [computedKey()]() { return true; } }');
    expect(retained).toContain('@register() class Decorated {}');
    expect(retained).toContain('class ParameterDecorated { constructor(@register value: unknown) {} }');
    expect(retained).not.toContain('class PureUnused {}');
  });

  it('traverses a parameter decorator helper invoked during class definition', () => {
    const source = item('registration', 'registration.ts', [
      'let registered = false;',
      'function register(...args: unknown[]) { registered = true; return () => undefined; }',
      'class Registration { constructor(@register value: unknown) {} }',
      'export function inspect() { return registered; }',
    ].join('\n'));
    const selection = selectEvidencePackets([source], [feature('registration-state', reference(source, 4))]).byArtifactId.get('registration');
    const retained = retainedLines(source, selection!.ranges).join('\n');

    expect(retained).toContain('let registered = false;');
    expect(retained).toContain('class Registration { constructor(@register value: unknown) {} }');
    expect(retained).toContain('function register(...args: unknown[])');
  });

  it('accepts a real chunker result with leading trivia only when frozen version, hash, offsets, and lines match', () => {
    const source = item('retrieved', 'retrieved.ts', [
      'const guard = true;',
      '',
      '// retained with the complete function unit',
      'function extra() { return guard; }',
      '',
      'function irrelevant() { return false; }',
    ].join('\n'));
    const realChunk = chunkFrozenSource({ id: source.artifact.id, filePath: source.artifact.filePath, type: source.artifact.type }, source.content!)
      .find(chunk => chunk.kind === 'function' && chunk.symbol === 'extra');
    expect(realChunk).toBeDefined();
    expect(realChunk!.startOffset).toBeLessThan(source.content!.indexOf('function extra'));
    const context = chunkContext(source, realChunk!.content);
    const accepted = selectEvidencePackets([source], [], context);
    const packet = accepted.byArtifactId.get('retrieved');

    expect(accepted.contextIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(packet?.diagnostics).toMatchObject({ method: 'ast_dependency_units', addedRetrievedUnitCount: 1, selectedUnitCount: 1 });
    expect(retainedLines(source, packet!.ranges).join('\n')).toContain('function extra() { return guard; }');
    expect(retainedLines(source, packet!.ranges).join('\n')).not.toContain('function irrelevant');

    const malformed = {
      ...context,
      selectedChunks: [
        { ...context.selectedChunks![0]!, contentHash: '0'.repeat(64) },
        { ...context.selectedChunks![0]!, startOffset: context.selectedChunks![0]!.startOffset! + 1 },
        { ...context.selectedChunks![0]!, contentHash: undefined, startOffset: undefined, endOffset: undefined, lineStart: undefined, lineEnd: undefined },
      ],
    };
    const rejected = selectEvidencePackets([source], [], malformed);
    expect(rejected.contextIdentityHash).toBeNull();
    expect(rejected.byArtifactId.size).toBe(0);
  });

  it('promotes a verified real function fragment to the complete function unit', () => {
    const source = item('fragment', 'fragment.ts', [
      'function extra() {',
      `  const values = [${Array.from({ length: 36 }, (_, index) => `'value-${index}'`).join(', ')}];`,
      '  return values.join(":");',
      '}',
      'function irrelevant() { return false; }',
    ].join('\n'));
    const chunks = chunkFrozenSource({ id: source.artifact.id, filePath: source.artifact.filePath, type: source.artifact.type }, source.content!, { maxChars: 120 });
    const fragment = chunks.find(chunk => chunk.kind === 'function' && chunk.symbol === 'extra' && chunk.isFragment
      && chunk.startOffset > source.content!.indexOf('function extra'));
    expect(fragment).toBeDefined();
    const selection = selectEvidencePackets([source], [], contextForChunk(source, fragment!));
    const packet = selection.byArtifactId.get('fragment');
    const retained = retainedLines(source, packet!.ranges).join('\n');

    expect(packet?.diagnostics).toMatchObject({ addedRetrievedUnitCount: 1, selectedUnitCount: 1 });
    expect(retained).toContain("values.join(\":\")");
    expect(retained).not.toContain('function irrelevant');
  });
});
