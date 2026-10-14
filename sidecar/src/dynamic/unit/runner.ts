import fs from 'node:fs';
import path from 'node:path';
import { workspaceAuthorizationId, type WorkspaceRegistry } from '../workspace/registry.js';
import { runBoundedProcess } from '../workspace/process.js';
import { MAX_UNIT_REPORT_BYTES, parseVitestReport, unitText } from './parser.js';
import type { UnitExecutionResult, UnitOutcome } from './types.js';
export class UnitPrerequisiteError extends Error {
    constructor(readonly outcome: 'configuration_error' | 'missing_dependencies', message: string) { super(message); }
}
/** Honor only the selected plain Vitest script; never evaluate a repository shell command. */
export function resolveVitestWorkspace(input: {
    registry: WorkspaceRegistry;
    ownerId: string;
    projectId: string;
    environmentId: string;
}) {
    let verified: ReturnType<WorkspaceRegistry['verify']>;
    try {
        verified = input.registry.verify(input.ownerId, input.projectId, input.environmentId, 'unit');
    }
    catch {
        throw new UnitPrerequisiteError('configuration_error', 'Inspect and authorize the current local unit script first.');
    }
    const { authorization, inspection, script } = verified;
    if (!/^vitest(?:\s+(?:--run|run))?\s*$/.test(inspection.scriptDefinitions[script]))
        throw new UnitPrerequisiteError('configuration_error', 'First adapter supports a plain vitest / vitest --run / vitest run script. Extra flags or shell wrappers need a separate adapter.');
    let packagePath: string, manifest: any;
    try {
        packagePath = fs.realpathSync(path.join(authorization.directory, 'node_modules', 'vitest', 'package.json'));
        if (fs.statSync(packagePath).size > 1000000)
            throw Error();
        manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    }
    catch {
        throw new UnitPrerequisiteError('missing_dependencies', 'Install the target repository dependencies manually; Vitest is not available.');
    }
    if (manifest.name !== 'vitest' || !/^([34])\.\d+\.\d+(?:[-+].*)?$/.test(manifest.version))
        throw new UnitPrerequisiteError('configuration_error', 'First adapter supports installed Vitest 3.x and 4.x JSON reporter contracts.');
    let cli: string;
    try {
        const directory = fs.realpathSync(path.dirname(packagePath));
        cli = fs.realpathSync(path.join(directory, 'vitest.mjs'));
        if (!cli.startsWith(directory + path.sep) || !fs.statSync(cli).isFile() || fs.statSync(cli).size > 1000000)
            throw Error();
    }
    catch {
        throw new UnitPrerequisiteError('missing_dependencies', 'Installed Vitest CLI is unavailable or invalid.');
    }
    const executable = authorization.runtimeBinDirectory ? path.join(authorization.runtimeBinDirectory, process.platform === 'win32' ? 'node.exe' : 'node') : process.execPath;
    if (!fs.existsSync(executable))
        throw new UnitPrerequisiteError('missing_dependencies', 'Selected Node runtime is missing.');
    return { ...verified, version: manifest.version as string, executable, cli };
}
export async function runVitestWorkspace(input: {
    registry: WorkspaceRegistry;
    ownerId: string;
    projectId: string;
    environmentId: string;
    receiptRoot: string;
    timeoutMs: number;
    variables?: Record<string, string>;
    signal?: AbortSignal;
    onOutput?(value: string): void;
    expectedAuthorizationId?: string;
}): Promise<UnitExecutionResult> {
    const startedAt = new Date().toISOString();
    const result: UnitExecutionResult = { schemaVersion: 1, framework: { name: 'vitest', version: null }, command: { program: 'node', script: null, args: ['vitest.mjs', 'run', '--reporter=json', '--outputFile=[private report]', '--cache=false'] }, workspace: { fingerprint: null, gitCommit: null, authorizationId: null }, outcome: 'configuration_error', process: null, assessment: null, reason: 'Unit execution was not started.', startedAt, finishedAt: startedAt, limitations: ['Authorized repository tests execute local code; this adapter is not an operating-system sandbox.', 'No model-generated tests, dependency installation, browser checks or performance benchmark is implied.', 'Logs and machine reports are bounded; missing results never establish a passing suite.'] };
    let directory: string | undefined;
    const secrets = Object.values(input.variables ?? {});
    const finish = (outcome: UnitOutcome, reason: string) => { result.outcome = outcome; result.reason = reason; result.finishedAt = new Date().toISOString(); return result; };
    try {
        if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 300000 || !path.isAbsolute(input.receiptRoot))
            return finish('configuration_error', 'Choose a timeout of 100–300000 ms and the owned receipt directory.');
        const resolved = resolveVitestWorkspace(input);
        const authorizationId = workspaceAuthorizationId(resolved.authorization);
        if (input.expectedAuthorizationId && authorizationId !== input.expectedAuthorizationId)
            return finish('configuration_error', 'Workspace authorization changed before execution.');
        result.framework.version = resolved.version;
        result.command.script = resolved.script;
        result.workspace = { fingerprint: resolved.inspection.fingerprint, gitCommit: resolved.inspection.gitCommit, authorizationId };
        fs.mkdirSync(input.receiptRoot, { recursive: true, mode: 0o700 });
        directory = fs.mkdtempSync(path.join(input.receiptRoot, 'vitest-'));
        fs.chmodSync(directory, 0o700);
        const report = path.join(directory, 'report.json');
        const process = await runBoundedProcess({ executable: resolved.executable, args: [resolved.cli, 'run', '--reporter=json', '--outputFile=' + report, '--cache=false'], cwd: resolved.authorization.directory, home: path.join(directory, 'home'), runtimeBinDirectory: resolved.authorization.runtimeBinDirectory, variables: input.variables, timeoutMs: input.timeoutMs, maxOutputBytes: 256000, signal: input.signal, onOutput: input.onOutput ? value => input.onOutput!(unitText(value, secrets)) : undefined });
        result.process = { ...process, output: unitText(process.output, secrets) };
        if (!['passed', 'failed'].includes(process.outcome))
            return finish(process.outcome, 'Unit process stopped: ' + process.outcome + '. No complete suite verdict is claimed.');
        if (!fs.existsSync(report))
            return finish(process.exitCode === 0 ? 'parser_error' : 'runner_error', 'Vitest did not produce a complete machine report. Inspect the retained bounded output.');
        const fd = fs.openSync(report, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let content: Buffer;
        try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size > MAX_UNIT_REPORT_BYTES)
                return finish('output_limit', 'Vitest machine report exceeded its bounded regular-file slot.');
            const buffer = Buffer.alloc(MAX_UNIT_REPORT_BYTES + 1);
            let length = 0;
            while (length < buffer.length) {
                const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
                if (!read)
                    break;
                length += read;
            }
            if (length > MAX_UNIT_REPORT_BYTES)
                return finish('output_limit', 'Vitest machine report grew beyond its bound.');
            content = buffer.subarray(0, length);
        }
        finally {
            fs.closeSync(fd);
        }
        try {
            result.assessment = parseVitestReport(content, resolved.authorization.directory, secrets);
        }
        catch {
            return finish('parser_error', 'Vitest JSON was invalid or summary counts disagreed with per-test results.');
        }
        const a = result.assessment;
        if (a.counts.total === 0)
            return finish(a.counts.failedSuites || a.suiteErrors.length ? 'runner_error' : 'no_tests', a.counts.failedSuites || a.suiteErrors.length ? 'Test files could not execute.' : 'No tests were collected.');
        if (a.counts.failed || a.counts.failedSuites || a.suiteErrors.length)
            return finish('failed', 'Vitest reported failing tests or suites.');
        if (!a.counts.passed)
            return finish('not_tested', 'All collected tests were skipped or todo; no passing suite is claimed.');
        if (!a.success || process.exitCode !== 0 || process.signal)
            return finish('runner_error', 'Process exit and machine success did not establish a passing suite.');
        return finish('passed', 'Vitest completed with matching summary and per-test results.');
    }
    catch (error) {
        if (error instanceof UnitPrerequisiteError)
            return finish(error.outcome, error.message);
        return finish('runner_error', 'Local unit execution or its bounded report slot was unavailable.');
    }
    finally {
        if (directory)
            try {
                fs.rmSync(directory, { recursive: true, force: true });
            }
            catch {
                result.limitations.push('Temporary machine-report cleanup could not be confirmed; inspect owned receipt storage.');
            }
    }
}
