import { describe, expect, it } from 'vitest';
import { detectRoutes, staticHtmlRoute } from '../../src/dynamic/autonomous/routeDetector.js';

const has = (routes: ReturnType<typeof detectRoutes>, expected: Partial<ReturnType<typeof detectRoutes>[number]>) =>
  expect(routes).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));

describe('autonomous route detector', () => {
  it('finds Express-style server routes but ignores client receivers', () => {
    const routes = detectRoutes([{ path: 'server/app.ts', text: [
      "import express from 'express';",
      'const app = express();',
      "app.get('/api/items', list);",
      "router.post(\"/api/items/:id\", update);",
      "axios.get('/api/remote');",
    ].join('\n') }]);
    has(routes, { method: 'GET', path: '/api/items', kind: 'server', file: 'server/app.ts', line: 3 });
    has(routes, { method: 'POST', path: '/api/items/:id', kind: 'server', line: 4 });
    expect(routes.filter(route => route.kind === 'server' && route.path === '/api/remote')).toEqual([]);
    has(routes, { method: 'GET', path: '/api/remote', kind: 'client_call', line: 5 });
  });

  it('finds raw node:http routes including method-on-previous-line and regex matches', () => {
    const routes = detectRoutes([{ path: 'server.js', text: [
      "if (req.method === 'POST' && url.pathname === '/api/login') {}",
      "if (req.method === 'DELETE')",
      "  if (url.pathname === '/api/session') {}",
      'const orderMatch = url.pathname.match(/^\\/api\\/orders\\/([\\w-]+)$/);',
      "if (req.method === 'GET' && orderMatch) {}",
      "if (req.url === '/health') {}",
    ].join('\n') }]);
    has(routes, { method: 'POST', path: '/api/login', kind: 'server', line: 1 });
    has(routes, { method: 'DELETE', path: '/api/session', line: 3 });
    has(routes, { method: 'GET', path: '/api/orders/:param', line: 4 });
    has(routes, { path: '/health', kind: 'server', line: 6 });
  });

  it('finds fetch, axios and wrapper client calls with nearby methods', () => {
    const routes = detectRoutes([{ path: 'src/client.js', text: [
      "fetch('/api/a');",
      "fetch(`/api/orders/${id}`, {",
      "  method: 'PUT',",
      '});',
      "axios.post('/api/b', body);",
      "await api('/api/login', { method: 'POST' });",
    ].join('\n') }]);
    has(routes, { method: 'GET', path: '/api/a', kind: 'client_call', line: 1 });
    has(routes, { method: 'PUT', path: '/api/orders/:param', line: 2 });
    has(routes, { method: 'POST', path: '/api/b', line: 5 });
    has(routes, { method: 'POST', path: '/api/login', line: 6 });
  });

  it('finds React Router pages from JSX and createBrowserRouter', () => {
    const routes = detectRoutes([
      { path: 'src/App.tsx', text: '<Routes>\n  <Route path="/cart" element={<Cart/>} />\n  <Route path={"orders/:id"} element={<Order/>} />\n</Routes>' },
      { path: 'src/router.tsx', text: "const router = createBrowserRouter([\n  { path: '/', element: <Home/> },\n  { path: 'about', element: <About/> },\n]);" },
    ]);
    has(routes, { path: '/cart', kind: 'page', file: 'src/App.tsx', line: 2 });
    has(routes, { path: '/orders/:id', kind: 'page', line: 3 });
    has(routes, { path: '/', kind: 'page', file: 'src/router.tsx', line: 2 });
    has(routes, { path: '/about', kind: 'page', line: 3 });
  });

  it('maps Next.js app/ and pages/ file routes only in a Next project', () => {
    const files = [
      { path: 'package.json', text: '{"dependencies":{"next":"15.0.0"}}' },
      { path: 'app/page.tsx', text: 'export default function Home() {}' },
      { path: 'app/(shop)/products/[id]/page.tsx', text: 'export default function P() {}' },
      { path: 'app/api/orders/route.ts', text: 'export async function GET() {}\nexport async function POST() {}' },
      { path: 'src/pages/account/index.tsx', text: 'export default function A() {}' },
      { path: 'src/pages/_app.tsx', text: 'export default function App() {}' },
      { path: 'src/pages/api/hello.ts', text: 'export default function handler() {}' },
    ];
    const routes = detectRoutes(files);
    has(routes, { path: '/', kind: 'page', file: 'app/page.tsx' });
    has(routes, { path: '/products/:id', kind: 'page' });
    has(routes, { method: 'GET', path: '/api/orders', kind: 'server', line: 1 });
    has(routes, { method: 'POST', path: '/api/orders', kind: 'server', line: 2 });
    has(routes, { path: '/account', kind: 'page' });
    has(routes, { path: '/api/hello', kind: 'server' });
    expect(routes.some(route => route.file === 'src/pages/_app.tsx')).toBe(false);
    expect(detectRoutes(files.slice(1)).some(route => route.file === 'src/pages/account/index.tsx')).toBe(false);
  });

  it('finds Flask, FastAPI and Django routes', () => {
    const routes = detectRoutes([
      { path: 'app.py', text: "@app.route('/login', methods=['GET', 'POST'])\ndef login(): pass\n@app.route('/users/<int:user_id>')\ndef user(user_id): pass" },
      { path: 'api/main.py', text: "@app.get('/items/{item_id}')\nasync def item(item_id: int): pass\n@router.post(\"/items\")\nasync def create(): pass" },
      { path: 'shop/urls.py', text: "urlpatterns = [\n    path('', views.home),\n    path('orders/<int:pk>/', views.order),\n]" },
    ]);
    has(routes, { method: 'GET', path: '/login', file: 'app.py', line: 1 });
    has(routes, { method: 'POST', path: '/login', file: 'app.py', line: 1 });
    has(routes, { method: 'GET', path: '/users/:user_id', line: 3 });
    has(routes, { method: 'GET', path: '/items/:item_id', file: 'api/main.py' });
    has(routes, { method: 'POST', path: '/items', line: 3 });
    has(routes, { path: '/', file: 'shop/urls.py', line: 2 });
    has(routes, { path: '/orders/:pk/', file: 'shop/urls.py', line: 3 });
  });

  it('treats static HTML files as pages', () => {
    expect(staticHtmlRoute('public/index.html')).toBe('/');
    expect(staticHtmlRoute('index.html')).toBe('/');
    expect(staticHtmlRoute('static/about.html')).toBe('/about.html');
    expect(staticHtmlRoute('src/app.js')).toBeNull();
    has(detectRoutes([{ path: 'public/index.html', text: '<html></html>' }]), { path: '/', kind: 'page', line: 1 });
  });

  it('skips test files', () => {
    expect(detectRoutes([{ path: 'src/__tests__/api.test.ts', text: "app.get('/api/x', h)" }])).toEqual([]);
  });
});
