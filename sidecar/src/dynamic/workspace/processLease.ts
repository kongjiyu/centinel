import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export type ProcessLease = {
    file: string;
    nonce: string;
};
/** Device/user-scoped execution exclusion across projects and sidecar processes.
 * A leftover/corrupt lease fails closed; age alone never proves a process stopped. */
export function acquireProcessLease(workspace: string): ProcessLease | null {
    const uid = process.getuid?.();
    if (uid === undefined)
        throw Error('Unix workspace execution identity required');
    const root = path.join('/tmp', 'centinel-workspace-processes-v1-' + uid);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const directoryInfo = fs.lstatSync(root);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || directoryInfo.uid !== uid || (directoryInfo.mode & 0o077) !== 0)
        throw Error('Private workspace execution lease directory required');
    const directory = fs.realpathSync(workspace), file = path.join(root, crypto.createHash('sha256').update(directory).digest('hex') + '.json'), nonce = crypto.randomUUID();
    try {
        fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, nonce, ownerPid: process.pid }), { flag: 'wx', mode: 0o600 });
        return { file, nonce };
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            return null;
        throw error;
    }
}
/** Called only before a guardian exists; afterward the guardian is sole releaser. */
export function releaseUnstartedLease(lease: ProcessLease) { try {
    const value = JSON.parse(fs.readFileSync(lease.file, 'utf8'));
    if (value.nonce === lease.nonce)
        fs.unlinkSync(lease.file);
}
catch { } }
/** Sole lease releaser. Parent waits for acknowledgement, including descendant kill.
 * IPC disconnect also handles SIGKILL of the parent worker. */
export const PROCESS_GUARDIAN = String.raw `
const fs=require('node:fs'),c=JSON.parse(process.argv[1]);
let stopping=false;const deadline=performance.now()+c.timeoutMs+1000;
const alive=()=>{try{process.kill(-c.groupPid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const finish=()=>{try{const v=JSON.parse(fs.readFileSync(c.file,'utf8'));if(v.nonce!==c.nonce)throw Error('Lease identity changed');fs.unlinkSync(c.file);}catch{process.exit(2);return;}
 if(process.connected)process.send({released:c.nonce},()=>process.exit(0));else process.exit(0);};
const stop=()=>{if(stopping)return;stopping=true;try{process.kill(-c.groupPid,'SIGKILL');}catch{}const until=performance.now()+2000;const timer=setInterval(()=>{if(!alive()){clearInterval(timer);finish();}else if(performance.now()>until){clearInterval(timer);process.exit(3);}},25);};
process.on('disconnect',stop);process.on('message',m=>{if(m&&m.stop===c.nonce)stop();});
if(!process.connected)stop();setInterval(()=>{if(!stopping&&(!alive()||performance.now()>deadline))stop();},100);
`;
