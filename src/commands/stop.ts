import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function stopCommand(name: string) {
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

  const { branch, project } = branchResult;

  if (branch.status === 'stopped') {
    console.log();
    console.log(chalk.dim(`Branch '${name}' is already stopped`));
    console.log();
    return;
  }

  console.log();
  console.log(`Stopping ${chalk.cyan(name)}...`);
  console.log();

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  const stopTime = Date.now();
  process.stdout.write(chalk.dim('  ▸ Stop container'));
  await docker.stopContainer(containerID);
  const stopDuration = ((Date.now() - stopTime) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Stop container'.length)}${stopDuration}s`));

  // Update state
  branch.status = 'stopped';
  await state.updateBranch(project.id, branch);

  console.log();
  console.log('Branch stopped');
  console.log();
}
