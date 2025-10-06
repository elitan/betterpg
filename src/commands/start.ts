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

  // Check if it's a database or branch
  const database = await state.getDatabase(name);
  const branchResult = await state.getBranch(name);

  if (!database && !branchResult) {
    throw new Error(`Database or branch '${name}' not found`);
  }

  if (database) {
    // Starting a database
    if (database.status === 'running') {
      console.log(chalk.dim(`✓ Database '${name}' is already running`));
      return;
    }

    const containerID = await docker.getContainerByName(database.containerName);
    if (!containerID) {
      throw new Error(`Container '${database.containerName}' not found`);
    }

    const spinner = ora('Starting PostgreSQL container').start();
    await docker.startContainer(containerID);
    spinner.text = 'Waiting for PostgreSQL to be ready';
    await docker.waitForHealthy(containerID);
    spinner.succeed('PostgreSQL is ready');

    // Update state
    database.status = 'running';
    await state.updateDatabase(database);

    console.log();
    console.log(chalk.green.bold(`✓ Database '${name}' started successfully!`));
    console.log(chalk.dim('   Port:'), chalk.cyan(database.port.toString()));
    console.log();
  } else if (branchResult) {
    // Starting a branch
    const { branch, database: parentDb } = branchResult;

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

    // Update state
    branch.status = 'running';
    await state.updateBranch(parentDb.id, branch);

    console.log();
    console.log(chalk.green.bold(`✓ Branch '${name}' started successfully!`));
    console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
    console.log();
  }
}
