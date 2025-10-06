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

  // Check if it's a database or branch
  const database = await state.getDatabase(name);
  const branchResult = await state.getBranch(name);

  if (!database && !branchResult) {
    throw new Error(`Database or branch '${name}' not found`);
  }

  if (database) {
    // Stopping a database
    if (database.status === 'stopped') {
      console.log(chalk.dim(`✓ Database '${name}' is already stopped`));
      return;
    }

    const containerID = await docker.getContainerByName(database.containerName);
    if (!containerID) {
      throw new Error(`Container '${database.containerName}' not found`);
    }

    const spinner = ora('Stopping container').start();
    await docker.stopContainer(containerID);
    spinner.succeed('Container stopped');

    // Update state
    database.status = 'stopped';
    await state.updateDatabase(database);

    console.log();
    console.log(chalk.green.bold(`✓ Database '${name}' stopped successfully!`));
    console.log();
  } else if (branchResult) {
    // Stopping a branch
    const { branch, database: parentDb } = branchResult;

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
    await state.updateBranch(parentDb.id, branch);

    console.log();
    console.log(chalk.green.bold(`✓ Branch '${name}' stopped successfully!`));
    console.log();
  }
}
