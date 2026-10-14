import path from 'node:path';
import { redactObservation } from '../browser/privacy.js';
import type { UnitAssessment, UnitCounts, UnitTestCase } from './types.js';
export const MAX_UNIT_REPORT_BYTES = 1000000;
export function unitText(value: string, secrets: readonly string[]) { return redactObservation(value, secrets).replace(/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/|[A-Za-z]:\\)[^\s"<>]*/g, '[local path withheld]'); }
export function parseVitestReport(content: Buffer, workspace: string, secrets: readonly string[] = []): UnitAssessment {
    if (content.length > MAX_UNIT_REPORT_BYTES)
        throw Error('Machine report exceeds its bound');
    const raw = JSON.parse(content.toString('utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.success !== 'boolean' || !Array.isArray(raw.testResults) || raw.testResults.length > 500)
        throw Error('Vitest JSON report required');
    const count = (key: string) => { const n = raw[key]; if (!Number.isInteger(n) || n < 0 || n > 10000)
        throw Error('Valid framework counts required'); return n as number; };
    const counts: UnitCounts = { total: count('numTotalTests'), passed: count('numPassedTests'), failed: count('numFailedTests'), pending: count('numPendingTests'), todo: count('numTodoTests'), totalSuites: count('numTotalTestSuites'), failedSuites: count('numFailedTestSuites') };
    if (counts.total > 5000 || counts.total !== counts.passed + counts.failed + counts.pending + counts.todo || counts.failedSuites > counts.totalSuites)
        throw Error('Framework counts disagree');
    const tests: UnitTestCase[] = [], suiteErrors: UnitAssessment['suiteErrors'] = [];
    let detailsTruncated = false;
    const bounded = (value: unknown, max = 2000) => { if (typeof value !== 'string')
        throw Error('String result required'); if (value.length > max)
        detailsTruncated = true; return unitText(value, secrets).slice(0, max); };
    const fileName = (value: unknown) => { if (typeof value !== 'string')
        throw Error('Test filename required'); const relative = path.isAbsolute(value) ? path.relative(workspace, value) : value; if (relative.startsWith('..') || path.isAbsolute(relative))
        return '[external test file]'; return bounded(relative, 500); };
    for (const suite of raw.testResults) {
        if (!suite || !['passed', 'failed'].includes(suite.status) || !Array.isArray(suite.assertionResults))
            throw Error('Test file results required');
        const file = fileName(suite.name);
        if (suite.message) {
            suiteErrors.push({ file, message: bounded(suite.message) });
        }
        for (const test of suite.assertionResults) {
            if (tests.length >= 5000 || !test || !['passed', 'failed', 'pending', 'skipped', 'todo'].includes(test.status) || !Array.isArray(test.failureMessages) || test.failureMessages.some((x: unknown) => typeof x !== 'string'))
                throw Error('Bounded test cases required');
            if (test.failureMessages.length > 5)
                detailsTruncated = true;
            const duration = test.duration;
            if (duration !== undefined && duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0))
                throw Error('Test duration invalid');
            tests.push({ file, name: bounded(test.fullName, 1000), status: test.status, durationMs: duration ?? null, failureMessages: test.failureMessages.slice(0, 5).map((x: string) => bounded(x)) });
        }
    }
    const observed = { passed: 0, failed: 0, pending: 0, todo: 0 };
    for (const test of tests)
        observed[test.status === 'skipped' ? 'pending' : test.status]++;
    if (tests.length !== counts.total || Object.entries(observed).some(([key, value]) => counts[key as keyof UnitCounts] !== value) || (raw.success && (counts.failed > 0 || counts.failedSuites > 0 || suiteErrors.length)))
        throw Error('Summary and per-test outcomes disagree');
    return { counts, tests, suiteErrors, success: raw.success, detailsTruncated };
}
