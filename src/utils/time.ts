/**
 * Parse various time formats for PITR recovery targets
 * Supports:
 * - ISO 8601: "2025-10-07T14:30:00Z" or "2025-10-07 14:30:00"
 * - Relative time: "2 hours ago", "-2h", "1 day ago", "-30m"
 */
export function parseRecoveryTime(input: string): Date {
  // Try ISO 8601 format first
  const isoDate = new Date(input);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try relative time formats
  const relativeMatch = input.match(/^-?(\d+)\s*(h|hour|hours|m|min|mins|minute|minutes|d|day|days)(\s+ago)?$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();

    let milliseconds = 0;
    if (unit.startsWith('h')) {
      milliseconds = amount * 60 * 60 * 1000; // hours
    } else if (unit.startsWith('m')) {
      milliseconds = amount * 60 * 1000; // minutes
    } else if (unit.startsWith('d')) {
      milliseconds = amount * 24 * 60 * 60 * 1000; // days
    }

    return new Date(Date.now() - milliseconds);
  }

  throw new Error(`Invalid time format: ${input}. Use ISO 8601 (e.g., "2025-10-07T14:30:00Z") or relative time (e.g., "2 hours ago", "-2h")`);
}

/**
 * Format a date for display
 */
export function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Format relative time (e.g., "2 hours ago", "30 minutes ago")
 */
export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else {
    return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  }
}
