import {redactOutput} from '../workspace/redaction.js';

/** Provider/evidence text must not retain values or URL credentials/query fragments. */
export function redactObservation(value:string,secrets:readonly string[]):string {
 const redacted=redactOutput(value,[...secrets]);
 return redacted.replace(/https?:\/\/[^\s<>"'`]+/gi,raw=>{
  const punctuation=raw.match(/[),.;]+$/)?.[0]??'';const candidate=punctuation?raw.slice(0,-punctuation.length):raw;
  try{const url=new URL(candidate);url.username='';url.password='';if(url.search)url.search='?[REDACTED]';if(url.hash)url.hash='#[REDACTED]';return url.toString()+punctuation;}catch{return '[REDACTED URL]'+punctuation;}
 });
}
export function redactObservationRecord<T>(value:T,secrets:readonly string[]):T {
 const visit=(item:unknown):unknown=>{
  if(typeof item==='string')return redactObservation(item,secrets);
  if(Array.isArray(item))return item.map(visit);
  if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,entry])=>[redactObservation(key,secrets),visit(entry)]));
  return item;
 };
 return visit(value) as T;
}
