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
      console.log();
      console.log(chalk.dim('No projects found. Create one with: pgd project create <name>'));
      console.log();
      return;
    }
  }

  console.log();
  if (projectName) {
    console.log(`Branches for ${chalk.cyan(projectName)}:`);
  } else {
    console.log('All branches:');
  }
  console.log();

  // Calculate total branches
  let totalBranches = 0;
  const projectCount = filtered.length;

  for (const proj of filtered) {
    for (const branch of proj.branches) {
      totalBranches++;
      const branchName = branch.name; // Full namespace
      const status = branch.status === 'running' ? 'running' : 'stopped';
      const port = branch.status === 'running' ? branch.port.toString().padEnd(7) : '-'.padEnd(7);
      const size = formatBytes(branch.sizeBytes).padEnd(10);
      const tag = branch.isPrimary ? chalk.dim('(main)') : '';

      console.log(`  ${chalk.cyan(branchName.padEnd(25))} ${status.padEnd(10)} ${port} ${size} ${tag}`);
    }
  }

  console.log();
  if (projectName) {
    console.log(`${totalBranches} ${totalBranches === 1 ? 'branch' : 'branches'}`);
  } else {
    console.log(`${totalBranches} ${totalBranches === 1 ? 'branch' : 'branches'} across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`);
  }
  console.log();
}
