import { randomBytes } from 'crypto';

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generatePassword(length = 12): string {
  // Use only alphanumeric characters to avoid shell escaping issues
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue; // Should never happen with Buffer
    password += chars[byte % chars.length];
  }

  return password;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}
