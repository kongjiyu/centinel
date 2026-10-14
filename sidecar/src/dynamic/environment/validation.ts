import {normalizeActionPolicy} from '../browser/actionPolicy.js';
import { DynamicContractError } from '../types.js';
import { normalizeBudget } from '../budgets.js';
import type { EnvironmentInput } from './types.js';
export const variableName = (name: string) => /^[A-Z][A-Z0-9_]{0,63}$/.test(name);
export function validateEnvironment(value: unknown): EnvironmentInput {
  const fail = (): never => { throw new DynamicContractError(400, 'Environment needs a name, HTTP website, valid origins, viewport and variable names.'); };
  if (!value || typeof value !== 'object') fail();
  const input = value as EnvironmentInput;
  const url = (value: string) => { try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail(); return parsed; } catch { return fail(); } };
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || typeof input.targetUrl !== 'string') fail();
  const target = url(input.targetUrl);
  if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length < 1 || input.allowedOrigins.length > 10 || input.allowedOrigins.some(origin => typeof origin !== 'string' || url(origin).origin !== origin) || !input.allowedOrigins.includes(target.origin)) fail();
  if (!input.viewport || !Number.isInteger(input.viewport.width) || !Number.isInteger(input.viewport.height) || input.viewport.width < 320 || input.viewport.width > 3840 || input.viewport.height < 320 || input.viewport.height > 2160) fail();
  if (!Array.isArray(input.requiredVariables) || input.requiredVariables.length > 30 || input.requiredVariables.some(name => typeof name !== 'string' || !variableName(name)) || new Set(input.requiredVariables).size !== input.requiredVariables.length) fail();
  for (const name of ['accountRole', 'startupInstructions', 'targetVersion'] as const) if (typeof input[name] !== 'string' || input[name].length > (name === 'startupInstructions' ? 2000 : 200)) fail();
  if(input.sessionReference!==undefined&&typeof input.sessionReference!=='string'||input.sessionReadySelector!==undefined&&typeof input.sessionReadySelector!=='string')fail();
  if(input.dataResourceKey!==undefined&&(typeof input.dataResourceKey!=='string'||input.dataResourceKey.trim()&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(input.dataResourceKey.trim())))fail();
  const dataResourceKey=input.dataResourceKey?.trim().toLowerCase();
  const sessionReference=input.sessionReference?.trim();const sessionReadySelector=input.sessionReadySelector?.trim();
  if(Boolean(sessionReference)!==Boolean(sessionReadySelector)||sessionReference&&!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(sessionReference)||sessionReadySelector&&sessionReadySelector.length>500)fail();
  const policy=normalizeActionPolicy(input.actionPolicy);if(policy.downloads?.some(grant=>!input.allowedOrigins.includes(new URL(grant.url).origin)))fail();
  if(policy.privateInputs?.some(grant=>!input.allowedOrigins.includes(grant.origin)||!input.requiredVariables.includes(grant.variable)))fail();
  return structuredClone({actionPolicy:policy,budgets:normalizeBudget(input.budgets),...(dataResourceKey?{dataResourceKey}:{}),...(sessionReference?{sessionReference,sessionReadySelector}:{}),name: input.name.trim(), targetUrl: target.href, allowedOrigins: input.allowedOrigins, viewport: input.viewport, accountRole: input.accountRole.trim(), requiredVariables: input.requiredVariables, startupInstructions: input.startupInstructions.trim(), targetVersion: input.targetVersion.trim()});
}
