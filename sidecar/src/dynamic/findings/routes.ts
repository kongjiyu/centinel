import { DynamicContractError } from '../types.js';
import { normalizeRiskPriority, normalizeRiskSeverity } from '../../riskPolicy.js';
import type { FindingRepository } from './repository.js';
import type { ReviewFindingInput, RemediationInput } from './types.js';
function inputObject(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new DynamicContractError(400, 'Use the supported finding decision fields.'); const input = value as Record<string, unknown>; if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || Number(input.version) > 2147483647 || typeof input.note !== 'string' || input.note.trim().length < 3 || input.note.length > 4000)
    throw new DynamicContractError(400, 'Refresh the finding and include a reason (3–4000 characters).'); return { ...input, note: input.note.trim() }; }
export function validateReview(value: unknown): ReviewFindingInput { const input = inputObject(value, ['version', 'decision', 'note', 'severity', 'priority', 'confidence']); if (typeof input.decision !== 'string' || !['confirmed', 'rejected', 'needs_investigation'].includes(input.decision))
    throw new DynamicContractError(400, 'Choose a verification decision.'); for (const key of ['severity', 'priority', 'confidence'])
    if (input[key] !== undefined && input[key] !== null) {
        const valid = typeof input[key] === 'string' && (key === 'severity' ? normalizeRiskSeverity(input[key]) === input[key] : key === 'priority' ? normalizeRiskPriority(input[key]) === input[key] : ['low', 'medium', 'high'].includes(input[key] as string));
        if (!valid)
            throw new DynamicContractError(400, 'Choose explicit values from the shared triage vocabulary.');
    } if (input.decision === 'confirmed' && (!input.severity || !input.priority || !input.confidence))
    throw new DynamicContractError(400, 'Confirming requires explicit severity, priority and confidence.'); return input as ReviewFindingInput; }
export function validateRemediation(value: unknown): RemediationInput { const input = inputObject(value, ['version', 'status', 'note', 'regressionRunId']); if (typeof input.status !== 'string' || !['open', 'in_progress', 'resolved'].includes(input.status) || input.regressionRunId !== undefined && (typeof input.regressionRunId !== 'string' || !(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.regressionRunId))) || input.status === 'resolved' && !input.regressionRunId)
    throw new DynamicContractError(400, 'Choose remediation status; resolution requires a completed pinned regression Run.'); return input as RemediationInput; }
export async function handleFindingRoute(request: {
    method: string;
    pathname: string;
    readBody(): Promise<unknown>;
}, deps: {
    repository: FindingRepository;
    requireMember(projectId: string): Promise<void>;
    validatePrivate(projectId: string, value: unknown): Promise<void>;
}) {
    const match = request.pathname.match(/^\/projects\/([^/]+)\/dynamic\/(?:findings(?:\/([^/]+)(?:\/(review|remediation))?)?|runs\/([^/]+)\/findings)$/);
    if (!match)
        return null;
    const [, projectId, id, action, runId] = match;
    await deps.requireMember(projectId);
    try {
        if (runId && request.method === 'POST')
            return { status: 200, body: await deps.repository.collect(projectId, runId) };
        if (!runId && request.method === 'GET' && !action)
            return { status: 200, body: id ? await deps.repository.get(projectId, id) : await deps.repository.list(projectId) };
        if (id && action && request.method === 'POST') {
            const raw = await request.readBody();
            await deps.validatePrivate(projectId, raw);
            return { status: 200, body: action === 'review' ? await deps.repository.review(projectId, id, validateReview(raw)) : await deps.repository.remediate(projectId, id, validateRemediation(raw)) };
        }
        return { status: 405, body: { error: 'Unsupported finding operation.' } };
    }
    catch (error) {
        if (error instanceof DynamicContractError)
            return { status: error.status, body: { error: error.message } };
        throw error;
    }
}
