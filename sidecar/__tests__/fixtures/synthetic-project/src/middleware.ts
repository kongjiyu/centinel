import { validateSession } from './auth';
import { log } from './utils';

// SECURITY ISSUE: innerHTML usage
export function renderUserContent(userId: string, content: string) {
  const element = document.getElementById('user-content');
  if (element) {
    element.innerHTML = content;
  }
}

// SECURITY ISSUE: disabled security headers
export function setupHeaders(res: any) {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', '');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

export function authMiddleware(req: any, res: any, next: () => void) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (validateSession(token)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requestLogger(req: any, res: any, next: () => void) {
  log(`${req.method} ${req.url}`);
  next();
}
