import chalk from 'chalk';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { WALManager } from '../../managers/wal';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { getContainerName, getDatasetName } from '../../utils/naming';
import { UserError } from '../../errors';
import { withProgress } from '../../utils/progress';
import { CLI_NAME } from '../../config/constants';

export async function branchDeleteCommand(name: string) {
  const namespace = parseNamespace(name);

  console.log();
  console.log(`Deleting ${chalk.bold(name)}...`);
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new UserError(
      `Branch '${name}' not found`,
      `Run '${CLI_NAME} branch list' to see available branches`
    );
  }

  const { branch, project } = result;

  // Prevent deleting main branch
  if (branch.isPrimary) {
    throw new UserError(
      `Cannot delete main branch. Use '${CLI_NAME} project delete ${project.name}' to delete the entire project.`,
      `Main branches can only be deleted by deleting the entire project`
    );
  }

  // Get ZFS config from state
  const stateData = state.getState();

  const docker = new DockerManager();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);
  const wal = new WALManager();

  // Stop and remove container
  const containerName = getContainerName(namespace.project, namespace.branch);
  await withProgress('Stop container', async () => {
    const containerID = await docker.getContainerByName(containerName);
    if (containerID) {
      await docker.stopContainer(containerID);
      await docker.removeContainer(containerID);
    }
  });

  // Destroy ZFS dataset (use recursive to handle any dependent clones)
  const datasetName = getDatasetName(namespace.project, namespace.branch);
  await withProgress('Destroy dataset', async () => {
    // Only destroy dataset if it exists - this handles cases where previous deletion attempts
    // were interrupted or failed partway through, leaving state entries without actual ZFS datasets
    if (await zfs.datasetExists(datasetName)) {
      await zfs.unmountDataset(datasetName);
      await zfs.destroyDataset(datasetName, true);
    }
  });

  // Clean up WAL archive for this branch
  await withProgress('Clean up WAL archive', async () => {
    await wal.deleteArchiveDir(datasetName);
  });

  // Clean up snapshots for this branch from state
  await withProgress('Clean up snapshots', async () => {
    await state.deleteSnapshotsForBranch(branch.name);
  });

  // Remove from state
  await state.deleteBranch(project.id, branch.id);

  console.log();
  console.log(chalk.bold('Branch deleted'));
  console.log();
}
