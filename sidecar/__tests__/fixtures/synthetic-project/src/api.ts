import { authenticate } from './auth';
import { API_KEY } from './config';

// SECURITY ISSUE: SQL injection pattern
export function getUser(userId: string) {
  const query = `SELECT * FROM users WHERE id = '${userId}'`;
  return executeQuery(query);
}

// SECURITY ISSUE: Math.random in security context
export function generateSessionId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function handleLogin(req: any) {
  const { username, password } = req.body;
  return authenticate(username, password);
}

function executeQuery(query: string): any[] {
  // Mock database execution
  return [];
}
