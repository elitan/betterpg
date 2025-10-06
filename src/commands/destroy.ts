import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';
import { PATHS } from '../utils/paths';

export async function destroyCommand(name: string, options: { force?: boolean } = {}) {
  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
  const docker = new DockerManager();

  // Check if it's a database
  const database = await state.getDatabase(name);
  if (database) {
    // Check if it has branches
    if (database.branches.length > 0 && !options.force) {
      console.log();
      console.log(chalk.red.bold(`✗ Database '${name}' has ${database.branches.length} branch(es)`));
      console.log(chalk.dim('  Delete branches first, or use'), chalk.yellow('--force'), chalk.dim('to destroy everything'));
      console.log();
      console.log(chalk.bold('  Branches:'));
      database.branches.forEach(b => console.log(chalk.dim(`    • ${b.name}`)));
      console.log();
      throw new Error('Cannot destroy database with branches');
    }

    console.log();
    console.log(chalk.bold(`🗑️  Destroying database: ${chalk.cyan(name)}`));
    console.log();

    // Destroy all branches first if force is used
    if (database.branches.length > 0 && options.force) {
      console.log(chalk.yellow(`⚠️  Force destroying ${database.branches.length} branch(es)...`));
      for (const branch of database.branches) {
        await destroyBranch(branch.containerName, branch.name, zfs, docker);
        await state.deleteBranch(database.id, branch.id);
      }
    }

    // Stop and remove container
    const spinner = ora('Removing container').start();
    const containerID = await docker.getContainerByName(database.containerName);
    if (containerID) {
      await docker.stopContainer(containerID);
      await docker.removeContainer(containerID);
    }
    spinner.succeed('Container removed');

    // Destroy ZFS dataset
    const destroySpinner = ora('Destroying ZFS dataset').start();
    await zfs.destroyDataset(database.name, true);
    destroySpinner.succeed('Dataset destroyed');

    // Remove from state
    await state.deleteDatabase(database.id);

    console.log();
    console.log(chalk.green.bold(`✓ Database '${name}' destroyed successfully`));
    console.log();
    return;
  }

  // Check if it's a branch
  const branchResult = await state.getBranch(name);
  if (branchResult) {
    console.log();
    console.log(chalk.bold(`🗑️  Destroying branch: ${chalk.cyan(name)}`));
    console.log();

    await destroyBranch(branchResult.branch.containerName, branchResult.branch.name, zfs, docker);
    await state.deleteBranch(branchResult.database.id, branchResult.branch.id);

    console.log();
    console.log(chalk.green.bold(`✓ Branch '${name}' destroyed successfully`));
    console.log();
    return;
  }

  throw new Error(`Database or branch '${name}' not found`);
}

async function destroyBranch(
  containerName: string,
  datasetName: string,
  zfs: ZFSManager,
  docker: DockerManager
) {
  // Stop and remove container
  const spinner = ora('Removing container').start();
  const containerID = await docker.getContainerByName(containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }
  spinner.succeed('Container removed');

  // Destroy ZFS clone
  const destroySpinner = ora('Destroying ZFS dataset').start();
  await zfs.destroyDataset(datasetName, true);
  destroySpinner.succeed('Dataset destroyed');
}
