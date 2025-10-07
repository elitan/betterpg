#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { dbCreateCommand } from './commands/db/create';
import { dbListCommand } from './commands/db/list';
import { dbGetCommand } from './commands/db/get';
import { dbDeleteCommand } from './commands/db/delete';
import { dbRenameCommand } from './commands/db/rename';
import { branchCreateCommand } from './commands/branch/create';
import { branchListCommand } from './commands/branch/list';
import { branchGetCommand } from './commands/branch/get';
import { branchDeleteCommand } from './commands/branch/delete';
import { branchSyncCommand } from './commands/branch/sync';
import { branchRenameCommand } from './commands/branch/rename';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('bpg')
  .description('PostgreSQL database branching using ZFS snapshots')
  .version('0.2.0');

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

dbCommand
  .command('rename')
  .description('Rename a database')
  .argument('<old>', 'current database name')
  .argument('<new>', 'new database name')
  .action(async (oldName: string, newName: string) => {
    try {
      await dbRenameCommand(oldName, newName);
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
  .option('--fast', 'use crash-consistent snapshot (faster, dev/test only)')
  .action(async (name: string, options: { from?: string; fast?: boolean }) => {
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
  .command('rename')
  .description('Rename a branch')
  .argument('<old>', 'current branch name: <database>/<branch>')
  .argument('<new>', 'new branch name: <database>/<branch>')
  .action(async (oldName: string, newName: string) => {
    try {
      await branchRenameCommand(oldName, newName);
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
