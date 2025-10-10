import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';
import { getContainerName, getDatasetName } from '../../utils/naming';
import { parseNamespace } from '../../utils/namespace';

export async function projectDeleteCommand(name: string, options: { force?: boolean }) {
  console.log();
  console.log(`Deleting project ${chalk.cyan(name)}...`);
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const project = await state.getProjectByName(name);
  if (!project) {
    throw new Error(`Project '${name}' not found`);
  }

  // Check if project has non-main branches
  const nonMainBranches = project.branches.filter(b => !b.isPrimary);
  if (nonMainBranches.length > 0 && !options.force) {
    console.log(chalk.yellow(`Project '${name}' has ${nonMainBranches.length} branch(es):`));
    for (const branch of nonMainBranches) {
      console.log(chalk.dim(`  - ${branch.name}`));
    }
    console.log();
    console.log(chalk.yellow('Use --force to delete project and all branches'));
    process.exit(1);
  }

  // Get ZFS config from state
  const stateData = state.getState();

  const docker = new DockerManager();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // Delete all branches (in reverse order, main last)
  const branchesToDelete = [...project.branches].reverse();

  for (const branch of branchesToDelete) {
    const namespace = parseNamespace(branch.name);
    const containerName = getContainerName(namespace.project, namespace.branch);
    const spinner = ora(`Removing branch: ${branch.name}`).start();

    // Stop and remove container
    const containerID = await docker.getContainerByName(containerName);
    if (containerID) {
      await docker.stopContainer(containerID);
      await docker.removeContainer(containerID);
    }

    spinner.succeed(`Removed container: ${containerName}`);
  }

  // Destroy ZFS datasets for all branches
  const spinner = ora('Destroying ZFS datasets').start();
  for (const branch of branchesToDelete) {
    const namespace = parseNamespace(branch.name);
    const datasetName = getDatasetName(namespace.project, namespace.branch);
    // Only destroy dataset if it exists - this handles cases where previous deletion attempts
    // were interrupted or failed partway through, leaving state entries without actual ZFS datasets
    if (await zfs.datasetExists(datasetName)) {
      await zfs.unmountDataset(datasetName);
      await zfs.destroyDataset(datasetName, true);
    }
  }
  spinner.succeed('ZFS datasets destroyed');

  // Remove from state
  await state.deleteProject(project.name);

  console.log();
  console.log(chalk.green.bold(`✓ Project '${name}' deleted successfully!`));
  console.log();
}
