/**
 * Light, deterministic route detector for Autonomous Dynamic Testing.
 *
 * It reads source text only (never executes it) and reports candidate server
 * endpoints, browser pages and client-side API calls with their file/line, so
 * the planner can choose exploration paths and cite where they came from.
 *
 * `review/featurePathAnalysis.ts` `deriveReviewAnalysisMap` was considered for
 * Express routes, but it needs frozen Review artifacts and builds a full
 * TypeScript program; for a pre-launch hint list the regexes below are cheaper
 * and cover more frameworks. Results are hints, not proof that a route exists.
 */
export type DetectedRouteKind = 'server' | 'page' | 'client_call';
export type DetectedRoute = { method?: string; path: string; kind: DetectedRouteKind; file: string; line: number };
export type RouteSourceFile = { path: string; text: string };

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const METHOD_ALT = 'get|post|put|patch|delete|head|options|all';
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/i;
const HTML_EXT = /\.html?$/i;
const MAX_ROUTES = 500;
const MAX_PATH_LENGTH = 300;

const lineAt = (text: string, index: number) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/** Normalize a literal path; template expressions become `:param`. */
function cleanPath(raw: string): string | null {
  let value = raw.trim().replace(/\$\{[^}]*\}/g, ':param');
  if (!value.startsWith('/') || value.length > MAX_PATH_LENGTH || /\s/.test(value)) return null;
  value = value.replace(/[?#].*$/, '') || '/';
  return value;
}

/** `/^\/api\/orders\/([\w-]+)$/` → `/api/orders/:param`. */
function regexLiteralToPath(source: string): string | null {
  let value = source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\/\?$/, '');
  value = value.replace(/\((?:\?<\w+>)?[^()]*\)/g, ':param').replace(/\\\//g, '/');
  if (/[\\[\]()*+?{}|^$]/.test(value)) return null;
  return cleanPath(value);
}

/** `method: 'X'` inside the remaining arguments of the call that starts before `from`. */
function nearbyMethod(text: string, from: number, span = 400): string | undefined {
  let depth = 1;
  let end = from;
  let quote = '';
  for (; end < text.length && end < from + span && depth > 0; end++) {
    const char = text[end];
    if (quote) { if (char === quote && text[end - 1] !== '\\') quote = ''; continue; }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(' || char === '{' || char === '[') depth++;
    else if (char === ')' || char === '}' || char === ']') depth--;
  }
  const match = text.slice(from, end).match(/method\s*:\s*['"`]([A-Za-z]+)['"`]/);
  const method = match?.[1].toUpperCase();
  return method && (HTTP_METHODS as readonly string[]).includes(method) ? method : undefined;
}

function detectExpress(file: RouteSourceFile, out: DetectedRoute[]) {
  // app.get('/x', ...), router.post("/x"), server.route('/x').get(...)
  const re = new RegExp(String.raw`\b(\w+)\s*\.\s*(${METHOD_ALT})\s*\(\s*(['"\`])([^'"\`]+)\3`, 'g');
  for (const match of file.text.matchAll(re)) {
    const receiver = match[1];
    if (/^(?:axios|http|https|api|client|request|fetcher|ky|got|superagent|map|cache|params|searchParams|headers|cookies|storage|localStorage|sessionStorage)$/i.test(receiver)) continue;
    const route = cleanPath(match[4]);
    if (!route) continue;
    const verb = match[2].toUpperCase();
    out.push({ method: verb === 'ALL' ? undefined : verb, path: route, kind: 'server', file: file.path, line: lineAt(file.text, match.index!) });
  }
}

function detectRawHttp(file: RouteSourceFile, out: DetectedRoute[]) {
  const lines = file.text.split('\n');
  const methodOn = (line: string) => line.match(/\b(?:req|request)\.method\s*===?\s*['"]([A-Z]+)['"]/)?.[1];
  lines.forEach((line, index) => {
    const literal = line.match(/\b(?:pathname|(?:req|request)\.url)\s*===?\s*['"`]([^'"`]+)['"`]/);
    if (literal) {
      const route = cleanPath(literal[1]);
      if (!route) return;
      const method = methodOn(line) ?? (index > 0 ? methodOn(lines[index - 1]) : undefined);
      out.push({ ...(method ? { method } : {}), path: route, kind: 'server', file: file.path, line: index + 1 });
      return;
    }
    // const orderMatch = url.pathname.match(/^\/api\/orders\/(\w+)$/); if (req.method === 'GET' && orderMatch)
    const regex = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*[\w.]*pathname\.match\(\s*\/((?:\\\/|[^/\n])+)\/[a-z]*\s*\)/);
    if (regex) {
      const route = regexLiteralToPath(regex[2]);
      if (!route) return;
      let method = methodOn(line);
      for (let next = index + 1; !method && next < Math.min(lines.length, index + 4); next++) {
        if (new RegExp(`\\b${regex[1]}\\b`).test(lines[next])) method = methodOn(lines[next]);
      }
      out.push({ ...(method ? { method } : {}), path: route, kind: 'server', file: file.path, line: index + 1 });
    }
  });
}

function detectClientCalls(file: RouteSourceFile, out: DetectedRoute[]) {
  const text = file.text;
  // fetch('/api/x', { method: 'POST' })
  for (const match of text.matchAll(/\bfetch\s*\(\s*(['"`])([^'"`]+)\1/g)) {
    const route = cleanPath(match[2]);
    if (!route) continue;
    const method = nearbyMethod(text, match.index! + match[0].length) ?? 'GET';
    out.push({ method, path: route, kind: 'client_call', file: file.path, line: lineAt(text, match.index!) });
  }
  // axios.post('/api/x') or axios('/api/x')
  for (const match of text.matchAll(new RegExp(String.raw`\baxios(?:\s*\.\s*(${METHOD_ALT}))?\s*\(\s*(['"\`])([^'"\`]+)\2`, 'g'))) {
    const route = cleanPath(match[3]);
    if (!route) continue;
    const method = match[1]?.toUpperCase() ?? nearbyMethod(text, match.index! + match[0].length) ?? 'GET';
    out.push({ method, path: route, kind: 'client_call', file: file.path, line: lineAt(text, match.index!) });
  }
  // Project wrappers such as api('/api/login', { method: 'POST' }).
  for (const match of text.matchAll(/\b(\w+)\s*\(\s*(['"`])(\/api(?:\/[^'"`]*)?)\2/g)) {
    if (/^(?:fetch|axios|get|post|put|patch|delete|head|options|all|route|use|match|startsWith|endsWith|includes|test|path)$/i.test(match[1])) continue;
    const route = cleanPath(match[3]);
    if (!route) continue;
    const method = nearbyMethod(text, match.index! + match[0].length) ?? 'GET';
    out.push({ method, path: route, kind: 'client_call', file: file.path, line: lineAt(text, match.index!) });
  }
}

function detectReactRouter(file: RouteSourceFile, out: DetectedRoute[]) {
  const text = file.text;
  for (const match of text.matchAll(/<Route\b[^>]*?\bpath\s*=\s*\{?\s*(['"`])([^'"`]+)\1/g)) {
    const raw = match[2];
    const route = cleanPath(raw.startsWith('/') ? raw : `/${raw}`);
    if (route) out.push({ path: route, kind: 'page', file: file.path, line: lineAt(text, match.index!) });
  }
  if (/\bcreate(?:Browser|Hash|Memory)Router\s*\(|\buseRoutes\s*\(/.test(text)) {
    for (const match of text.matchAll(/\bpath\s*:\s*(['"`])([^'"`]*)\1/g)) {
      const raw = match[2];
      if (raw === '*' ) continue;
      const route = cleanPath(raw.startsWith('/') ? raw : `/${raw}`);
      if (route) out.push({ path: route, kind: 'page', file: file.path, line: lineAt(text, match.index!) });
    }
  }
}

function nextSegments(segments: string[]): string | null {
  const parts: string[] = [];
  for (const segment of segments) {
    if (/^\(.*\)$/.test(segment) || segment.startsWith('@')) continue; // route groups / parallel slots
    if (segment.startsWith('_')) return null; // private folders
    const dynamic = segment.match(/^\[(?:\[)?(?:\.\.\.)?(\w+)\]?\]$/);
    parts.push(dynamic ? `:${dynamic[1]}` : segment);
  }
  return `/${parts.join('/')}`;
}

function detectNextFileRoute(file: RouteSourceFile, out: DetectedRoute[]) {
  const appMatch = file.path.match(/^(?:.*?\/)?(?:src\/)?app\/(?:(.*)\/)?(page|route)\.(?:[cm]?[jt]sx?)$/);
  if (appMatch) {
    const route = nextSegments(appMatch[1] ? appMatch[1].split('/') : []);
    if (!route) return;
    if (appMatch[2] === 'page') {
      out.push({ path: route, kind: 'page', file: file.path, line: 1 });
    } else {
      let found = false;
      for (const match of file.text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
        found = true;
        out.push({ method: match[1], path: route, kind: 'server', file: file.path, line: lineAt(file.text, match.index!) });
      }
      if (!found) out.push({ path: route, kind: 'server', file: file.path, line: 1 });
    }
    return;
  }
  const pagesMatch = file.path.match(/^(?:.*?\/)?(?:src\/)?pages\/(.+)\.(?:[cm]?[jt]sx?)$/);
  if (!pagesMatch) return;
  const segments = pagesMatch[1].split('/');
  if (segments[0] !== 'api' && segments.some(segment => /^_(?:app|document|error)$/.test(segment))) return;
  if (segments[segments.length - 1] === 'index') segments.pop();
  const route = nextSegments(segments);
  if (!route) return;
  out.push({ path: route, kind: segments[0] === 'api' ? 'server' : 'page', file: file.path, line: 1 });
}

function detectPython(file: RouteSourceFile, out: DetectedRoute[]) {
  const text = file.text;
  // Flask: @app.route('/x', methods=['GET', 'POST']) / @bp.route
  for (const match of text.matchAll(/@\w+\.route\(\s*['"]([^'"]+)['"]([^)\n]*)\)/g)) {
    const route = cleanPath(match[1].replace(/<(?:\w+:)?(\w+)>/g, ':$1'));
    if (!route) continue;
    const methods = [...(match[2].match(/methods\s*=\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/['"]([A-Za-z]+)['"]/g)].map(item => item[1].toUpperCase());
    const line = lineAt(text, match.index!);
    if (!methods.length) out.push({ method: 'GET', path: route, kind: 'server', file: file.path, line });
    for (const method of methods) out.push({ method, path: route, kind: 'server', file: file.path, line });
  }
  // FastAPI / Flask 2 shortcuts: @app.get('/x'), @router.post("/x")
  for (const match of text.matchAll(/@\w+\.(get|post|put|patch|delete|head|options)\(\s*['"]([^'"]+)['"]/g)) {
    const route = cleanPath(match[2].replace(/\{(\w+)(?::[^}]*)?\}/g, ':$1').replace(/<(?:\w+:)?(\w+)>/g, ':$1'));
    if (route) out.push({ method: match[1].toUpperCase(), path: route, kind: 'server', file: file.path, line: lineAt(text, match.index!) });
  }
  // Django urls.py: path('orders/<int:id>/', view) / re_path
  if (/(^|\/)urls\.py$/.test(file.path)) {
    for (const match of text.matchAll(/\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]/g)) {
      let raw = match[1].replace(/<(?:\w+:)?(\w+)>/g, ':$1').replace(/^\^/, '').replace(/\$$/, '');
      if (/[\\()[\]?*+]/.test(raw)) continue;
      raw = `/${raw}`.replace(/\/{2,}/g, '/');
      const route = cleanPath(raw);
      if (route) out.push({ path: route, kind: 'server', file: file.path, line: lineAt(text, match.index!) });
    }
  }
}

/** `public/index.html` → `/`, `public/about.html` → `/about.html`. */
export function staticHtmlRoute(filePath: string): string | null {
  if (!HTML_EXT.test(filePath)) return null;
  if (/(^|\/)(?:node_modules|test|tests|__tests__|coverage|templates?)\//.test(filePath)) return null;
  const relative = filePath.replace(/^(?:.*?\/)?(?:public|static|www|site|html)\//, '');
  const route = `/${relative}`.replace(/(^|\/)index\.html?$/, '$1');
  return route || '/';
}

function usesNext(files: RouteSourceFile[]): boolean {
  return files.some(file => /(^|\/)package\.json$/.test(file.path) && /"next"\s*:/.test(file.text))
    || files.some(file => /(^|\/)next\.config\.[cm]?[jt]s$/.test(file.path));
}

export function detectRoutes(files: RouteSourceFile[]): DetectedRoute[] {
  const out: DetectedRoute[] = [];
  const next = usesNext(files);
  for (const file of files) {
    if (typeof file?.text !== 'string' || typeof file.path !== 'string') continue;
    if (CODE_EXT.test(file.path)) {
      if (/(^|\/)(?:__tests__|tests?|e2e|cypress)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path)) continue;
      detectExpress(file, out);
      detectRawHttp(file, out);
      detectClientCalls(file, out);
      detectReactRouter(file, out);
      if (next) detectNextFileRoute(file, out);
    } else if (/\.py$/i.test(file.path)) {
      detectPython(file, out);
    } else if (HTML_EXT.test(file.path)) {
      const route = staticHtmlRoute(file.path);
      if (route) out.push({ path: route, kind: 'page', file: file.path, line: 1 });
    }
  }
  const seen = new Set<string>();
  const unique = out.filter(route => {
    const key = [route.kind, route.method ?? '', route.path, route.file, route.line].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((left, right) => left.kind.localeCompare(right.kind) || left.file.localeCompare(right.file) || left.line - right.line);
  return unique.slice(0, MAX_ROUTES);
}
