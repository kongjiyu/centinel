import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, '../demo/index.html');

const PORT = 37702;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(HTML_PATH, 'utf-8'));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE'
    ? `[demo] Port ${PORT} is already occupied. Use pnpm dev to reuse healthy development services, or stop the existing demo server.`
    : `[demo] Could not start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, 'localhost', () => {
  console.log(`[demo] Demo app running at http://localhost:${PORT}`);
});
