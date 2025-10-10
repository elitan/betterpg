/**
 * User-facing errors for invalid operations or missing resources.
 * Exit code: 1
 *
 * Examples:
 * - Project not found
 * - Invalid branch name
 * - Resource already exists
 */
export class UserError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * System-level errors for environment or infrastructure issues.
 * Exit code: 2
 *
 * Examples:
 * - ZFS not available
 * - Docker not running
 * - Permission denied
 */
export class SystemError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = 'SystemError';
  }
}
