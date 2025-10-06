import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../managers/state';
import { formatBytes } from '../utils/helpers';
import { PATHS } from '../utils/paths';

export async function listCommand() {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const databases = await state.listDatabases();

  if (databases.length === 0) {
    console.log(chalk.dim('No databases found. Create one with:'), chalk.cyan('bpg create <name>'));
    return;
  }

  console.log();
  console.log(chalk.bold('📊 Databases and Branches'));
  console.log();

  for (const db of databases) {
    // Primary database table
    const table = new Table({
      head: ['', 'Name', 'Type', 'Port', 'Size', 'Status', 'Created'],
      style: {
        head: ['cyan'],
        border: ['gray']
      }
    });

    const statusIcon = db.status === 'running' ? chalk.green('●') : chalk.red('●');
    const statusText = db.status === 'running' ? chalk.green('running') : chalk.red('stopped');

    table.push([
      statusIcon,
      chalk.bold(db.name),
      chalk.blue('primary'),
      db.port,
      formatBytes(db.sizeBytes),
      statusText,
      new Date(db.createdAt).toLocaleString()
    ]);

    // Add branches
    if (db.branches.length > 0) {
      for (const branch of db.branches) {
        const branchIcon = branch.status === 'running' ? chalk.green('●') : chalk.red('●');
        const branchStatus = branch.status === 'running' ? chalk.green('running') : chalk.red('stopped');

        table.push([
          branchIcon,
          chalk.dim('  ↳ ') + branch.name,
          chalk.yellow('branch'),
          branch.port,
          formatBytes(branch.sizeBytes),
          branchStatus,
          new Date(branch.createdAt).toLocaleString()
        ]);
      }
    }

    console.log(table.toString());
    console.log();
  }
}
