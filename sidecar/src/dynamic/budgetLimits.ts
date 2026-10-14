export type ExecutionBudget = { runtimeMs: number; maxSteps: number; maxModelCalls: number;
  maxObservationChars: number; maxConsoleBytes: number; maxAccountedTokens?: number };
export const DEFAULT_EXECUTION_BUDGET: Readonly<ExecutionBudget> = Object.freeze({ runtimeMs: 300_000,
  maxSteps: 25, maxModelCalls: 100, maxObservationChars: 32_000, maxConsoleBytes: 262_144 });
