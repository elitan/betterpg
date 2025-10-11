import chalk from 'chalk';
import ora from 'ora';

/**
 * Displays a spinner while running, then shows a checkmark and timing when complete.
 *
 * Format while running: "  ⠋ Label..."
 * Format when done:     "  ✔ Label                                 1.2s"
 *
 * Usage:
 * ```typescript
 * await withProgress('Create dataset', async () => {
 *   await zfs.createDataset(name);
 * });
 *
 * // With return value
 * const mountpoint = await withProgress('Mount dataset', async () => {
 *   await zfs.mountDataset(name);
 *   return await zfs.getMountpoint(name);
 * });
 * ```
 *
 * @param label - The operation label to display
 * @param fn - The async function to execute
 * @param maxLabelWidth - Maximum width for label (default: 40)
 * @returns The result of the async function
 */
export async function withProgress<T>(
  label: string,
  fn: () => Promise<T>,
  maxLabelWidth = 40
): Promise<T> {
  const spinner = ora({
    text: label,
    prefixText: ' ',
    color: 'white',
  }).start();

  const start = Date.now();

  try {
    const result = await fn();
    const time = ((Date.now() - start) / 1000).toFixed(1);
    const padding = ' '.repeat(Math.max(0, maxLabelWidth - label.length));
    spinner.stopAndPersist({
      symbol: chalk.dim('✔'),
      text: chalk.dim(`${label}${padding}${time + 's'}`),
    });
    return result;
  } catch (error) {
    spinner.stopAndPersist({
      symbol: chalk.dim('✖'),
      text: chalk.dim(label),
    });
    throw error;
  }
}
