import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function restartCommand(name: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const docker = new DockerManager();

  // Look up branch by namespaced name
  const branchResult = await state.getBranchByNamespace(name);

  if (!branchResult) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = branchResult;

  console.log();
  console.log(`Restarting ${chalk.cyan(name)}...`);
  console.log();

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  const restartTime = Date.now();
  process.stdout.write(chalk.dim('  ▸ Stop container'));
  await docker.restartContainer(containerID);
  const restartDuration = ((Date.now() - restartTime) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Stop container'.length)}${restartDuration}s`));

  const readyTime = Date.now();
  process.stdout.write(chalk.dim('  ▸ PostgreSQL ready'));
  await docker.waitForHealthy(containerID);
  const readyDuration = ((Date.now() - readyTime) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'PostgreSQL ready'.length)}${readyDuration}s`));

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
