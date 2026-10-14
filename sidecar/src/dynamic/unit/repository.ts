import type { SupabaseClient } from '@supabase/supabase-js';
import { DynamicContractError } from '../types.js';
import type { DynamicUnitRun, UnitCommand, UnitExecutionResult } from './types.js';
export class UnitRepository {
    constructor(private readonly client: SupabaseClient) { }
    private async rpc(name: string, args: Record<string, unknown>) { const { data, error } = await this.client.rpc(name, args).abortSignal(AbortSignal.timeout(15000)); if (error)
        throw new DynamicContractError(error.code === 'P0001' || error.code === '23505' ? 409 : error.code === 'P0002' ? 404 : 503, 'Unit execution state changed or storage is unavailable. Refresh history and inspect cleanup readiness.'); return data; }
    async get(project: string, id: string): Promise<DynamicUnitRun> { const { data, error } = await this.client.from('dynamic_unit_runs').select('payload').eq('project_id', project).eq('id', id).abortSignal(AbortSignal.timeout(15000)).maybeSingle(); if (error)
        throw new DynamicContractError(503, 'Unit history unavailable.'); if (!data)
        throw new DynamicContractError(404, 'Unit Run not available in this project.'); return data.payload; }
    async byKey(project: string, key: string): Promise<DynamicUnitRun | null> { const { data, error } = await this.client.from('dynamic_unit_runs').select('payload').eq('project_id', project).eq('idempotency_key', key).abortSignal(AbortSignal.timeout(15000)).maybeSingle(); if (error)
        throw new DynamicContractError(503, 'Unit history unavailable.'); return data?.payload ?? null; }
    async list(project: string, profile: string): Promise<DynamicUnitRun[]> { await this.recover(project); const { data, error } = await this.client.from('dynamic_unit_runs').select('payload').eq('project_id', project).eq('profile_id', profile).order('created_at', { ascending: false }).limit(100).abortSignal(AbortSignal.timeout(15000)); if (error)
        throw new DynamicContractError(503, 'Unit history unavailable.'); return (data ?? []).map(row => row.payload); }
    preflight(project: string, profile: string, key: string, timeout: number, outcome: string, reason: string): Promise<DynamicUnitRun> { return this.rpc('record_dynamic_unit_preflight', { p_project_id: project, p_profile_id: profile, p_key: key, p_timeout_ms: timeout, p_outcome: outcome, p_reason: reason }); }
    start(project: string, profile: string, key: string, command: UnitCommand, timeout: number): Promise<{
        run: DynamicUnitRun;
        reused: boolean;
    }> { return this.rpc('start_dynamic_unit_run', { p_project_id: project, p_profile_id: profile, p_key: key, p_command: command, p_timeout_ms: timeout }); }
    claim(project: string, id: string, worker: string, token: string): Promise<DynamicUnitRun | null> { return this.rpc('claim_dynamic_unit_run', { p_project_id: project, p_id: id, p_worker: worker, p_token: token }); }
    heartbeat(project: string, id: string, worker: string, token: string): Promise<boolean> { return this.rpc('heartbeat_dynamic_unit_run', { p_project_id: project, p_id: id, p_worker: worker, p_token: token }); }
    finish(project: string, id: string, token: string, result: UnitExecutionResult): Promise<DynamicUnitRun | null> { const shared = structuredClone(result); if (shared.process) {
        shared.process.truncated ||= shared.process.output.length > 8192;
        shared.process.output = shared.process.output.slice(0, 8192);
    } return this.rpc('finish_dynamic_unit_run', { p_project_id: project, p_id: id, p_token: token, p_result: shared }); }
    cancel(project: string, id: string): Promise<DynamicUnitRun> { return this.rpc('cancel_dynamic_unit_run', { p_project_id: project, p_id: id }); }
    recover(project: string): Promise<DynamicUnitRun[]> { return this.rpc('recover_dynamic_unit_runs', { p_project_id: project }); }
    async events(project: string, id: string) { const { data, error } = await this.client.from('dynamic_unit_data_events').select('payload').eq('project_id', project).eq('unit_run_id', id).order('created_at').abortSignal(AbortSignal.timeout(15000)); if (error)
        throw new DynamicContractError(503, 'Unit cleanup history unavailable.'); return (data ?? []).map(row => row.payload); }
}
