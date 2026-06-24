// Clean file - no issues planted
export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}
