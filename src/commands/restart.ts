import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { PATHS } from '../utils/paths';



export async function restartCommand(name: string) {
  console.log();
  console.log(chalk.bold(`🔄 Restarting: ${chalk.cyan(name)}`));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const docker = new DockerManager();

  const database = await state.getDatabase(name);
  const branchResult = await state.getBranch(name);

  if (!database && !branchResult) {
    throw new Error(`Database or branch '${name}' not found`);
  }

  if (database) {
    const containerID = await docker.getContainerByName(database.containerName);
    if (!containerID) {
      throw new Error(`Container '${database.containerName}' not found`);
    }

    const spinner = ora('Restarting PostgreSQL container').start();
    await docker.restartContainer(containerID);
    spinner.text = 'Waiting for PostgreSQL to be ready';
    await docker.waitForHealthy(containerID);
    spinner.succeed('PostgreSQL is ready');

    database.status = 'running';
    await state.updateDatabase(database);

    console.log();
    console.log(chalk.green.bold(`✓ Database '${name}' restarted successfully!`));
    console.log(chalk.dim('   Port:'), chalk.cyan(database.port.toString()));
    console.log();
  } else if (branchResult) {
    const { branch, database: parentDb } = branchResult;

    const containerID = await docker.getContainerByName(branch.containerName);
    if (!containerID) {
      throw new Error(`Container '${branch.containerName}' not found`);
    }

    const spinner = ora('Restarting PostgreSQL container').start();
    await docker.restartContainer(containerID);
    spinner.text = 'Waiting for PostgreSQL to be ready';
    await docker.waitForHealthy(containerID);
    spinner.succeed('PostgreSQL is ready');

    branch.status = 'running';
    await state.updateBranch(parentDb.id, branch);

    console.log();
    console.log(chalk.green.bold(`✓ Branch '${name}' restarted successfully!`));
    console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
    console.log();
  }
}
