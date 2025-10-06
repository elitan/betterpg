import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';

export async function branchListCommand(databaseName?: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const databases = await state.listDatabases();

  // Filter by database if specified
  const filtered = databaseName
    ? databases.filter(db => db.name === databaseName)
    : databases;

  if (filtered.length === 0) {
    if (databaseName) {
      throw new Error(`Database '${databaseName}' not found`);
    } else {
      console.log(chalk.dim('No databases found. Create one with:'), chalk.cyan('bpg db create <name>'));
      return;
    }
  }

  const table = new Table({
    head: ['Database', 'Branch', 'Type', 'Status', 'Port', 'Size'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });

  for (const db of filtered) {
    for (const branch of db.branches) {
      const branchName = branch.name.split('/')[1]; // Get branch name without database prefix
      const type = branch.isPrimary ? chalk.blue('main') : chalk.yellow('branch');
      const status = branch.status === 'running' ? chalk.green('running') : chalk.red('stopped');

      table.push([
        chalk.dim(db.name),
        branch.isPrimary ? chalk.bold(branchName) : branchName,
        type,
        status,
        branch.port.toString(),
        formatBytes(branch.sizeBytes)
      ]);
    }
  }

  console.log();
  console.log(table.toString());
  console.log();
}
