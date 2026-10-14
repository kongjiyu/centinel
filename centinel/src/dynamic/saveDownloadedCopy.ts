import {save} from '@tauri-apps/api/dialog';import {writeBinaryFile} from '@tauri-apps/api/fs';
/** User-initiated export only; verify bytes before opening the save destination. */
export async function saveDownloadedCopy(file:{id:string;bytes:number;sha256:string;base64:string},canContinue:()=>boolean=()=>true):Promise<'saved'|'requested'|'cancelled'>{
 const bytes=Uint8Array.from(atob(file.base64),character=>character.charCodeAt(0));if(bytes.length>1048576||bytes.length!==file.bytes)throw Error('Downloaded copy exceeds its recorded bounds.');
 const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw Error('Downloaded copy does not match its recorded fingerprint.');
 if(!canContinue())return 'cancelled';
 const filename='centinel-file-'+file.id+'.bin';
 if(typeof (window as unknown as {__TAURI_IPC__?:unknown}).__TAURI_IPC__==='function'){const destination=await save({defaultPath:filename,title:'Save downloaded test file'});if(!destination||!canContinue())return 'cancelled';await writeBinaryFile(destination,bytes);return 'saved';}
 const objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=objectUrl;link.download=filename;link.click();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);return 'requested';
}
