// SECURITY ISSUE: bearer token hardcoded
export const API_KEY = 'bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIn0.secret';

export const DB_HOST = 'localhost';
export const DB_PORT = 5432;
export const DB_NAME = 'mydb';

export const APP_CONFIG = {
  maxRetries: 3,
  timeout: 5000,
  debug: true,
};
