export type EnvironmentInput = {
  sessionReference?:string;sessionReadySelector?:string;
  name: string; targetUrl: string; allowedOrigins: string[];
  viewport: { width: number; height: number }; accountRole: string;
  requiredVariables: string[]; startupInstructions: string; targetVersion: string;
};
export type EnvironmentProfile = EnvironmentInput & { id: string; projectId: string; version: number; updatedBy: string; updatedAt: string };
export type PreflightCheck = { name: string; ready: boolean; reason: string };
export type EnvironmentSnapshot = EnvironmentProfile & { variableNames: string[]; preflight: PreflightCheck[]; checkedAt: string;sessionSnapshot?:{reference:string;version:string;expiresAt:string}; preparation?: EnvironmentData['preparation'] };
export type DataEvent = {id:string;runId:string|null;kind:'preparation'|'cleanup';outcome:'completed'|'failed';note:string;actorId:string;createdAt:string};
export type EnvironmentData = {profileId:string;state:'unprepared'|'ready'|'in_use'|'cleanup_required'|'preparing'|'cleaning';operationId?:string|null;preparedVersion:number|null;preparation:{note:string;actorId:string;at:string;profileVersion:number}|null;runId:string|null;events:DataEvent[]};
