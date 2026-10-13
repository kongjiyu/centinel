export function redactOutput(value:string,secrets:string[],truncated=false):string {
 let text=(truncated?value.replace(/\uFFFD+$/,''):value).replace(/\u001b\[[0-9;]*[a-zA-Z]/g,'');
 const variants=[...new Set(secrets.filter(Boolean).flatMap(secret=>[secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret)]))];
 for(const secret of variants.sort((a,b)=>b.length-a.length)){
  text=text.split(secret).join('[REDACTED]');
  if(truncated)for(let size=Math.min(secret.length-1,text.length);size>0;size--){if(text.endsWith(secret.slice(0,size))){text=text.slice(0,-size)+'[REDACTED]';break;}}
 }
 return text;
}
