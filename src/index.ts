#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { dbCreateCommand } from './commands/db/create';
import { dbListCommand } from './commands/db/list';
import { dbGetCommand } from './commands/db/get';
import { dbDeleteCommand } from './commands/db/delete';
import { branchCreateCommand } from './commands/branch/create';
import { branchListCommand } from './commands/branch/list';
import { branchGetCommand } from './commands/branch/get';
import { branchDeleteCommand } from './commands/branch/delete';
import { branchSyncCommand } from './commands/branch/sync';
import { walInfoCommand } from './commands/wal/info';
import { walCleanupCommand } from './commands/wal/cleanup';
import { snapshotCreateCommand } from './commands/snapshot/create';
import { snapshotListCommand } from './commands/snapshot/list';
import { snapshotDeleteCommand } from './commands/snapshot/delete';
import { snapshotCleanupCommand } from './commands/snapshot/cleanup';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('bpg')
  .description('PostgreSQL database branching using ZFS snapshots')
  .version('0.3.4');

// ============================================================================
// Database commands
// ============================================================================

const dbCommand = program
  .command('db')
  .alias('database')
  .description('Manage databases (projects)');

dbCommand
  .command('create')
  .description('Create a new database with main branch')
  .argument('<name>', 'database name')
  .action(async (name: string) => {
    try {
      await dbCreateCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

dbCommand
  .command('list')
  .alias('ls')
  .description('List all databases')
  .action(async () => {
    try {
      await dbListCommand();
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

dbCommand
  .command('get')
  .description('Get details about a database')
  .argument('<name>', 'database name')
  .action(async (name: string) => {
    try {
      await dbGetCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

dbCommand
  .command('delete')
  .alias('rm')
  .description('Delete a database and all its branches')
  .argument('<name>', 'database name')
  .option('-f, --force', 'force delete even if branches exist')
  .action(async (name: string, options: { force?: boolean }) => {
    try {
      await dbDeleteCommand(name, options);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Branch commands
// ============================================================================

const branchCommand = program
  .command('branch')
  .alias('br')
  .description('Manage branches within databases');

branchCommand
  .command('create')
  .description('Create a new branch from parent')
  .argument('<name>', 'branch name in format: <database>/<branch>')
  .option('--from <parent>', 'parent branch (defaults to <database>/main)')
  .option('--pitr <time>', 'recover to point in time (e.g., "2025-10-07T14:30:00Z", "2 hours ago")')
  .action(async (name: string, options: { from?: string; pitr?: string }) => {
    try {
      await branchCreateCommand(name, options);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

branchCommand
  .command('list')
  .alias('ls')
  .description('List branches')
  .argument('[database]', 'database name (optional, lists all if not specified)')
  .action(async (database?: string) => {
    try {
      await branchListCommand(database);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

branchCommand
  .command('get')
  .description('Get details about a branch')
  .argument('<name>', 'branch name in format: <database>/<branch>')
  .action(async (name: string) => {
    try {
      await branchGetCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

branchCommand
  .command('delete')
  .alias('rm')
  .description('Delete a branch')
  .argument('<name>', 'branch name in format: <database>/<branch>')
  .action(async (name: string) => {
    try {
      await branchDeleteCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

branchCommand
  .command('sync')
  .description('Sync branch with parent\'s current state')
  .argument('<name>', 'branch name in format: <database>/<branch>')
  .action(async (name: string) => {
    try {
      await branchSyncCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

// ============================================================================
// WAL commands
// ============================================================================

const walCommand = program
  .command('wal')
  .description('Manage WAL archives');

walCommand
  .command('info')
  .description('Show WAL archive status')
  .argument('[branch]', 'branch name in format: <database>/<branch> (optional, shows all if not specified)')
  .action(async (branch?: string) => {
    try {
      await walInfoCommand(branch);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

walCommand
  .command('cleanup')
  .description('Clean up old WAL files')
  .argument('<branch>', 'branch name in format: <database>/<branch>')
  .option('--days <days>', 'retention period in days (default: 7)', '7')
  .option('--dry-run', 'show what would be deleted without actually deleting')
  .action(async (branch: string, options: { days?: string; dryRun?: boolean }) => {
    try {
      await walCleanupCommand(branch, {
        days: options.days ? parseInt(options.days, 10) : 7,
        dryRun: options.dryRun,
      });
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Snapshot commands
// ============================================================================

const snapshotCommand = program
  .command('snapshot')
  .alias('snap')
  .description('Manage snapshots for point-in-time recovery');

snapshotCommand
  .command('create')
  .description('Create a snapshot of a branch')
  .argument('<branch>', 'branch name in format: <database>/<branch>')
  .option('--label <label>', 'optional label for the snapshot')
  .action(async (branch: string, options: { label?: string }) => {
    try {
      await snapshotCreateCommand(branch, options);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

snapshotCommand
  .command('list')
  .alias('ls')
  .description('List snapshots')
  .argument('[branch]', 'branch name in format: <database>/<branch> (optional, lists all if not specified)')
  .action(async (branch?: string) => {
    try {
      await snapshotListCommand(branch);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

snapshotCommand
  .command('delete')
  .alias('rm')
  .description('Delete a snapshot')
  .argument('<snapshot-id>', 'snapshot ID')
  .action(async (snapshotId: string) => {
    try {
      await snapshotDeleteCommand(snapshotId);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

snapshotCommand
  .command('cleanup')
  .description('Clean up old snapshots')
  .argument('[branch]', 'branch name in format: <database>/<branch> (optional with --all)')
  .option('--days <days>', 'retention period in days (default: 30)', '30')
  .option('--dry-run', 'show what would be deleted without actually deleting')
  .option('--all', 'cleanup snapshots across all branches')
  .action(async (branch: string | undefined, options: { days?: string; dryRun?: boolean; all?: boolean }) => {
    try {
      await snapshotCleanupCommand(branch, {
        days: options.days ? parseInt(options.days, 10) : 30,
        dryRun: options.dryRun,
        all: options.all,
      });
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Lifecycle commands
// ============================================================================

program
  .command('start')
  .description('Start a database or branch')
  .argument('<name>', 'name in format: <database>/<branch>')
  .action(async (name: string) => {
    try {
      await startCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop a database or branch')
  .argument('<name>', 'name in format: <database>/<branch>')
  .action(async (name: string) => {
    try {
      await stopCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('restart')
  .description('Restart a database or branch')
  .argument('<name>', 'name in format: <database>/<branch>')
  .action(async (name: string) => {
    try {
      await restartCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

// ============================================================================
// Global commands
// ============================================================================

program
  .command('init')
  .description('Initialize betterpg system with ZFS pool')
  .action(async () => {
    try {
      await initCommand();
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .alias('ls')
  .description('Show status of all databases and branches')
  .action(async () => {
    try {
      await statusCommand();
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program.parse();
