import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function restartCommand(name: string) {
  console.log();
  console.log(chalk.bold(`🔄 Restarting: ${chalk.cyan(name)}`));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const docker = new DockerManager();

  // Look up branch by namespaced name
  const branchResult = await state.getBranchByNamespace(name);

  if (!branchResult) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, database } = branchResult;

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  const spinner = ora('Restarting PostgreSQL container').start();
  await docker.restartContainer(containerID);
  spinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(containerID);
  spinner.succeed('PostgreSQL is ready');

  branch.status = 'running';
  await state.updateBranch(database.id, branch);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' restarted successfully!`));
  console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
  console.log();
}
