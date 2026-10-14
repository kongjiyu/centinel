/** Public, in-memory acceptance target. Never connects to project/production data. */
import http from 'node:http';
const port = Number(process.env.CENTINEL_USABILITY_TARGET_PORT ?? 3017);
let lineage:'defect'|'reordered'|'fixed'='defect';
const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/meta') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ fixture: 'centinel-usability-v1', publicSyntheticData: true }));
        return;
    }
    if(url.pathname==='/fixture'&&req.method==='POST'){let body='';req.on('data',chunk=>{body+=String(chunk);if(body.length>1000)req.destroy();});req.on('end',()=>{try{const mode=JSON.parse(body).mode;if(!['defect','reordered','fixed'].includes(mode))throw Error('Invalid fixture mode');lineage=mode;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:'centinel-usability-v1',mode:lineage,publicSyntheticData:true}));}catch{res.statusCode=400;res.end('Invalid public fixture mode');}});return;}
    let content: string;
    if(url.pathname==='/lineage'){const input=lineage==='fixed'?'<label for="name">Display name</label><input id="name">':'<input id="name" tabindex="-1">';const button='<button id="continue" type="button">Continue</button>';content='<h1>Ready</h1>'+(lineage==='reordered'?button+input:input+button);}
    else if (url.pathname === '/normal' || url.pathname === '/defect')
        content = '<h1>Ready</h1>' + (url.pathname === '/normal' ? '<label for="name">Display name</label><input id="name">' : '<input id="name" tabindex="-1">') + '<button id="continue" type="button">Continue</button>';
    else if (url.pathname === '/recovery')
        content = '<h1>Recovery test</h1><button id="trigger" type="button" onclick="location.href=\'/error\'">Trigger error</button>';
    else if (url.pathname === '/error')
        content = '<h1>Something failed</h1><p>Retry to recover this synthetic operation.</p><button id="retry" type="button" onclick="location.href=\'/recovered\'">Retry</button>';
    else if (url.pathname === '/recovered')
        content = '<h1>Recovered</h1><p>Operation recovered successfully.</p><button type="button">Continue</button>';
    else {
        res.statusCode = 404;
        res.end('Unknown public fixture');
        return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('<!doctype html><html lang="en"><head><title>Public usability fixture</title><style>body{font:18px system-ui;padding:32px}input,button{font:inherit;margin:12px;padding:12px}*:focus{outline:3px solid #16723a;outline-offset:3px}</style></head><body>' + content + '</body></html>');
});
server.listen(port, '127.0.0.1', () => console.log('Public usability fixture ready on ' + port));
