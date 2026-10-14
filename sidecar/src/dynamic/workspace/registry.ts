import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {encryptSecret,decryptSecret} from '../../tokenVault.js';
import {DynamicContractError} from '../types.js';
export type WorkspaceAuthorization={directory:string;packageManager:'pnpm'|'yarn';runtimeBinDirectory:string;scripts:{setup?:string;cleanup?:string;unit?:string};fingerprint:string;authorizedAt:string;automaticCleanup?:boolean};
export type WorkspaceInspection={directory:string;scriptNames:string[];scriptDefinitions:Record<string,string>;requiredVariables:string[];packageManagerHint:string|null;nodeVersionHint:string|null;fingerprint:string;gitCommit:string|null};
const fail=(message:string):never=>{throw new DynamicContractError(400,message);};
/** realpath containment also rejects symlinks from named metadata into private files. */
export function containedFile(root:string,name:string):string {
 const candidate=path.resolve(root,name);if(!candidate.startsWith(root+path.sep))return fail('Metadata path escapes the authorized workspace.');
 const resolved=fs.realpathSync(candidate);if(!resolved.startsWith(root+path.sep))return fail('Metadata symlink escapes the authorized workspace.');
 if(!fs.statSync(resolved).isFile()||fs.statSync(resolved).size>1_000_000)return fail('Workspace metadata must be a bounded regular file.');return resolved;
}
export function inspectWorkspace(directory:string):WorkspaceInspection {
 if(typeof directory!=='string'||!path.isAbsolute(directory))return fail('Choose an absolute local repository folder.');
 let root:string;let manifest:any;
 try{root=fs.realpathSync(directory);manifest=JSON.parse(fs.readFileSync(containedFile(root,'package.json'),'utf8'));}catch(error){if(error instanceof DynamicContractError)throw error;return fail('The selected folder needs a readable package.json.');}
 const scriptDefinitions=Object.fromEntries(Object.entries(manifest.scripts??{}).filter(([name,command])=>/^[a-zA-Z0-9][\w:.-]{0,100}$/.test(name)&&typeof command==='string'&&command.length<=4000).slice(0,200)) as Record<string,string>;
 const hash=crypto.createHash('sha256');hash.update(fs.readFileSync(containedFile(root,'package.json')));
 for(const name of ['pnpm-lock.yaml','yarn.lock','package-lock.json'])if(fs.existsSync(path.join(root,name)))hash.update(fs.readFileSync(containedFile(root,name)));
 const variables=new Set<string>();for(const name of ['.env.example','.env.template','.env.sample'])if(fs.existsSync(path.join(root,name))){
  const text=fs.readFileSync(containedFile(root,name),'utf8');for(const line of text.split('\n')){const match=line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{0,63})\s*=/);if(match)variables.add(match[1]);}
 }
 let nodeVersionHint:string|null=null;if(fs.existsSync(path.join(root,'.node-version')))nodeVersionHint=fs.readFileSync(containedFile(root,'.node-version'),'utf8').trim().slice(0,80);
 let gitCommit:string|null=null;try{const result=execFileSync('git',['-C',root,'rev-parse','HEAD'],{timeout:2000,stdio:['ignore','pipe','ignore'],env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).toString().trim();if(/^[a-f0-9]{40}$/.test(result))gitCommit=result;}catch{}
 return {directory:root,scriptNames:Object.keys(scriptDefinitions),scriptDefinitions,requiredVariables:[...variables].sort(),packageManagerHint:typeof manifest.packageManager==='string'?manifest.packageManager.slice(0,100):null,nodeVersionHint,fingerprint:hash.digest('hex'),gitCommit};
}
export class WorkspaceRegistry {
 constructor(private readonly root:string){}
 private file(owner:string,project:string,profile:string){return path.join(this.root,crypto.createHash('sha256').update(JSON.stringify([owner,project,profile])).digest('hex')+'.json');}
 read(owner:string,project:string,profile:string):WorkspaceAuthorization|null {
  const file=this.file(owner,project,profile);if(!fs.existsSync(file))return null;
  try{return JSON.parse(decryptSecret(fs.readFileSync(file,'utf8')));}catch{throw new DynamicContractError(503,'Re-authorize the local workspace on this device.');}
 }
 authorize(owner:string,project:string,profile:string,input:unknown):WorkspaceAuthorization {
  if(!input||typeof input!=='object')return fail('Provide a workspace authorization.');const value=input as WorkspaceAuthorization&{allowScripts?:boolean;expectedFingerprint?:string};
  if(value.allowScripts!==true||!['pnpm','yarn'].includes(value.packageManager)||!value.scripts||typeof value.scripts!=='object')return fail('Explicitly enable the selected repository scripts.');
  const inspection=inspectWorkspace(value.directory);if(value.expectedFingerprint!==inspection.fingerprint)return fail('Repository changed after inspection. Inspect it again before authorizing.');const scripts:WorkspaceAuthorization['scripts']={};
  for(const kind of ['setup','cleanup','unit'] as const)if(value.scripts[kind]){if(!inspection.scriptNames.includes(value.scripts[kind]!))return fail('Select a script present in this repository.');scripts[kind]=value.scripts[kind];}
  if(value.automaticCleanup&&!scripts.cleanup)return fail('Select the approved cleanup script before enabling automatic cleanup.');
  if(!Object.keys(scripts).length)return fail('Select at least one setup, cleanup or unit script.');
  let runtimeBinDirectory='';if(value.runtimeBinDirectory){try{runtimeBinDirectory=fs.realpathSync(value.runtimeBinDirectory);const node=path.join(runtimeBinDirectory,process.platform==='win32'?'node.exe':'node');if(!fs.statSync(node).isFile())return fail('Runtime folder must contain Node.');}catch{return fail('Runtime folder must contain Node.');}}
  const authorization={directory:inspection.directory,packageManager:value.packageManager,runtimeBinDirectory,scripts,automaticCleanup:value.automaticCleanup===true,fingerprint:inspection.fingerprint,authorizedAt:new Date().toISOString()};
  fs.mkdirSync(this.root,{recursive:true,mode:0o700});const file=this.file(owner,project,profile);const temp=file+'.'+crypto.randomUUID();fs.writeFileSync(temp,encryptSecret(JSON.stringify(authorization)),{mode:0o600});fs.renameSync(temp,file);return authorization;
 }
 verify(owner:string,project:string,profile:string,kind:keyof WorkspaceAuthorization['scripts']) {
  const authorization=this.read(owner,project,profile);if(!authorization?.scripts[kind])return fail('Authorize this repository script on the executing device first.');
  const inspection=inspectWorkspace(authorization.directory);if(inspection.directory!==authorization.directory||inspection.fingerprint!==authorization.fingerprint)return fail('Repository scripts or dependency lock changed. Inspect and authorize them again.');
  return {authorization,inspection,script:authorization.scripts[kind]!};
 }
}

export function workspaceAuthorizationId(value:WorkspaceAuthorization){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
