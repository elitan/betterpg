import chalk from 'chalk';

/**
 * Displays a progress line with timing for async operations.
 *
 * Format: "  ▸ Label                                 1.2s"
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
  const start = Date.now();
  process.stdout.write(chalk.dim(`  ▸ ${label}`));

  try {
    const result = await fn();
    const time = ((Date.now() - start) / 1000).toFixed(1);
    const padding = ' '.repeat(Math.max(0, maxLabelWidth - label.length));
    console.log(chalk.dim(`${padding}${time}s`));
    return result;
  } catch (error) {
    // Print newline after incomplete progress line
    console.log();
    throw error;
  }
}
