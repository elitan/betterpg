import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function stopCommand(name: string) {
  console.log();
  console.log(chalk.bold(`⏸️  Stopping: ${chalk.cyan(name)}`));
  console.log();

  // Load state
  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Initialize managers
  const docker = new DockerManager();

  // Look up branch by namespaced name
  const branchResult = await state.getBranchByNamespace(name);

  if (!branchResult) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, database } = branchResult;

  if (branch.status === 'stopped') {
    console.log(chalk.dim(`✓ Branch '${name}' is already stopped`));
    return;
  }

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  const spinner = ora('Stopping container').start();
  await docker.stopContainer(containerID);
  spinner.succeed('Container stopped');

  // Update state
  branch.status = 'stopped';
  await state.updateBranch(database.id, branch);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' stopped successfully!`));
  console.log();
}
