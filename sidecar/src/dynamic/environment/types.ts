export type EnvironmentInput = {
  name: string; targetUrl: string; allowedOrigins: string[];
  viewport: { width: number; height: number }; accountRole: string;
  requiredVariables: string[]; startupInstructions: string; targetVersion: string;
};
export type EnvironmentProfile = EnvironmentInput & { id: string; projectId: string; version: number; updatedBy: string; updatedAt: string };
export type PreflightCheck = { name: string; ready: boolean; reason: string };
export type EnvironmentSnapshot = EnvironmentProfile & { variableNames: string[]; preflight: PreflightCheck[]; checkedAt: string };
