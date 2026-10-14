import {validSuggestionRecord} from './suggestions.js';
import { DynamicContractError, type EvidenceReference, type MissionRevision } from '../types.js';
import type { UsabilityAssessment } from './types.js';
/** Require selected rules, frozen perspective and retained assessment proof. */
export function validateUsabilityResult(value: unknown, revision: MissionRevision, evidence: readonly EvidenceReference[]): UsabilityAssessment {
    const fail = (): never => { throw new DynamicContractError(400, 'Usability results must match the frozen configuration and retained evidence.'); };
    if (!value || typeof value !== 'object' || Array.isArray(value) || !revision.usability)
        return fail();
    const input = value as UsabilityAssessment;
    if (Object.keys(input).some(key => !['schemaVersion', 'config', 'observations', 'limitations', 'keyboardActions', 'assessedAt','suggestions'].includes(key)) || input.schemaVersion !== 1 || JSON.stringify(input.config) !== JSON.stringify(revision.usability) || !Array.isArray(input.observations) || input.observations.length > 160 || !Number.isInteger(input.keyboardActions) || input.keyboardActions < 0 || input.keyboardActions > 42 || typeof input.assessedAt !== 'string' || input.assessedAt.length > 50 || !Number.isFinite(Date.parse(input.assessedAt)))
        return fail();
    if (!Array.isArray(input.limitations) || !input.limitations.length || input.limitations.length > 10 || input.limitations.some(text => typeof text !== 'string' || !text.trim() || text.length > 2000))
        return fail();
    const proof = evidence.filter(ref => ref.kind === 'usability');
    if (proof.length !== 1)
        return fail();
    const keys = new Set<string>();const identities=new Set<string>();
    for (const row of input.observations) {
        if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['ruleId', 'persona', 'kind', 'verdict', 'expected', 'observed', 'controlRef','controlKey', 'checkId', 'evidenceIds'].includes(key)) || !revision.usability.rules.includes(row.ruleId) || row.persona !== revision.usability.persona || row.kind !== 'deterministic' || !['passed', 'failed', 'uncertain', 'not_tested'].includes(row.verdict) || typeof row.expected !== 'string' || !row.expected.trim() || row.expected.length > 2000 || typeof row.observed !== 'string' || !row.observed.trim() || row.observed.length > 2000)
            return fail();
        if (row.controlRef !== undefined && (typeof row.controlRef !== 'string' || !/^u(?:[0-9]|[1-3][0-9])$/.test(row.controlRef)))
            return fail();
        if(row.controlKey!==undefined&&(!row.controlRef||typeof row.controlKey!=='string'||!/^[a-f0-9]{64}$/.test(row.controlKey)))return fail();
        if(row.controlKey){const identity=row.ruleId+':'+row.controlKey;if(identities.has(identity))return fail();identities.add(identity);}
        if (row.checkId !== undefined && (typeof row.checkId !== 'string' || !(row.ruleId === 'feedback' ? revision.usability.feedbackCheckIds : row.ruleId === 'error_recovery' ? revision.usability.errorRecoveryCheckIds : []).includes(row.checkId)))
            return fail();
        const key = [row.ruleId, row.controlRef ?? '', row.checkId ?? ''].join(':');
        if (keys.has(key))
            return fail();
        keys.add(key);
        if (!Array.isArray(row.evidenceIds) || !row.evidenceIds.includes(proof[0].id) || row.evidenceIds.length > 20 || new Set(row.evidenceIds).size !== row.evidenceIds.length || row.evidenceIds.some(id => !evidence.some(ref => ref.id === id)))
            return fail();
    }
    if (revision.usability.rules.some(rule => !input.observations.some(row => row.ruleId === rule)))
        return fail();
    if(input.suggestions!==undefined&&(!revision.usability.includeSuggestions||!validSuggestionRecord(input.suggestions,input)))return fail();
    if(revision.usability.includeSuggestions&&!input.suggestions)return fail();
    return structuredClone(input);
}
