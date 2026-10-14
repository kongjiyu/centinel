import {save} from '@tauri-apps/api/dialog';
import {writeBinaryFile} from '@tauri-apps/api/fs';
export async function saveDynamicReport(file:{bytes:Uint8Array;sha256:string;filename:string;mimeType:string},canContinue:()=>boolean=()=>true):Promise<'saved'|'requested'|'cancelled'>{
 if(file.bytes.length>8*1024*1024||!/^centinel-dynamic-[a-f0-9-]+\.(json|md|pdf)$/.test(file.filename))throw Error('Report export exceeds its bounds or filename contract.');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',file.bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw Error('Report checksum verification failed.');if(!canContinue())return 'cancelled';
 if(typeof (window as unknown as {__TAURI_IPC__?:unknown}).__TAURI_IPC__==='function'){const destination=await save({defaultPath:file.filename,title:'Save Dynamic report'});if(!destination||!canContinue())return 'cancelled';await writeBinaryFile(destination,file.bytes);return 'saved';}
 const url=URL.createObjectURL(new Blob([file.bytes],{type:file.mimeType}));const link=document.createElement('a');link.href=url;link.download=file.filename;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);return 'requested';
}
