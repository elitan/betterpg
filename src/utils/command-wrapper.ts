import chalk from 'chalk';
import { UserError, SystemError } from '../errors';

/**
 * Wraps command functions with consistent error handling.
 *
 * Handles:
 * - UserError: User-facing errors (exit code 1)
 * - SystemError: System-level errors (exit code 2)
 * - Error: Generic errors (exit code 1)
 *
 * Usage:
 * ```typescript
 * program
 *   .command('create')
 *   .action(wrapCommand(async (name: string) => {
 *     await createCommand(name);
 *   }));
 * ```
 */
export function wrapCommand<T extends any[]>(
  fn: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof UserError) {
        console.error(chalk.red('✗'), error.message);
        if (error.hint) {
          console.error(chalk.dim(`\n${error.hint}`));
        }
        process.exit(1);
      } else if (error instanceof SystemError) {
        console.error(chalk.red('✗'), error.message);
        if (error.hint) {
          console.error(chalk.dim(`\n${error.hint}`));
        }
        process.exit(2);
      } else if (error instanceof Error) {
        console.error(chalk.red('✗'), error.message);
        process.exit(1);
      } else {
        console.error(chalk.red('✗'), 'An unknown error occurred');
        process.exit(1);
      }
    }
  };
}
