import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';

export async function dbGetCommand(name: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const database = await state.getDatabaseByName(name);
  if (!database) {
    throw new Error(`Database '${name}' not found`);
  }

  console.log();
  console.log(chalk.bold(`Database: ${chalk.cyan(name)}`));
  console.log();

  // Database info
  const infoTable = new Table({
    style: {
      border: ['gray']
    }
  });

  infoTable.push(
    ['ID', database.id],
    ['Name', database.name],
    ['Version', `PostgreSQL ${database.postgresVersion}`],
    ['Created', new Date(database.createdAt).toLocaleString()],
    ['Branches', database.branches.length.toString()]
  );

  console.log(infoTable.toString());
  console.log();

  // Branches table
  console.log(chalk.bold('Branches:'));
  console.log();

  const branchTable = new Table({
    head: ['Name', 'Type', 'Status', 'Port', 'Size'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });

  for (const branch of database.branches) {
    const branchName = branch.name.split('/')[1]; // Get branch name without database prefix
    const type = branch.isPrimary ? chalk.blue('main') : chalk.yellow('branch');
    const status = branch.status === 'running' ? chalk.green('running') : chalk.red('stopped');

    branchTable.push([
      branch.isPrimary ? chalk.bold(branchName) : branchName,
      type,
      status,
      branch.port.toString(),
      formatBytes(branch.sizeBytes)
    ]);
  }

  console.log(branchTable.toString());
  console.log();

  // Connection details
  console.log(chalk.bold('Connection:'));
  console.log(chalk.dim('  Username:'), database.credentials.username);
  console.log(chalk.dim('  Database:'), database.credentials.database);
  console.log();
}
