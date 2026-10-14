import {spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
import {redactOutput} from './redaction.js';
export type ProcessResult={outcome:'passed'|'failed'|'cancelled'|'timeout'|'output_limit'|'runner_error';exitCode:number|null;signal:string|null;output:string;truncated:boolean;durationMs:number};
/** Executes an already authorized argv. No shell, inherited app credentials or installation. */
export async function runBoundedProcess(input:{executable:string;args:string[];cwd:string;home:string;runtimeBinDirectory?:string;variables?:Record<string,string>;timeoutMs:number;maxOutputBytes?:number;signal?:AbortSignal;onOutput?(redacted:string):void}):Promise<ProcessResult>{
 if(process.platform==='win32')throw new Error('Bounded repository execution currently requires Unix process groups.');
 const start=performance.now();const maximum=input.maxOutputBytes??256_000;
 if(!path.isAbsolute(input.cwd)||!path.isAbsolute(input.home)||!Number.isInteger(input.timeoutMs)||input.timeoutMs<10||input.timeoutMs>300_000||maximum<1||maximum>1_000_000)throw new Error('Bounded process configuration required.');
 const variables=input.variables??{};const forbidden=/^(PATH|HOME|SHELL|NODE_OPTIONS|BASH_ENV|ENV|LD_.*|DYLD_.*|NPM_CONFIG_.*|npm_config_.*|COREPACK_.*|GIT_.*)$/;
 if(Object.keys(variables).some(name=>! /^[A-Z][A-Z0-9_]{0,63}$/.test(name)||forbidden.test(name)))throw new Error('Reserved process environment names are not permitted.');
 fs.mkdirSync(input.home,{recursive:true,mode:0o700});
 if(input.signal?.aborted)return {outcome:'cancelled',exitCode:null,signal:null,output:'',truncated:false,durationMs:0};
 return new Promise(resolve=>{
  let reason:ProcessResult['outcome']|undefined;let total=0;const chunks:Buffer[]=[];let ended=false;let outputTruncated=false;
  const child=spawn(input.executable,input.args,{cwd:input.cwd,detached:process.platform!=='win32',shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:[input.runtimeBinDirectory,process.env.PATH].filter(Boolean).join(path.delimiter),HOME:input.home,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG??'en_US.UTF-8',CI:'1',COREPACK_ENABLE_NETWORK:'0',COREPACK_ENABLE_AUTO_PIN:'0',COREPACK_ENABLE_PROJECT_SPEC:'0',npm_config_manage_package_manager_versions:'false',npm_config_offline:'true',...variables}});
  // A separate IPC guardian survives worker death and bounds orphan groups.
  const guardCode='const c=JSON.parse(process.argv[1]);const deadline=performance.now()+c.timeoutMs+1000;const stop=()=>{try{process.kill(-c.groupPid,"SIGKILL")}catch{}process.exit(0)};process.on("disconnect",stop);if(!process.connected)stop();setInterval(()=>{try{process.kill(-c.groupPid,0)}catch{process.exit(0)}if(performance.now()>deadline)stop()},100);';
  const guardian=child.pid?spawn(process.execPath,['-e',guardCode,JSON.stringify({groupPid:child.pid,timeoutMs:input.timeoutMs})],{detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH}}):null;
  guardian?.unref();guardian?.channel?.unref();
  const kill=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}const force=setTimeout(()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},500);force.unref();};
  const abort=()=>{reason='cancelled';kill();};input.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{reason='timeout';kill();},input.timeoutMs);timer.unref();
  let lastOutput=0;
  const collect=(chunk:Buffer)=>{const room=maximum-total;if(room>0){chunks.push(chunk.subarray(0,room));total+=Math.min(chunk.length,room);}if(input.onOutput&&performance.now()-lastOutput>100){lastOutput=performance.now();try{input.onOutput(redactOutput(Buffer.concat(chunks).toString('utf8'),Object.values(variables),true));}catch{reason='runner_error';kill();}}if(chunk.length>room){outputTruncated=true;if(!reason){reason='output_limit';kill();}}};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const finish=(exitCode:number|null,signal:string|null)=>{if(ended)return;ended=true;if(guardian?.connected)guardian.disconnect();clearTimeout(timer);input.signal?.removeEventListener('abort',abort);const truncated=outputTruncated;resolve({outcome:reason??(exitCode===0?'passed':'failed'),exitCode,signal,output:redactOutput(Buffer.concat(chunks).toString('utf8'),Object.values(variables),truncated),truncated,durationMs:Math.round(performance.now()-start)});};
  guardian?.on('error',()=>{if(!ended){reason='runner_error';kill();}});
  child.on('error',()=>{reason='runner_error';finish(null,null);});child.on('close',finish);
  if(input.signal?.aborted)abort();
 });
}
