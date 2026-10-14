import { beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceRegistry, inspectWorkspace } from '../../src/dynamic/workspace/registry.js';
import { runVitestWorkspace, resolveVitestWorkspace } from '../../src/dynamic/unit/runner.js';
import * as processes from '../../src/dynamic/workspace/process.js';
import { parseVitestReport } from '../../src/dynamic/unit/parser.js';
const fixtures = fileURLToPath(new URL('../fixtures/vitest-workspace/', import.meta.url));
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-vitest-')), directory = path.join(root, 'project'); fs.cpSync(fixtures, directory, { recursive: true }); fs.symlinkSync(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir'); const registry = new WorkspaceRegistry(path.join(root, 'registry')); registry.authorize('actor', 'project', 'env', { directory, packageManager: 'pnpm', scripts: { unit: 'unit' }, allowScripts: true, expectedFingerprint: inspectWorkspace(directory).fingerprint }); return { root, directory, registry, input: { registry, ownerId: 'actor', projectId: 'project', environmentId: 'env', receiptRoot: path.join(root, 'receipts'), timeoutMs: 10000 }, clean() { fs.rmSync(root, { recursive: true, force: true }); } }; }
beforeEach(() => { process.env.CENTINEL_TOKEN_ENCRYPTION_KEY = 'unit-test-encryption'; });
describe('separate bounded Vitest adapter', () => {
    it('runs the installed framework and distinguishes real passing/failing per-test counts', async () => { const f = fixture(); try {
        const passed = await runVitestWorkspace(f.input);
        expect(passed.outcome).toBe('passed');
        expect(passed.framework.version).toMatch(/^4\./);
        expect(passed.assessment?.counts).toMatchObject({ total: 1, passed: 1, failed: 0 });
        const failed = await runVitestWorkspace({ ...f.input, variables: { CENTINEL_UNIT_CASE: 'failed' } });
        expect(failed.outcome).toBe('failed');
        expect(failed.assessment?.counts).toMatchObject({ total: 1, failed: 1 });
        expect(failed.assessment?.tests[0].failureMessages.join('')).toContain('public expected');
        expect(failed.process?.output).not.toContain(f.root);
        expect(fs.readdirSync(f.input.receiptRoot)).toEqual([]);
    }
    finally {
        f.clean();
    } }, 20000);
    it('reports no tests rather than a pass', async () => { const f = fixture(); try {
        fs.unlinkSync(path.join(f.directory, 'fixture.case.ts'));
        const result = await runVitestWorkspace(f.input);
        expect(result.outcome).toBe('no_tests');
        expect(result.assessment?.counts.total).toBe(0);
    }
    finally {
        f.clean();
    } });
    it('terminates active test work on timeout and cancellation without a passing assessment', async () => {
        const f = fixture();
        try {
            const marker=path.join(f.root,'active.marker');
            const variables={CENTINEL_UNIT_CASE:'slow',CENTINEL_UNIT_MARKER:marker};
            const timed=await runVitestWorkspace({...f.input,timeoutMs:2000,variables});
            expect(timed.outcome).toBe('timeout');expect(timed.assessment).toBeNull();expect(fs.existsSync(marker)).toBe(true);fs.unlinkSync(marker);
            const controller=new AbortController();const timer=setInterval(()=>{if(fs.existsSync(marker))controller.abort();},20);
            try{const cancelled=await runVitestWorkspace({...f.input,signal:controller.signal,variables});expect(fs.existsSync(marker)).toBe(true);expect(cancelled.outcome).toBe('cancelled');expect(cancelled.assessment).toBeNull();}finally{clearInterval(timer);}
        }finally{f.clean();}
    },15000);
    it('rejects missing dependencies, changed authorization, shell wrappers and escaping metadata', async () => { const f = fixture(); try {
        fs.unlinkSync(path.join(f.directory, 'node_modules'));
        expect((await runVitestWorkspace(f.input)).outcome).toBe('missing_dependencies');
        expect((await runVitestWorkspace({ ...f.input, ownerId: 'other' })).outcome).toBe('configuration_error');
        fs.writeFileSync(path.join(f.directory, 'package.json'), '{"scripts":{"unit":"vitest --run; echo unsafe"}}');
        expect((await runVitestWorkspace(f.input)).outcome).toBe('configuration_error');
        f.registry.authorize('actor', 'project', 'env', { directory: f.directory, packageManager: 'pnpm', scripts: { unit: 'unit' }, allowScripts: true, expectedFingerprint: inspectWorkspace(f.directory).fingerprint });
        expect(() => resolveVitestWorkspace(f.input)).toThrow('plain vitest');
        fs.unlinkSync(path.join(f.directory, 'package.json'));
        fs.symlinkSync(path.join(fixtures, 'package.json'), path.join(f.directory, 'package.json'));
        expect((await runVitestWorkspace(f.input)).outcome).toBe('configuration_error');
    }
    finally {
        f.clean();
    } });
    it('never reports all skipped or todo tests as passing', async () => { const f = fixture(); try {
        for (const kind of ['skipped', 'todo']) {
            const result = await runVitestWorkspace({ ...f.input, variables: { CENTINEL_UNIT_CASE: kind } });
            expect(result.outcome).toBe('not_tested');
            expect(result.assessment?.counts.passed).toBe(0);
            expect(result.assessment?.counts.total).toBe(1);
        }
    }
    finally {
        f.clean();
    } });
    it('classifies invalid machine output and refuses symlink report slots', async () => { const f = fixture(); const spy = vi.spyOn(processes, 'runBoundedProcess'); try {
        spy.mockImplementation(async (input) => { const report = input.args.find(x => x.startsWith('--outputFile='))!.slice('--outputFile='.length); fs.writeFileSync(report, '{bad'); return { outcome: 'passed', exitCode: 0, signal: null, output: '', truncated: false, durationMs: 1 }; });
        expect((await runVitestWorkspace(f.input)).outcome).toBe('parser_error');
        const outside = path.join(f.root, 'outside.json');
        fs.writeFileSync(outside, 'private sentinel');
        spy.mockImplementation(async (input) => { const report = input.args.find(x => x.startsWith('--outputFile='))!.slice('--outputFile='.length); fs.symlinkSync(outside, report); return { outcome: 'passed', exitCode: 0, signal: null, output: '', truncated: false, durationMs: 1 }; });
        const result = await runVitestWorkspace(f.input);
        expect(result.outcome).toBe('runner_error');
        expect(JSON.stringify(result)).not.toContain('private sentinel');
        expect(fs.readFileSync(outside, 'utf8')).toBe('private sentinel');
    }
    finally {
        spy.mockRestore();
        f.clean();
    } });
    it('rejects malformed or inconsistent JSON and redacts test failures before truncating', () => { const report = { success: false, numTotalTests: 1, numPassedTests: 0, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: 1, numFailedTestSuites: 1, testResults: [{ name: '/workspace/sample.test.ts', status: 'failed', assertionResults: [{ fullName: 'failure', status: 'failed', failureMessages: ['secret-value /Users/test/private/file.ts'] }] }] }; const parsed = parseVitestReport(Buffer.from(JSON.stringify(report)), '/workspace', ['secret-value']); expect(parsed.tests[0].file).toBe('sample.test.ts'); expect(parsed.tests[0].failureMessages[0]).not.toContain('secret-value'); expect(parsed.tests[0].failureMessages[0]).not.toContain('/Users/'); expect(() => parseVitestReport(Buffer.from('{'), '')).toThrow(); expect(() => parseVitestReport(Buffer.from(JSON.stringify({ ...report, numPassedTests: 1 })), '')).toThrow('counts'); });
});
