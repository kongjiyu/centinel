/** Public synthetic privacy fixture; input stays browser-local and is never submitted. */
import http from 'node:http';
const port = Number(process.env.CENTINEL_PRIVATE_TARGET_PORT ?? 3018);
http.createServer((req, res) => { res.setHeader('Cache-Control', 'no-store'); if (req.url === '/meta') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ fixture: 'centinel-private-v1', publicSyntheticData: true }));
    return;
} res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="en"><head><title>Private reference fixture</title><style>body{font:18px system-ui;padding:32px}input{font:inherit;padding:12px}*:focus{outline:3px solid #16723a}</style></head><body><h1>Ready</h1><label for="name">Private reference</label><input id="name" required autocomplete="off"><p>Keep this reference local. No submit action exists.</p><script>document.querySelector("#name").addEventListener("input",e=>console.log("Synthetic local reference:",e.target.value));</script></body></html>'); }).listen(port, '127.0.0.1', () => console.log('Public private-reference fixture ready on ' + port));
