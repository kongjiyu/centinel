import type {ExplorationSnapshot} from './browser/exploration.js';
import type { EnvironmentSnapshot } from './environment/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DynamicContractError, type DynamicRepository, type DynamicRun, type Mission, type MissionInput, type MissionRevision, type RunPatch, type RunState } from './types.js';

function storageError(error: { code?: string; message?: string }): never {
  if (['P0002'].includes(error.code ?? '')) throw new DynamicContractError(404, 'Dynamic record not found.');
  if (['23505', 'P0001'].includes(error.code ?? '')) throw new DynamicContractError(409, 'Dynamic lifecycle or idempotency conflict.');
  throw new DynamicContractError(503, 'Dynamic storage unavailable. Apply the Mission/Run migration and verify access.');
}

/** Every query uses the authenticated request's RLS client, with no local fallback. */
export class SupabaseDynamicRepository implements DynamicRepository {
  constructor(private readonly client: SupabaseClient) {}
  async saveRevision(projectId: string, actorId: string, input: MissionInput, missionId?: string): Promise<MissionRevision> {
    const { data, error } = await this.client.rpc('save_dynamic_revision', { p_project_id: projectId, p_actor_id: actorId, p_input: input, p_mission_id: missionId ?? null });
    if (error) storageError(error);
    return data as MissionRevision;
  }
  async listMissions(projectId: string): Promise<Mission[]> {
    const { data, error } = await this.client.from('dynamic_missions').select('payload').eq('project_id', projectId).order('created_at', { ascending: false });
    if (error) storageError(error);
    return (data ?? []).map(row => row.payload as Mission);
  }
  async getRevision(projectId: string, revisionId: string): Promise<MissionRevision | null> {
    const { data, error } = await this.client.from('dynamic_mission_revisions').select('payload').eq('project_id', projectId).eq('id', revisionId).maybeSingle();
    if (error) storageError(error);
    return data?.payload as MissionRevision ?? null;
  }
  async getRun(projectId: string, runId: string): Promise<DynamicRun | null> {
    const { data, error } = await this.client.from('dynamic_runs').select('payload').eq('project_id', projectId).eq('id', runId).maybeSingle();
    if (error) storageError(error);
    return data?.payload as DynamicRun ?? null;
  }
  async listRuns(projectId: string, missionId?: string): Promise<DynamicRun[]> {
    let query = this.client.from('dynamic_runs').select('payload').eq('project_id', projectId).order('created_at', { ascending: false });
    if (missionId) query = query.eq('mission_id', missionId);
    const { data, error } = await query;
    if (error) storageError(error);
    return (data ?? []).map(row => row.payload as DynamicRun);
  }
  async getRunByKey(projectId: string, key: string): Promise<DynamicRun | null> {
    const { data, error } = await this.client.from('dynamic_runs').select('payload').eq('project_id', projectId).eq('idempotency_key', key).maybeSingle();
    if (error) storageError(error);
    return data?.payload as DynamicRun ?? null;
  }
  async createRun(projectId: string, actorId: string, revision: MissionRevision, key: string, environment?: EnvironmentSnapshot, baselineRunId?:string): Promise<{ run: DynamicRun; reused: boolean }> {
    const { data, error } = await this.client.rpc(baselineRunId?'start_dynamic_regression_run':environment ? 'start_dynamic_environment_run' : 'start_dynamic_run', { p_project_id: projectId, p_actor_id: actorId, p_revision_id: revision.id, p_key: key, ...(baselineRunId?{p_baseline_id:baselineRunId,p_environment:environment??null}:environment ? {p_environment:environment} : {}) });
    if (error) storageError(error);
    return data;
  }
  async claimRun(projectId: string, runId: string, workerId: string, leaseToken: string, sessionId: string | null): Promise<DynamicRun | null> {
    const { data, error } = await this.client.rpc('claim_dynamic_run', { p_project_id: projectId, p_run_id: runId, p_worker_id: workerId, p_token: leaseToken, p_session_id: sessionId });
    if (error) storageError(error);
    return data;
  }
  async heartbeatRun(projectId: string, runId: string, workerId: string, leaseToken: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('heartbeat_dynamic_run', { p_project_id: projectId, p_run_id: runId, p_worker_id: workerId, p_token: leaseToken });
    if (error) storageError(error);
    return data === true;
  }
  async recoverRuns(projectId: string): Promise<DynamicRun[]> {
    const { data, error } = await this.client.rpc('recover_dynamic_runs', { p_project_id: projectId });
    if (error) storageError(error);
    return data ?? [];
  }
  async checkpointExploration(projectId:string,runId:string,workerId:string,token:string,snapshot:ExplorationSnapshot){const {data,error}=await this.client.rpc('checkpoint_dynamic_exploration',{p_project_id:projectId,p_run_id:runId,p_worker_id:workerId,p_token:token,p_snapshot:snapshot});if(error)storageError(error);return data===true;}
  async compareAndSetRun(projectId: string, runId: string, expected: RunState, patch: RunPatch): Promise<DynamicRun | null> {
    const { data, error } = await this.client.rpc('transition_dynamic_run', { p_project_id: projectId, p_run_id: runId, p_expected: expected, p_patch: patch });
    if (error) storageError(error);
    return data;
  }
}
