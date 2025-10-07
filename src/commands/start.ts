import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function startCommand(name: string) {
  console.log();
  console.log(chalk.bold(`▶️  Starting: ${chalk.cyan(name)}`));
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

  const { branch, project } = branchResult;

  if (branch.status === 'running') {
    console.log(chalk.dim(`✓ Branch '${name}' is already running`));
    return;
  }

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  const spinner = ora('Starting PostgreSQL container').start();
  await docker.startContainer(containerID);
  spinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(containerID);
  spinner.succeed('PostgreSQL is ready');

  // Get the actual port (Docker may reassign on restart)
  const actualPort = await docker.getContainerPort(containerID);

  // Update state
  branch.status = 'running';
  branch.port = actualPort;
  await state.updateBranch(project.id, branch);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' started successfully!`));
  console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
  console.log();
}
