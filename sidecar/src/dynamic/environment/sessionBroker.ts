import {chromium,type Browser,type Page} from 'playwright';import crypto from 'node:crypto';
import {createRunNetworkProxy} from '../browser/networkProxy.js';import {DynamicContractError} from '../types.js';import type {EnvironmentProfile} from './types.js';
import type {SessionCaptureRepository} from './captureRepository.js';import {dynamicWorkerId} from '../recovery.js';import {containsLocalValue} from './secrets.js';
import {EnvironmentSessionVault,sessionStateSensitiveValues} from './sessionVault.js';
export type SessionCaptureStatus={captureId:string;state:'opening'|'open'|'closed';reference:string;reason?:string};
type Capture={owner:string;project:string;profile:EnvironmentProfile;status:SessionCaptureStatus;browser?:Browser;page?:Page;proxy?:Awaited<ReturnType<typeof createRunNetworkProxy>>;timer?:ReturnType<typeof setTimeout>;lease?:{repository:SessionCaptureRepository;token:string};heartbeat?:ReturnType<typeof setInterval>;stopping?:Promise<boolean>;policyTimers:Set<ReturnType<typeof setTimeout>>};
/** Manual account sign-in stays in the target browser; no model sees credentials. */
export class EnvironmentSessionBroker{
 private captures=new Map<string,Capture>();
 constructor(private readonly vault:EnvironmentSessionVault,private readonly headless=false){}
 private key(owner:string,project:string,profile:string){return JSON.stringify([owner,project,profile]);}
 status(owner:string,project:string,profile:string){return this.captures.get(this.key(owner,project,profile))?.status??null;}
 async open(owner:string,project:string,profile:EnvironmentProfile,repository:SessionCaptureRepository){
  if(!profile.sessionReference||!profile.sessionReadySelector)throw new DynamicContractError(400,'Save a session reference and signed-in readiness selector first.');
  const key=this.key(owner,project,profile.id);const old=this.captures.get(key);if(old&&old.status.state!=='closed')return old.status;
  if([...this.captures.values()].filter(item=>item.status.state!=='closed').length>=3)throw new DynamicContractError(409,'Close another sign-in browser before opening one.');
  const capture:Capture={owner,project,profile:structuredClone(profile),status:{captureId:crypto.randomUUID(),state:'opening',reference:profile.sessionReference},policyTimers:new Set()};this.captures.set(key,capture);const closed=()=>capture.status.state==='closed';
  try{
   const claimStarted=performance.now();const captureDeadline=claimStarted+300_000;const token=crypto.randomUUID();if(!await repository.acquire(project,profile.id,capture.status.captureId,token,dynamicWorkerId))throw new DynamicContractError(409,'Sign-in lease could not be acquired.');capture.lease={repository,token};if(performance.now()-claimStarted>45_000){await this.stop(capture,'Sign-in lease confirmation took too long. Check cleanup before retrying.');return capture.status;}if(closed()){await repository.finish(project,capture.status.captureId,token,false).catch(()=>{});capture.lease=undefined;return capture.status;}let lastConfirmed=claimStarted;let heartbeatPending=false;capture.heartbeat=setInterval(()=>{if(performance.now()-lastConfirmed>45_000){void this.stop(capture,'Sign-in lease heartbeat expired. Close abandoned windows and check cleanup.');return;}if(heartbeatPending)return;heartbeatPending=true;const heartbeatStarted=performance.now();void repository.heartbeat(project,capture.status.captureId,token).then(alive=>{if(alive)lastConfirmed=heartbeatStarted;if(!alive)void this.stop(capture,'Sign-in lease stopped. Close abandoned browser windows and check cleanup.');}).catch(()=>{void this.stop(capture,'Sign-in lease unavailable. Check cleanup before retrying.');}).finally(()=>{heartbeatPending=false;});},10_000);capture.heartbeat.unref();
   const observed=new Set<string>();let targetStarted=false;
   capture.proxy=await createRunNetworkProxy(profile.allowedOrigins,origin=>{if(!targetStarted)return;const timer=setTimeout(()=>{capture.policyTimers.delete(timer);if(observed.has(origin))void this.stop(capture,'Sign-in browser requested an unapproved origin. Review the environment origins.');},50);capture.policyTimers.add(timer);},()=>{if(targetStarted)void this.stop(capture,'Sign-in target connection or lease unavailable.');},()=>capture.status.state!=='closed'&&performance.now()<captureDeadline&&performance.now()-lastConfirmed<45_000);
   if(closed()){await capture.proxy?.close().catch(()=>{});capture.browser=undefined;capture.page=undefined;capture.proxy=undefined;return capture.status;}
   capture.browser=await chromium.launch({headless:this.headless,proxy:{server:capture.proxy.server},args:['--proxy-bypass-list=<-loopback>','--disable-http2','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
   if(closed()){await capture.browser?.close().catch(()=>{});await capture.proxy?.close().catch(()=>{});capture.browser=undefined;capture.page=undefined;capture.proxy=undefined;return capture.status;}
   capture.page=await capture.browser.newPage({viewport:profile.viewport,serviceWorkers:'block'});const context=capture.page.context();
   const observe=(url:string)=>{try{observed.add(new URL(url.replace(/^ws:/,'http:').replace(/^wss:/,'https:')).origin);}catch{}};context.on('request',request=>observe(request.url()));const watch=(page:Page)=>page.on('websocket',socket=>observe(socket.url()));watch(capture.page);context.on('page',watch);
   capture.browser.on('disconnected',()=>{if(capture.status.state!=='closed')void this.stop(capture,'Sign-in browser closed. Open it again to capture a session.');});
   capture.timer=setTimeout(()=>{void this.stop(capture,'Sign-in capture expired after five minutes. Open it again.');},Math.max(1,captureDeadline-performance.now()));capture.timer.unref();targetStarted=true;
   await capture.page.goto(profile.targetUrl,{waitUntil:'domcontentloaded',timeout:30_000});
   if(!closed())capture.status={...capture.status,state:'open'};return capture.status;
  }catch(error){await this.stop(capture,'Sign-in browser could not open. Check the target and retry.');if(error instanceof DynamicContractError&&!capture.lease)throw error;return capture.status;}
 }
 private async stop(capture:Capture,reason?:string,success=false):Promise<boolean>{
  if(capture.stopping)return capture.stopping;
  capture.status={...capture.status,state:'closed',...(reason?{reason}:{})};if(capture.timer)clearTimeout(capture.timer);if(capture.heartbeat)clearInterval(capture.heartbeat);for(const timer of capture.policyTimers)clearTimeout(timer);capture.policyTimers.clear();
  const stopping=(async()=>{await capture.browser?.close().catch(()=>{});await capture.proxy?.close().catch(()=>{});capture.browser=undefined;capture.page=undefined;capture.proxy=undefined;const lease=capture.lease;capture.lease=undefined;if(!lease)return false;try{const result=await lease.repository.finish(capture.project,capture.status.captureId,lease.token,success);return result?.state==='completed';}catch{return false;}})();capture.stopping=stopping;return stopping;
 }
 async dispose(){await Promise.all([...this.captures.values()].map(capture=>this.stop(capture,'Desktop service closed; check cleanup before reuse.')));}
 async close(owner:string,project:string,profile:string,id:string){const capture=this.captures.get(this.key(owner,project,profile));if(!capture||capture.status.captureId!==id)throw new DynamicContractError(404,'Sign-in capture not found.');await this.stop(capture);return capture.status;}
 async save(owner:string,project:string,profile:EnvironmentProfile,id:string,expiresAt:unknown){
  const capture=this.captures.get(this.key(owner,project,profile.id));if(!capture||capture.status.captureId!==id)throw new DynamicContractError(404,'Sign-in capture not found.');
  if(profile.version!==capture.profile.version||profile.sessionReference!==capture.profile.sessionReference||profile.sessionReadySelector!==capture.profile.sessionReadySelector)throw new DynamicContractError(409,'Environment changed while signing in. Close this capture and open it again.');
  if(capture.status.state!=='open'||!capture.page||capture.page.isClosed())throw new DynamicContractError(409,'Open the sign-in browser and finish signing in first.');
  let ready=false;try{const locator=capture.page.locator(profile.sessionReadySelector!);ready=await locator.count()===1&&await locator.isVisible();}catch{}
  if(!ready)throw new DynamicContractError(409,'Signed-in readiness element is not uniquely visible. Finish signing in or update its selector.');
  const state=await capture.page.context().storageState();if(containsLocalValue(profile,sessionStateSensitiveValues(state)))throw new DynamicContractError(400,'Keep session values out of shared environment fields.');if(!await this.stop(capture,undefined,true))throw new DynamicContractError(409,'Sign-in capture stopped before completion. Check cleanup and capture again.');return this.vault.write(owner,project,profile.id,profile.sessionReference!,state,expiresAt,profile.allowedOrigins);
 }
}
