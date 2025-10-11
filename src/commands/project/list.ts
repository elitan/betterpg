import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';

export async function projectListCommand() {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const projects = await state.listProjects();

  if (projects.length === 0) {
    console.log(chalk.dim('No projects found. Create one with: pgd project create <name>'));
    return;
  }

  const table = new Table({
    head: ['Name', 'Branches', 'Running', 'Image', 'Created'],
    style: {
      head: [],
      border: ['gray']
    }
  });

  for (const proj of projects) {
    const totalBranches = proj.branches.length;
    const runningBranches = proj.branches.filter(b => b.status === 'running').length;

    table.push([
      chalk.bold(proj.name),
      totalBranches.toString(),
      `${runningBranches}/${totalBranches}`,
      chalk.dim(proj.dockerImage),
      new Date(proj.createdAt).toLocaleString()
    ]);
  }

  console.log();
  console.log(table.toString());
  console.log();
}
