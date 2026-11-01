// Sample Shop: a tiny web shop used to demonstrate Centinel.
// It intentionally contains a few bugs for Centinel to find (see README.md).
// No dependencies: run with `node server.js` and open http://localhost:4100.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { findUserByEmail, publicUser } = require('./src/users');
const { listProducts, findProduct } = require('./src/products');
const { createOrder, findOrder } = require('./src/orders');

const PORT = Number(process.env.PORT || 4100);
const PUBLIC_DIR = path.join(__dirname, 'public');
const sessions = new Map(); // session token -> user id

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100_000) reject(new Error('Request body is too large.'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Request body must be JSON.')); }
    });
  });
}

function currentUserId(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sessions.get(token) || null;
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { email, password } = await readJson(req);
    const user = findUserByEmail(String(email || ''));
    if (!user) return sendJson(res, 401, { error: 'No account uses this email.' });
    if (user.password !== String(password || '')) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    return sendJson(res, 200, { token, user: publicUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/products') {
    return sendJson(res, 200, { products: listProducts() });
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const userId = currentUserId(req);
    if (!userId) return sendJson(res, 401, { error: 'Sign in to place an order.' });
    const { items, discountCode } = await readJson(req);
    if (!Array.isArray(items) || items.length === 0) return sendJson(res, 400, { error: 'Add at least one item.' });
    const lines = [];
    for (const item of items) {
      const product = findProduct(item.productId);
      if (!product) return sendJson(res, 400, { error: 'Unknown product.' });
      lines.push({ productId: product.id, name: product.name, price: product.price, quantity: Number(item.quantity) });
    }
    const result = createOrder(userId, lines, discountCode);
    if (result.error) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 201, { order: result.order });
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([\w-]+)$/);
  if (req.method === 'GET' && orderMatch) {
    const userId = currentUserId(req);
    if (!userId) return sendJson(res, 401, { error: 'Sign in to view orders.' });
    const order = findOrder(orderMatch[1]);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    return sendJson(res, 200, { order });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolved = path.join(PUBLIC_DIR, path.normalize(file));
  if (!resolved.startsWith(PUBLIC_DIR) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'Content-Type': (types[path.extname(resolved)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Sample Shop running at http://localhost:${PORT}`);
});
