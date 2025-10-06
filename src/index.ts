#!/usr/bin/env bun

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { createCommand } from './commands/create';
import { branchCommand } from './commands/branch';
import { listCommand } from './commands/list';
import { destroyCommand } from './commands/destroy';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { resetCommand } from './commands/reset';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('bpg')
  .description('PostgreSQL database branching using ZFS snapshots')
  .version('0.1.0');

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
  .command('create')
  .description('Create a new PostgreSQL database')
  .argument('<name>', 'database name')
  .action(async (name: string) => {
    try {
      await createCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('branch')
  .description('Create a branch from existing database (application-consistent by default)')
  .argument('<source>', 'source database name')
  .argument('<target>', 'target branch name')
  .option('--fast', 'use crash-consistent snapshot (faster, dev/test only)')
  .action(async (source: string, target: string, options: { fast?: boolean }) => {
    try {
      await branchCommand(source, target, { fast: options.fast || false });
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('List all databases and branches')
  .action(async () => {
    try {
      await listCommand();
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show detailed status of all instances')
  .action(async () => {
    try {
      await statusCommand();
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start a stopped database or branch')
  .argument('<name>', 'database/branch name')
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
  .description('Stop a running database or branch')
  .argument('<name>', 'database/branch name')
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
  .argument('<name>', 'database/branch name')
  .action(async (name: string) => {
    try {
      await restartCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('reset')
  .description('Reset a branch to its parent snapshot')
  .argument('<name>', 'branch name')
  .action(async (name: string) => {
    try {
      await resetCommand(name);
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program
  .command('destroy')
  .alias('rm')
  .description('Destroy a database or branch')
  .argument('<name>', 'database/branch name')
  .option('-f, --force', 'force destroy database with branches')
  .action(async (name: string, options: { force?: boolean }) => {
    try {
      await destroyCommand(name, { force: options.force || false });
    } catch (error: any) {
      console.error(chalk.red('✗'), error.message);
      process.exit(1);
    }
  });

program.parse();
