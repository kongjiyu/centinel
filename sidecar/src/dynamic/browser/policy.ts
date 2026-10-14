export function allowedBrowserUrl(value:string,origins:readonly string[]):boolean {
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&origins.includes(url.origin);}catch{return false;}
}
