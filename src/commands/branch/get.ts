import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';
import { parseNamespace } from '../../utils/namespace';

export async function branchGetCommand(name: string) {
  const namespace = parseNamespace(name);

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = result;

  console.log();
  console.log(chalk.bold(`Branch: ${chalk.cyan(name)}`));
  console.log();

  const infoTable = new Table({
    style: {
      border: ['gray']
    }
  });

  infoTable.push(
    ['ID', branch.id],
    ['Name', branch.name],
    ['Project', project.name],
    ['Type', branch.isPrimary ? 'main' : 'branch'],
    ['Status', branch.status === 'running' ? chalk.green('running') : chalk.red('stopped')],
    ['Port', branch.port.toString()],
    ['Size', formatBytes(branch.sizeBytes)],
    ['Created', new Date(branch.createdAt).toLocaleString()],
    ['Parent', branch.parentBranchId ? 'Yes' : 'None (main branch)'],
    ['Snapshot', branch.snapshotName || 'N/A (main branch)']
  );

  console.log(infoTable.toString());
  console.log();

  console.log(chalk.bold('Connection:'));
  console.log(chalk.dim('  Host:    '), 'localhost');
  console.log(chalk.dim('  Port:    '), branch.port);
  console.log(chalk.dim('  Database:'), project.credentials.database);
  console.log(chalk.dim('  Username:'), project.credentials.username);
  console.log(chalk.dim('  Password:'), chalk.yellow(project.credentials.password));
  console.log();
  console.log(chalk.bold('Connection string:'));
  console.log(chalk.dim('  ') + chalk.cyan(`postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${branch.port}/${project.credentials.database}`));
  console.log();
}
