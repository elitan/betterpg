#!/usr/bin/env bun

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

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case 'init':
        await initCommand();
        break;

      case 'create':
        if (!args[1]) {
          console.error('❌ Missing database name');
          console.error('Usage: bpg create <name>');
          process.exit(1);
        }
        await createCommand(args[1]);
        break;

      case 'branch':
        if (!args[1] || !args[2]) {
          console.error('❌ Missing arguments');
          console.error('Usage: bpg branch <source> <target>');
          process.exit(1);
        }
        await branchCommand(args[1], args[2]);
        break;

      case 'list':
      case 'ls':
        await listCommand();
        break;

      case 'destroy':
      case 'rm':
        if (!args[1]) {
          console.error('❌ Missing database/branch name');
          console.error('Usage: bpg destroy <name>');
          process.exit(1);
        }
        const force = args.includes('--force') || args.includes('-f');
        await destroyCommand(args[1], { force });
        break;

      case 'start':
        if (!args[1]) {
          console.error('❌ Missing database/branch name');
          console.error('Usage: bpg start <name>');
          process.exit(1);
        }
        await startCommand(args[1]);
        break;

      case 'stop':
        if (!args[1]) {
          console.error('❌ Missing database/branch name');
          console.error('Usage: bpg stop <name>');
          process.exit(1);
        }
        await stopCommand(args[1]);
        break;

      case 'restart':
        if (!args[1]) {
          console.error('❌ Missing database/branch name');
          console.error('Usage: bpg restart <name>');
          process.exit(1);
        }
        await restartCommand(args[1]);
        break;

      case 'reset':
        if (!args[1]) {
          console.error('❌ Missing branch name');
          console.error('Usage: bpg reset <name>');
          process.exit(1);
        }
        await resetCommand(args[1]);
        break;

      case 'status':
        await statusCommand();
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
betterpg - PostgreSQL database branching using ZFS

Usage: bpg <command> [options]

Commands:
  init                    Initialize betterpg system
  create <name>           Create a new PostgreSQL database
  branch <source> <target> Create a branch from existing database
  list, ls                List all databases and branches
  status                  Show detailed status of all instances
  start <name>            Start a stopped database or branch
  stop <name>             Stop a running database or branch
  restart <name>          Restart a database or branch
  reset <name>            Reset a branch to its parent snapshot
  destroy <name>          Destroy a database or branch

Options:
  --force, -f            Force destroy database with branches
  --help, -h             Show this help message

Examples:
  bpg init
  bpg create myapp-prod
  bpg branch myapp-prod myapp-dev
  bpg list
  bpg status
  bpg stop myapp-dev
  bpg start myapp-dev
  bpg restart myapp-dev
  bpg reset myapp-dev
  bpg destroy myapp-dev
  bpg destroy myapp-prod --force

For more information, visit: https://github.com/elitan/betterpg
`);
}

main();
