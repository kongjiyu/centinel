import type { ProcessResult } from '../workspace/process.js';
export type UnitOutcome = 'passed' | 'failed' | 'not_tested' | 'no_tests' | 'configuration_error' | 'missing_dependencies' | 'parser_error' | 'cancelled' | 'timeout' | 'output_limit' | 'runner_error';
export type UnitCounts = {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    todo: number;
    totalSuites: number;
    failedSuites: number;
};
export type UnitTestCase = {
    file: string;
    name: string;
    status: 'passed' | 'failed' | 'pending' | 'skipped' | 'todo';
    durationMs: number | null;
    failureMessages: string[];
};
export type UnitAssessment = {
    counts: UnitCounts;
    tests: UnitTestCase[];
    suiteErrors: Array<{
        file: string;
        message: string;
    }>;
    success: boolean;
    detailsTruncated: boolean;
};
export type UnitExecutionResult = {
    schemaVersion: 1;
    framework: {
        name: 'vitest';
        version: string | null;
        nodeVersion?: string;
    };
    command: {
        program: 'node';
        script: string | null;
        args: string[];
    };
    workspace: {
        fingerprint: string | null;
        gitCommit: string | null;
        authorizationId: string | null;
        cliSha256?: string;
    };
    outcome: UnitOutcome;
    process: ProcessResult | null;
    assessment: UnitAssessment | null;
    reason: string;
    startedAt: string;
    finishedAt: string;
    limitations: string[];
};
export type UnitCommand = {
    program: 'node';
    script: string | null;
    fingerprint: string | null;
    authorizationId: string | null;
    gitCommit: string | null;
    frameworkVersion: string | null;
    cliSha256: string | null;
    nodeVersion: string | null;
};
export type DynamicUnitRun = {
    id: string;
    projectId: string;
    environmentId: string;
    kind: 'unit';
    state: import('../types.js').RunState;
    verdict: import('../types.js').CheckVerdict;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    idempotencyKey: string;
    command: UnitCommand;
    timeoutMs: number;
    environment: import('../environment/types.js').EnvironmentProfile & {
        preparation: import('../environment/types.js').EnvironmentData['preparation'];
        resourceKey: string;
    };
    result: UnitExecutionResult | null;
    reason: string | null;
    cancelRequested?: boolean;
    lease?: {
        workerId: string;
        heartbeatAt: string;
        expiresAt: string;
    };
};
