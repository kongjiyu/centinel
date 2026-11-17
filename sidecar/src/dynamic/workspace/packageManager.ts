import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
/** Never select a Corepack downloader shim; installs remain an explicit setup step. */
export function installedPackageManager(program:'pnpm'|'yarn'|'npm'):string {
 const configured=process.env[program==='pnpm'?'CENTINEL_PNPM_BIN':program==='yarn'?'CENTINEL_YARN_BIN':'CENTINEL_NPM_BIN'];const candidates:string[]=[];
 if(configured)candidates.push(configured);
 if(program==='pnpm'&&process.env.npm_execpath&&/pnpm\.(c|m)?js$/.test(process.env.npm_execpath))candidates.push(process.env.npm_execpath);
 if(process.platform==='win32'){
  const bins=[path.dirname(process.execPath),...(process.env.PATH??'').split(path.delimiter)].filter(dir=>path.isAbsolute(dir));
  const entry=program==='npm'?'npm/bin/npm-cli.js':program==='pnpm'?'pnpm/bin/pnpm.cjs':'yarn/bin/yarn.js';
  for(const directory of bins)candidates.push(path.join(directory,program+'.exe'),path.join(directory,'node_modules',entry));
 }
 else try{candidates.push(...execFileSync('/usr/bin/which',['-a',program],{timeout:2000,env:{PATH:process.env.PATH},stdio:['ignore','pipe','ignore']}).toString().trim().split('\n'));}catch{}
 for(const candidate of [...new Set(candidates)]){try{const file=fs.realpathSync(candidate);if(!path.isAbsolute(file)||!fs.statSync(file).isFile())continue;const fd=fs.openSync(file,'r');let text:string;try{const buffer=Buffer.alloc(4096);text=buffer.subarray(0,fs.readSync(fd,buffer,0,4096,0)).toString();}finally{fs.closeSync(fd);}if(/corepack/i.test(text)||/[/\\]corepack[/\\]/i.test(file))continue;if(process.platform==='win32'&&!/\.(exe|[cm]?js)$/i.test(file))continue;return file;}catch{}}
 throw new Error('Install the required package manager manually or configure CENTINEL_PNPM_BIN / CENTINEL_YARN_BIN / CENTINEL_NPM_BIN.');
}

export function packageManagerCommand(executable: string, args: string[], nativeRuntime = process.execPath) {
  const runtimeBinDirectory = path.dirname(nativeRuntime);
  if (process.platform === 'win32' && /\.[cm]?js$/i.test(executable)) {
    return { executable: nativeRuntime, args: [executable, ...args], runtimeBinDirectory };
  }
  return { executable, args, runtimeBinDirectory };
}
