#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { dbCreateCommand } from './commands/db/create';

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
      console.log(chalk.yellow('⚠️  db list command not yet implemented'));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  db get command not yet implemented'));
      console.log(chalk.dim(`Would get database: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  db delete command not yet implemented'));
      console.log(chalk.dim(`Would delete database: ${name} (force: ${options.force})`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  db rename command not yet implemented'));
      console.log(chalk.dim(`Would rename: ${oldName} → ${newName}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  branch create command not yet implemented'));
      console.log(chalk.dim(`Would create branch: ${name}`));
      console.log(chalk.dim(`From: ${options.from || 'main'}`));
      console.log(chalk.dim(`Fast mode: ${options.fast}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  branch list command not yet implemented'));
      console.log(chalk.dim(`Would list branches for: ${database || 'all databases'}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  branch get command not yet implemented'));
      console.log(chalk.dim(`Would get branch: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  branch delete command not yet implemented'));
      console.log(chalk.dim(`Would delete branch: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  branch rename command not yet implemented'));
      console.log(chalk.dim(`Would rename: ${oldName} → ${newName}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  branch sync command not yet implemented'));
      console.log(chalk.dim(`Would sync branch: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  start command not yet implemented'));
      console.log(chalk.dim(`Would start: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  stop command not yet implemented'));
      console.log(chalk.dim(`Would stop: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  restart command not yet implemented'));
      console.log(chalk.dim(`Would restart: ${name}`));
      process.exit(1);
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
      console.log(chalk.yellow('⚠️  status command not yet implemented'));
      process.exit(1);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program.parse();
