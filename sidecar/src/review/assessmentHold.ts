export function isAssessmentHeld(projectId?: string | null): boolean {
  const allowed = process.env.CENTINEL_AI_ASSESSMENT_PROJECT_ALLOWLIST?.split(',').map(id => id.trim()).filter(Boolean);
  return process.env.CENTINEL_AI_ASSESSMENT_PAUSED === '1' || Boolean(allowed?.length && !allowed.includes(projectId ?? ''));
}
