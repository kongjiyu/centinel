/**
 * Frontend-owned copies of sidecar limits (`browser/fileTypes.ts`, `budgetLimits.ts`).
 * `dynamicRuntimeParity.test.ts` checks they equal the sidecar values.
 */
import type { ExecutionBudget } from './contracts';
export const MAX_UPLOAD_BYTES = 1_048_576;
export const MAX_DOWNLOAD_BYTES = 1_048_576;
export const DEFAULT_EXECUTION_BUDGET: Readonly<ExecutionBudget> = Object.freeze({
  runtimeMs: 300_000,
  maxSteps: 25,
  maxModelCalls: 100,
  maxObservationChars: 32_000,
  maxConsoleBytes: 262_144,
});
export type { DownloadGrant, LocalUploadFixture, UploadGrant } from './contracts';
