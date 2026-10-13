// Public DTOs shared with the sidecar; type-only imports never bundle runtime code.
export type { CheckDefinition, CheckResult, CheckVerdict, DynamicRun, Mission, MissionInput, MissionRevision } from '../../../sidecar/src/dynamic/types';

export type { EnvironmentInput, EnvironmentProfile, EnvironmentSnapshot, EnvironmentData } from '../../../sidecar/src/dynamic/environment/types';
