/**
 * Direct command execution helpers
 *
 * This approach directly imports and calls command functions instead of spawning CLI subprocesses.
 * Benefits:
 * - 10-20x faster (no subprocess overhead)
 * - Better error messages (stack traces, not exit codes)
 * - Direct state access (no stdout parsing)
 * - More reliable (no subprocess hanging)
 */

// Silence console output during tests
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

let silenced = false;

export function silenceConsole() {
  if (silenced) return;
  silenced = true;
  console.log = () => {};
  console.error = () => {};
}

export function restoreConsole() {
  if (!silenced) return;
  silenced = false;
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
}

// Project commands
export { projectCreateCommand } from '../../src/commands/project/create';
export { projectListCommand } from '../../src/commands/project/list';
export { projectGetCommand } from '../../src/commands/project/get';
export { projectDeleteCommand } from '../../src/commands/project/delete';

// Branch commands
export { branchCreateCommand } from '../../src/commands/branch/create';
export { branchListCommand } from '../../src/commands/branch/list';
export { branchGetCommand } from '../../src/commands/branch/get';
export { branchDeleteCommand } from '../../src/commands/branch/delete';
export { branchResetCommand } from '../../src/commands/branch/reset';

// Snapshot commands
export { snapshotCreateCommand } from '../../src/commands/snapshot/create';
export { snapshotListCommand } from '../../src/commands/snapshot/list';
export { snapshotDeleteCommand } from '../../src/commands/snapshot/delete';
export { snapshotCleanupCommand } from '../../src/commands/snapshot/cleanup';

// WAL commands
export { walInfoCommand } from '../../src/commands/wal/info';
export { walCleanupCommand } from '../../src/commands/wal/cleanup';

// Lifecycle commands
export { startCommand } from '../../src/commands/start';
export { stopCommand } from '../../src/commands/stop';
export { restartCommand } from '../../src/commands/restart';
export { statusCommand } from '../../src/commands/status';
