import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

export async function branchDeleteCommand(name: string) {
  const namespace = parseNamespace(name);

  console.log();
  console.log(`Deleting ${chalk.cyan(name)}...`);
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = result;

  // Prevent deleting main branch
  if (branch.isPrimary) {
    throw new Error(`Cannot delete main branch. Use 'pgd project delete ${project.name}' to delete the entire project.`);
  }

  // Get ZFS config from state
  const stateData = state.getState();

  const docker = new DockerManager();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // Stop and remove container
  const stopStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Stop container'));
  const containerID = await docker.getContainerByName(branch.containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }
  const stopTime = ((Date.now() - stopStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Stop container'.length)}${stopTime}s`));

  // Destroy ZFS dataset (use recursive to handle any dependent clones)
  const datasetStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Destroy dataset'));
  const datasetName = `${namespace.project}-${namespace.branch}`; // Consistent <project>-<branch> naming
  // Only destroy dataset if it exists - this handles cases where previous deletion attempts
  // were interrupted or failed partway through, leaving state entries without actual ZFS datasets
  if (await zfs.datasetExists(datasetName)) {
    await zfs.destroyDataset(datasetName, true);
  }
  const datasetTime = ((Date.now() - datasetStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Destroy dataset'.length)}${datasetTime}s`));

  // Clean up snapshots for this branch from state
  const cleanupStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Clean up snapshots'));
  await state.deleteSnapshotsForBranch(branch.name);
  const cleanupTime = ((Date.now() - cleanupStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Clean up snapshots'.length)}${cleanupTime}s`));

  // Remove from state
  await state.deleteBranch(project.id, branch.id);

  console.log();
  console.log('Branch deleted');
  console.log();
}
