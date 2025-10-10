import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';
import { getContainerName } from '../utils/naming';
import { parseNamespace } from '../utils/namespace';
import { UserError } from '../errors';
import { withProgress } from '../utils/progress';

export async function stopCommand(name: string) {
  const namespace = parseNamespace(name);

  // Load state
  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Initialize managers
  const docker = new DockerManager();

  // Look up branch by namespaced name
  const branchResult = await state.getBranchByNamespace(name);

  if (!branchResult) {
    throw new UserError(
      `Branch '${name}' not found`,
      "Run 'pgd branch list' to see available branches"
    );
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

  const containerName = getContainerName(namespace.project, namespace.branch);
  const containerID = await docker.getContainerByName(containerName);
  if (!containerID) {
    throw new UserError(`Container '${containerName}' not found`);
  }

  await withProgress('Stop container', async () => {
    await docker.stopContainer(containerID);
  });

  // Update state
  branch.status = 'stopped';
  await state.updateBranch(project.id, branch);

  console.log();
  console.log('Branch stopped');
  console.log();
}
