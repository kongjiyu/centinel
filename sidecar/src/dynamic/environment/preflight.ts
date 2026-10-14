import type { EnvironmentProfile, EnvironmentSnapshot, PreflightCheck, EnvironmentData } from './types.js';
/** Read-only preflight: instructions are suggestions and never shell commands. */
export async function checkEnvironment(profile: EnvironmentProfile, variableNames: string[], providerReady: boolean, reach: typeof fetch = fetch, data?: EnvironmentData,session?:{availability:string;reason?:string;captureActive?:boolean;version?:string;expiresAt?:string}): Promise<EnvironmentSnapshot> {
  const checks: PreflightCheck[] = profile.requiredVariables.map(name=>({name,ready:variableNames.includes(name),reason:variableNames.includes(name)?'Value available on this device.':'Enter this value on the executing device.'}));
  if(data)checks.push({name:'Test data',ready:data.state==='ready'&&data.preparedVersion===profile.version,reason:data.state==='cleanup_required'?'Complete and record cleanup before reuse.':['in_use','preparing','cleaning'].includes(data.state)?'A Run or data operation is using this environment.':data.state==='ready'&&data.preparedVersion===profile.version?'Manual preparation recorded for this profile version.':'Prepare test data and record its initial state.'});
  if(profile.sessionReference)checks.push({name:'Signed-in session',ready:session?.availability==='available'&&!session.captureActive,reason:session?.captureActive?'Finish and save or close the sign-in browser before running.':session?.availability==='available'?'Local session available; signed-in readiness is checked before model actions.':session?.reason??'Sign in and capture this session on the executing device.'});
  checks.push({name:'Model provider',ready:providerReady,reason:providerReady?'Screenshot provider configuration is available.':'Configure and connect a screenshot provider in Settings.'});
  try {
    const response=await reach(profile.targetUrl,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000)});
    const location=response.headers.get('location');
    const allowed=!location||profile.allowedOrigins.includes(new URL(location,profile.targetUrl).origin);
    const ready=allowed&&response.status<500;
    checks.push({name:'Website reachable',ready,reason:!allowed?'Website redirects outside the allowed origins.':ready?'Website responded. Authentication/permissions are checked during the journey.':'Website is unavailable. Follow the documented startup instructions.'});
  } catch { checks.push({name:'Website reachable',ready:false,reason:'Website could not be reached within five seconds. Start it locally or check its address.'}); }
  return {...structuredClone(profile),...(profile.sessionReference&&session?.availability==='available'&&session.version&&session.expiresAt?{sessionSnapshot:{reference:profile.sessionReference,version:session.version,expiresAt:session.expiresAt}}:{}),...(data?{preparation:data.preparation}:{}),variableNames:[...variableNames].sort(),preflight:checks,checkedAt:new Date().toISOString()};
}
export const environmentReady = (snapshot: EnvironmentSnapshot) => snapshot.preflight.every(check=>check.ready);
