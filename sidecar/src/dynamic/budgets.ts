import type { TokenUsage } from '../aiClient.js';
import { DynamicContractError } from './types.js';
import {DEFAULT_EXECUTION_BUDGET,type ExecutionBudget} from './budgetLimits.js';
export {DEFAULT_EXECUTION_BUDGET,type ExecutionBudget} from './budgetLimits.js';
const bounds = { runtimeMs: [1000, 300_000], maxSteps: [1, 25], maxModelCalls: [1, 100],
  maxObservationChars: [256, 32_000], maxConsoleBytes: [1024, 262_144], maxAccountedTokens: [1, 1_000_000] } as const;
/** Construct only supported integer bounds; old profiles receive defaults. */
export function normalizeBudget(value: unknown): ExecutionBudget {
  if (value === undefined) return { ...DEFAULT_EXECUTION_BUDGET };
  const fail = (): never => { throw new DynamicContractError(400, 'Execution limits must use supported integer bounds.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = { ...DEFAULT_EXECUTION_BUDGET };
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Object.hasOwn(bounds, key)) fail();
    const [min, max] = bounds[key as keyof typeof bounds];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) fail();
    result[key as keyof ExecutionBudget] = raw as number;
  }
  return result;
}
export class ExecutionBudgetExceeded extends Error {}
export class RunBudget {
  steps = 0;modelCalls = 0; consoleBytes = 2; private consoleMessages = 0; accountedTokens = 0; unknownUsageCalls = 0;
  constructor(readonly limits: ExecutionBudget) {}
  startStep(){if(this.steps>=this.limits.maxSteps)throw new ExecutionBudgetExceeded('Step limit reached; unfinished criteria were not tested.');this.steps++;}
  beforeCall() {
    if (this.modelCalls >= this.limits.maxModelCalls) throw new ExecutionBudgetExceeded('Model call limit reached; unfinished criteria were not tested.');
    if (this.limits.maxAccountedTokens !== undefined) {
      if (this.unknownUsageCalls) throw new ExecutionBudgetExceeded('Provider token usage unavailable; the accounted-token limit cannot be evaluated.');
      if (this.accountedTokens >= this.limits.maxAccountedTokens) throw new ExecutionBudgetExceeded('Accounted-token limit reached; unfinished criteria were not tested.');
    }
    this.modelCalls++;
  }
  recordUsage(usage?: TokenUsage) {
    const values = usage && [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheCreationTokens ?? 0];
    const total = usage?.totalTokens ?? values?.reduce((sum, value) => sum + value, 0);
    if (!values || values.some(value => !Number.isSafeInteger(value) || value < 0) || !Number.isSafeInteger(total) || total! < 0) this.unknownUsageCalls++;
    else this.accountedTokens += total!;
  }
  assertAccountedLimit() {
    if (this.limits.maxAccountedTokens === undefined) return;
    if (this.unknownUsageCalls) throw new ExecutionBudgetExceeded('Provider token usage unavailable; the accounted-token limit cannot be evaluated.');
    if (this.accountedTokens > this.limits.maxAccountedTokens) throw new ExecutionBudgetExceeded('Accounted-token limit exceeded by the completed request; no further action is allowed.');
  }
  observe(value: unknown) {
    if (JSON.stringify(value).length > this.limits.maxObservationChars) throw new ExecutionBudgetExceeded('Page observation limit reached; reduce page content or increase the recorded limit.');
  }
  console(value: string) {
    const bytes = Buffer.byteLength(JSON.stringify(value))+(this.consoleMessages?1:0);
    if (this.consoleBytes + bytes > this.limits.maxConsoleBytes) throw new ExecutionBudgetExceeded('Console output limit reached; partial logs were retained.');
    this.consoleBytes += bytes;this.consoleMessages++;
  }
  snapshot() { return { limits: this.limits, steps:this.steps, modelCalls: this.modelCalls, consoleBytes: this.consoleBytes,
    accountedTokens: this.accountedTokens, unknownUsageCalls: this.unknownUsageCalls,
    tokenAccounting: this.unknownUsageCalls ? this.unknownUsageCalls===this.modelCalls?'unavailable':'partial' : this.modelCalls ? 'available' : 'not_requested' }; }
}
