import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';
import { UserError } from '../../errors';

export async function projectGetCommand(name: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const project = await state.getProjectByName(name);
  if (!project) {
    throw new UserError(
      `Project '${name}' not found`,
      "Run 'pgd project list' to see available projects"
    );
  }

  console.log();
  console.log(chalk.bold(`Project: ${chalk.cyan(name)}`));
  console.log();

  // Project info
  const infoTable = new Table({
    style: {
      border: ['gray']
    }
  });

  infoTable.push(
    ['ID', project.id],
    ['Name', project.name],
    ['Docker Image', project.dockerImage],
    ['Created', new Date(project.createdAt).toLocaleString()],
    ['Branches', project.branches.length.toString()]
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

  for (const branch of project.branches) {
    const branchName = branch.name.split('/')[1]; // Get branch name without project prefix
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
  console.log(chalk.dim('  Username:'), project.credentials.username);
  console.log(chalk.dim('  Database:'), project.credentials.database);
  console.log();
}
