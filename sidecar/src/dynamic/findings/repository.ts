import type { SupabaseClient } from '@supabase/supabase-js';
import { DynamicContractError } from '../types.js';
import type { DynamicFinding, FindingDetail, ReviewFindingInput, RemediationInput } from './types.js';
export interface FindingRepository {
    list(projectId: string): Promise<DynamicFinding[]>;
    get(projectId: string, id: string): Promise<FindingDetail>;
    collect(projectId: string, runId: string): Promise<DynamicFinding[]>;
    review(projectId: string, id: string, input: ReviewFindingInput): Promise<DynamicFinding>;
    remediate(projectId: string, id: string, input: RemediationInput): Promise<DynamicFinding>;
}
export class SupabaseFindingRepository implements FindingRepository {
    constructor(private readonly client: SupabaseClient) { }
    private async rpc(name: string, args: Record<string, unknown>) { const { data, error } = await this.client.rpc(name, args); if (error)
        throw new DynamicContractError(error.code === 'P0001' ? 409 : 503, error.code === 'P0001' ? 'Finding changed or this decision lacks valid evidence. Refresh and inspect the recorded Run.' : 'Dynamic finding storage unavailable.'); return data; }
    async list(projectId: string): Promise<DynamicFinding[]> { const { data, error } = await this.client.from('dynamic_findings').select('payload').eq('project_id', projectId).order('updated_at', { ascending: false }); if (error)
        throw new DynamicContractError(503, 'Dynamic finding storage unavailable.'); return (data ?? []).map(row => row.payload); }
    async get(projectId: string, id: string): Promise<FindingDetail> { const detail = await this.rpc('read_dynamic_finding', { p_project_id: projectId, p_finding_id: id }); if (!detail)
        throw new DynamicContractError(404, 'Finding not found in this project.'); return detail; }
    collect(projectId: string, runId: string) { return this.rpc('collect_dynamic_findings', { p_project_id: projectId, p_run_id: runId }); }
    review(projectId: string, id: string, input: ReviewFindingInput) { return this.rpc('review_dynamic_finding', { p_project_id: projectId, p_finding_id: id, p_input: input }); }
    remediate(projectId: string, id: string, input: RemediationInput) { return this.rpc('record_dynamic_remediation', { p_project_id: projectId, p_finding_id: id, p_input: input }); }
}
