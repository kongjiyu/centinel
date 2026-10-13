import type { EnvironmentProfile, EnvironmentSnapshot, PreflightCheck } from './types.js';
/** Read-only preflight: instructions are suggestions and never shell commands. */
export async function checkEnvironment(profile: EnvironmentProfile, variableNames: string[], providerReady: boolean, reach: typeof fetch = fetch): Promise<EnvironmentSnapshot> {
  const checks: PreflightCheck[] = profile.requiredVariables.map(name=>({name,ready:variableNames.includes(name),reason:variableNames.includes(name)?'Value available on this device.':'Enter this value on the executing device.'}));
  checks.push({name:'Model provider',ready:providerReady,reason:providerReady?'Screenshot provider configuration is available.':'Configure and connect a screenshot provider in Settings.'});
  try {
    const response=await reach(profile.targetUrl,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000)});
    const location=response.headers.get('location');
    const allowed=!location||profile.allowedOrigins.includes(new URL(location,profile.targetUrl).origin);
    const ready=allowed&&response.status<500;
    checks.push({name:'Website reachable',ready,reason:!allowed?'Website redirects outside the allowed origins.':ready?'Website responded. Authentication/permissions are checked during the journey.':'Website is unavailable. Follow the documented startup instructions.'});
  } catch { checks.push({name:'Website reachable',ready:false,reason:'Website could not be reached within five seconds. Start it locally or check its address.'}); }
  return {...structuredClone(profile),variableNames:[...variableNames].sort(),preflight:checks,checkedAt:new Date().toISOString()};
}
export const environmentReady = (snapshot: EnvironmentSnapshot) => snapshot.preflight.every(check=>check.ready);
