import { formatDate } from './utils';

// SECURITY ISSUE: hardcoded connection string
const CONNECTION_STRING = 'postgresql://admin:password123@localhost:5432/mydb';

export function connect() {
  return { connected: true, url: CONNECTION_STRING };
}

export function query(sql: string, params?: any[]) {
  // Mock query execution
  return [];
}

export function insert(table: string, data: Record<string, any>) {
  const timestamp = formatDate(new Date());
  return { ...data, created_at: timestamp };
}
