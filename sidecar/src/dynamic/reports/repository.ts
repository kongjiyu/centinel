import type {SupabaseClient} from '@supabase/supabase-js';
import {DynamicContractError} from '../types.js';
import type {DynamicReportSnapshot,DynamicReportSummary} from './types.js';
export interface DynamicReportRepository{capture(project:string,run:string,id:string):Promise<DynamicReportSnapshot>;get(project:string,id:string):Promise<DynamicReportSnapshot>;list(project:string,run:string):Promise<DynamicReportSummary[]>;}
export class SupabaseDynamicReportRepository implements DynamicReportRepository{
 constructor(private readonly client:SupabaseClient){}
 async capture(project:string,run:string,id:string){const {data,error}=await this.client.rpc('capture_dynamic_report',{p_project_id:project,p_run_id:run,p_report_id:id}).abortSignal(AbortSignal.timeout(15000));if(error)throw new DynamicContractError(error.code==='P0001'?409:503,'Report could not be captured. Refresh the stopped Run and check project access.');return data as DynamicReportSnapshot;}
 async get(project:string,id:string){const {data,error}=await this.client.from('dynamic_report_snapshots').select('payload').eq('project_id',project).eq('id',id).abortSignal(AbortSignal.timeout(15000)).maybeSingle();if(error)throw new DynamicContractError(503,'Report storage unavailable.');if(!data)throw new DynamicContractError(404,'Report not available to this project/account.');return data.payload as DynamicReportSnapshot;}
 async list(project:string,run:string){const {data,error}=await this.client.from('dynamic_report_snapshots').select('payload->metadata').eq('project_id',project).eq('run_id',run).order('created_at',{ascending:false}).limit(100).abortSignal(AbortSignal.timeout(15000));if(error)throw new DynamicContractError(503,'Report history unavailable.');return (data??[]).map(row=>row.metadata) as DynamicReportSummary[];}
}
