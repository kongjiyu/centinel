import type {EnvironmentProfile} from '../environment/types.js';
import type {RunState,CheckVerdict} from '../types.js';
import type {ProcessResult} from './process.js';
export type HookKind='setup'|'cleanup';
export type HookOperation={id:string;projectId:string;environmentId:string;kind:HookKind;state:RunState;verdict:CheckVerdict;createdBy:string;createdAt:string;updatedAt:string;idempotencyKey:string;environment:EnvironmentProfile;command:{program:string;script:string;fingerprint:string;authorizationId:string;gitCommit:string|null};result:ProcessResult|null;reason:string|null;cancelRequested?:boolean;lease?:{workerId:string;heartbeatAt:string;expiresAt:string}};
