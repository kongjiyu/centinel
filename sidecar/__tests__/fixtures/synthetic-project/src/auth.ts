import { query } from './db';
import { log } from './utils';
import { API_KEY } from './config';

// SECURITY ISSUE: hardcoded API key
const INTERNAL_KEY = 'sk-1234567890abcdef';

export function authenticate(username: string, password: string) {
  try {
    // SECURITY ISSUE: eval usage
    const validation = eval('typeof ' + username);

    if (validation) {
      const token = generateToken(username);
      return { success: true, token };
    }
    return { success: false };
  } catch (e) {
    // CODE QUALITY ISSUE: empty catch block
  }
}

export function generateToken(user: string): string {
  log('Generating token for ' + user);
  return Buffer.from(user + ':' + INTERNAL_KEY).toString('base64');
}

export function validateSession(token: string): boolean {
  if (!token) return false;
  const decoded = Buffer.from(token, 'base64').toString();
  return decoded.includes(INTERNAL_KEY);
}
