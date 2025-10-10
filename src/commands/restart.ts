import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';
import { getContainerName } from '../utils/naming';
import { parseNamespace } from '../utils/namespace';
import { UserError } from '../errors';
import { withProgress } from '../utils/progress';

export async function restartCommand(name: string) {
  const namespace = parseNamespace(name);

  const state = new StateManager(PATHS.STATE);
  await state.load();

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

  console.log();
  console.log(`Restarting ${chalk.cyan(name)}...`);
  console.log();

  const containerName = getContainerName(namespace.project, namespace.branch);
  const containerID = await docker.getContainerByName(containerName);
  if (!containerID) {
    throw new UserError(`Container '${containerName}' not found`);
  }

  await withProgress('Restart container', async () => {
    await docker.restartContainer(containerID);
  });

  await withProgress('PostgreSQL ready', async () => {
    await docker.waitForHealthy(containerID);
  });

  // Get the actual port (Docker may reassign on restart)
  const actualPort = await docker.getContainerPort(containerID);

  branch.status = 'running';
  branch.port = actualPort;
  await state.updateBranch(project.id, branch);

  console.log();
  console.log('Branch restarted:');
  console.log(`  postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${actualPort}/${project.credentials.database}?sslmode=require`);
  console.log();
}
