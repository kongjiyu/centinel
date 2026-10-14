import type { SupabaseClient } from '@supabase/supabase-js';
import { DynamicContractError } from '../types.js';
import { validateEnvironment } from './validation.js';
import type { EnvironmentProfile, EnvironmentData } from './types.js';
export class EnvironmentRepository {
  constructor(private readonly client: SupabaseClient) {}
  async list(projectId: string): Promise<EnvironmentProfile[]> {
    const {data,error}=await this.client.from('dynamic_environments').select('payload').eq('project_id',projectId).order('updated_at',{ascending:false});
    if(error)throw new DynamicContractError(503,'Environment storage unavailable. Apply the environment migration.');
    return (data??[]).map(row=>row.payload as EnvironmentProfile);
  }
  async get(projectId: string, id: string): Promise<EnvironmentProfile> {
    const {data,error}=await this.client.from('dynamic_environments').select('payload').eq('project_id',projectId).eq('id',id).maybeSingle();
    if(error)throw new DynamicContractError(503,'Environment storage unavailable.');
    if(!data)throw new DynamicContractError(404,'Environment not found in this project.');
    return data.payload;
  }
  async data(projectId: string,id: string): Promise<EnvironmentData> {
    const {data,error}=await this.client.rpc('read_dynamic_environment_data',{p_project_id:projectId,p_profile_id:id});
    if(error)throw new DynamicContractError(503,'Test data state unavailable. Apply the data lifecycle migration.');
    return data;
  }
  async recordData(projectId: string,id: string,kind: 'preparation'|'cleanup',outcome:'completed'|'failed',note:string): Promise<EnvironmentData> {
    if(!['completed','failed'].includes(outcome)||typeof note!=='string'||note.trim().length<3||note.length>2000)throw new DynamicContractError(400,'Record what was prepared or cleaned up (3–2000 characters).');
    const {data,error}=await this.client.rpc('record_dynamic_environment_data',{p_project_id:projectId,p_profile_id:id,p_kind:kind,p_outcome:outcome,p_note:note});
    if(error)throw new DynamicContractError(error.code==='P0001'?409:503,'Data state changed or a Run/cleanup is still pending. Refresh before recording preparation.');
    return data;
  }
  async save(projectId: string, value: unknown, id?: string): Promise<EnvironmentProfile> {
    const input=validateEnvironment(value);
    const {data,error}=await this.client.rpc('save_dynamic_environment',{p_project_id:projectId,p_input:input,p_id:id??null});
    if(error)throw new DynamicContractError(error.code==='P0002'?404:error.code==='P0001'?409:503,error.code==='P0001'?'Environment state changed. Finish active work and clean its reserved data before changing the resource key.':'Environment could not be saved. Verify project access and migration.');
    return data;
  }
}
