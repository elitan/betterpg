import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function startCommand(name: string) {
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

  if (branch.status === 'running') {
    console.log();
    console.log(chalk.dim(`Branch '${name}' is already running`));
    console.log();
    return;
  }

  console.log();
  console.log(`Starting ${chalk.cyan(name)}...`);
  console.log();

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  const startTime = Date.now();
  process.stdout.write(chalk.dim('  ▸ Start container'));
  await docker.startContainer(containerID);
  const startDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Start container'.length)}${startDuration}s`));

  const readyTime = Date.now();
  process.stdout.write(chalk.dim('  ▸ PostgreSQL ready'));
  await docker.waitForHealthy(containerID);
  const readyDuration = ((Date.now() - readyTime) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'PostgreSQL ready'.length)}${readyDuration}s`));

  // Get the actual port (Docker may reassign on restart)
  const actualPort = await docker.getContainerPort(containerID);

  // Update state
  branch.status = 'running';
  branch.port = actualPort;
  await state.updateBranch(project.id, branch);

  console.log();
  console.log('Branch started:');
  console.log(`  postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${actualPort}/${project.credentials.database}?sslmode=require`);
  console.log();
}
