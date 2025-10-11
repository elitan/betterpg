import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';
import { getContainerName } from '../utils/naming';
import { parseNamespace } from '../utils/namespace';
import { UserError } from '../errors';
import { withProgress } from '../utils/progress';

export async function startCommand(name: string) {
  // Parse namespace
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

  if (branch.status === 'running') {
    console.log();
    console.log(chalk.dim(`Branch '${name}' is already running`));
    console.log();
    return;
  }

  console.log();
  console.log(`Starting ${chalk.bold(name)}...`);
  console.log();

  const containerName = getContainerName(namespace.project, namespace.branch);
  const containerID = await docker.getContainerByName(containerName);
  if (!containerID) {
    throw new UserError(`Container '${containerName}' not found`);
  }

  await withProgress('Start container', async () => {
    await docker.startContainer(containerID);
  });

  await withProgress('PostgreSQL ready', async () => {
    await docker.waitForHealthy(containerID);
  });

  // Get the actual port (Docker may reassign on restart)
  const actualPort = await docker.getContainerPort(containerID);

  // Update state
  branch.status = 'running';
  branch.port = actualPort;
  await state.updateBranch(project.id, branch);

  console.log();
  console.log(chalk.bold('Branch started'));
  console.log();
  console.log(chalk.bold('Connection ready:'));
  console.log(`  postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${actualPort}/${project.credentials.database}?sslmode=require`);
  console.log();
}
