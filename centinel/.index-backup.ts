import { getSupabaseBrowserClient, restoreSupabaseSession } from './src/auth/supabaseAuth';
const status = document.querySelector('#status')!;
const button = document.querySelector<HTMLButtonElement>('#download')!;
const objectPath = '3c66cb23-9805-471d-97e6-719182787d94/_repository-index/open-codebase-index-0.38.1/485b2bc3e561f4d1c0dc34e4ddde509efb8da0b395c89722527e337c0a4f250e.json.gz';
button.onclick=async()=>{
  button.disabled=true;
  try {
    if(!await restoreSupabaseSession())throw Error('Sign in to Centinel first.');
    const client=getSupabaseBrowserClient();if(!client)throw Error('Authenticated client unavailable.');
    const result=await client.storage.from('project-artifacts').download(objectPath);
    if(result.error||!result.data)throw Error('Authenticated shared backup download failed.');
    const bytes=new Uint8Array(await result.data.arrayBuffer());
    if(bytes.length>32*1024*1024)throw Error('Archive exceeds its bound.');
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const sha256=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.slice(i,i+16384));
    const response=await fetch('http://127.0.0.1:37813/event',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'shared-backup-download',data:{objectPath,bytes:bytes.length,sha256,base64:btoa(binary)}})});
    if(!response.ok)throw Error('Local evidence recording failed.');
    status.textContent=`Shared backup downloaded through project access controls.\nBytes: ${bytes.length}\nSHA-256: ${sha256}\nNo provider calls were made.`;
  }catch(cause){status.textContent=cause instanceof Error?cause.message:'Verification failed.';}finally{button.disabled=false;}
};
