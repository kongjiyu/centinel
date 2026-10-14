import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
/** Never select a Corepack downloader shim; installs remain an explicit setup step. */
export function installedPackageManager(program:'pnpm'|'yarn'):string {
 const configured=process.env[program==='pnpm'?'CENTINEL_PNPM_BIN':'CENTINEL_YARN_BIN'];const candidates:string[]=[];
 if(configured)candidates.push(configured);
 if(program==='pnpm'&&process.env.npm_execpath&&/pnpm\.(c|m)?js$/.test(process.env.npm_execpath))candidates.push(process.env.npm_execpath);
 try{candidates.push(...execFileSync('/usr/bin/which',['-a',program],{timeout:2000,env:{PATH:process.env.PATH},stdio:['ignore','pipe','ignore']}).toString().trim().split('\n'));}catch{}
 for(const candidate of [...new Set(candidates)]){try{const file=fs.realpathSync(candidate);if(!path.isAbsolute(file)||!fs.statSync(file).isFile())continue;const fd=fs.openSync(file,'r');let text:string;try{const buffer=Buffer.alloc(4096);text=buffer.subarray(0,fs.readSync(fd,buffer,0,4096,0)).toString();}finally{fs.closeSync(fd);}if(/corepack/i.test(text))continue;return file;}catch{}}
 throw new Error('Install the required package manager manually or configure CENTINEL_PNPM_BIN / CENTINEL_YARN_BIN.');
}
