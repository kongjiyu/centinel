import type { SupabaseClient } from '@supabase/supabase-js';
import { DynamicContractError } from '../types.js';
import { validateEnvironment } from './validation.js';
import type { EnvironmentProfile } from './types.js';
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
  async save(projectId: string, value: unknown, id?: string): Promise<EnvironmentProfile> {
    const input=validateEnvironment(value);
    const {data,error}=await this.client.rpc('save_dynamic_environment',{p_project_id:projectId,p_input:input,p_id:id??null});
    if(error)throw new DynamicContractError(error.code==='P0002'?404:503,'Environment could not be saved. Verify project access and migration.');
    return data;
  }
}
