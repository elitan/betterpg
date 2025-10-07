import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';

export async function branchListCommand(projectName?: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const projects = await state.listProjects();

  // Filter by project if specified
  const filtered = projectName
    ? projects.filter(proj => proj.name === projectName)
    : projects;

  if (filtered.length === 0) {
    if (projectName) {
      throw new Error(`Project '${projectName}' not found`);
    } else {
      console.log(chalk.dim('No projects found. Create one with:'), chalk.cyan('pgd project create <name>'));
      return;
    }
  }

  const table = new Table({
    head: ['Project', 'Branch', 'Type', 'Status', 'Port', 'Size'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });

  for (const proj of filtered) {
    for (const branch of proj.branches) {
      const branchName = branch.name.split('/')[1]; // Get branch name without project prefix
      const type = branch.isPrimary ? chalk.blue('main') : chalk.yellow('branch');
      const status = branch.status === 'running' ? chalk.green('running') : chalk.red('stopped');

      table.push([
        chalk.dim(proj.name),
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
