import http from 'node:http';import net from 'node:net';import type {Socket} from 'node:net';
import {allowedBrowserUrl} from './policy.js';

/** One browser Run owns this proxy. No credentials, headers or payloads are logged. */
export async function createRunNetworkProxy(origins:readonly string[],onViolation:(origin:string)=>void,onTransportError:()=>void=()=>{}) {
 const allowed=[...new Set(origins)];if(!allowed.length||allowed.some(origin=>{try{const parsed=new URL(origin);return parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol);}catch{return true;}}))throw Error('Explicit valid browser origins required.');
 const blocked=(value:string)=>{let origin='invalid-origin';try{origin=new URL(value).origin;}catch{}onViolation(origin);};
 const sockets=new Set<Socket>();let closing=false;
 const track=(socket:Socket)=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));return socket;};
 const server=http.createServer((request,response)=>{
  const raw=request.url??'';
  if(!allowedBrowserUrl(raw,allowed)||!raw.startsWith('http:')){blocked(raw);response.writeHead(403);response.end('Browser origin policy blocked this request.');return;}
  const target=new URL(raw);const headers={...request.headers};delete headers['proxy-authorization'];delete headers['proxy-connection'];headers.host=target.host;
  const upstream=http.request(target,{method:request.method,headers},result=>{response.writeHead(result.statusCode??502,result.headers);result.pipe(response);});
  upstream.on('socket',track);upstream.setTimeout(10_000,()=>upstream.destroy());upstream.on('error',()=>{if(!closing)onTransportError();if(!response.headersSent)response.writeHead(502);response.end('Target connection unavailable.');});
  request.on('aborted',()=>upstream.destroy());response.on('close',()=>upstream.destroy());request.pipe(upstream);
 });
 server.on('connection',track);
 server.on('connect',(request,client,head)=>{
  let target:URL;let httpOrigin:string;try{target=new URL('https://'+request.url);httpOrigin=new URL('http://'+request.url).origin;if(target.username||target.password||target.pathname!=='/'||target.search||target.hash||(!allowed.includes(target.origin)&&!allowed.includes(httpOrigin)))throw Error();}catch{blocked('https://'+request.url);client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  // Chromium also tunnels plaintext ws:// via CONNECT. Classify the first
  // protocol bytes before opening an upstream socket; do not widen schemes.
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  const timeout=setTimeout(()=>client.destroy(),5000);timeout.unref();
  const begin=(first:Buffer)=>{
   clearTimeout(timeout);client.pause();const tls=first[0]===0x16;
   if(!allowed.includes(tls?target.origin:httpOrigin!)){blocked(tls?target.origin:httpOrigin!);client.destroy();return;}
   if(!tls&&!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(first.toString('ascii',0,16))){blocked(httpOrigin!);client.destroy();return;}
   const upstream=track(net.connect({host:target.hostname.replace(/^\[|\]$/g,''),port:Number(target.port||443)}));upstream.setTimeout(30_000,()=>upstream.destroy());
   upstream.once('connect',()=>{upstream.write(first);upstream.pipe(client);client.pipe(upstream);client.resume();});upstream.on('error',()=>{if(!closing)onTransportError();client.destroy();});client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
  };
  client.once('close',()=>clearTimeout(timeout));if(head.length)begin(head);else client.once('data',begin);
 });
 server.on('upgrade',(request,client,head)=>{
  const raw=(request.url??'').replace(/^ws:/,'http:');
  if(!allowedBrowserUrl(raw,allowed)||!raw.startsWith('http:')){blocked(raw);client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  const target=new URL(raw);const headers:http.OutgoingHttpHeaders={...request.headers,host:target.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
  const upstream=http.request(target,{method:request.method,headers});upstream.on('socket',track);
  upstream.on('upgrade',(result,remote,remoteHead)=>{client.write('HTTP/1.1 '+result.statusCode+' '+result.statusMessage+'\r\n'+Object.entries(result.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');if(remoteHead.length)client.write(remoteHead);if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);client.on('close',()=>remote.destroy());remote.on('close',()=>client.destroy());});
  upstream.on('response',result=>{client.end('HTTP/1.1 '+result.statusCode+' Target rejected upgrade\r\nConnection: close\r\n\r\n');result.resume();});upstream.setTimeout(10_000,()=>upstream.destroy());upstream.on('error',()=>{if(!closing)onTransportError();client.destroy();});client.on('error',()=>upstream.destroy());upstream.end();
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw Error('Run proxy unavailable.');
 return {server:'http://127.0.0.1:'+address.port,async close(){closing=true;for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
