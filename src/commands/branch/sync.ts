import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { formatTimestamp } from '../../utils/helpers';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

export async function branchSyncCommand(name: string, options: { force?: boolean } = {}) {
  const namespace = parseNamespace(name);

  console.log();
  console.log(chalk.bold(`🔄 Syncing branch with parent: ${chalk.cyan(name)}`));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = result;

  // Prevent syncing main branch
  if (branch.isPrimary) {
    throw new Error(`Cannot sync main branch. Main branch has no parent.`);
  }

  // Find parent branch
  const parentBranch = project.branches.find(b => b.id === branch.parentBranchId);
  if (!parentBranch) {
    throw new Error(`Parent branch not found for '${name}'`);
  }

  // Check for dependent branches (branches that have this branch as parent)
  const dependentBranches = project.branches.filter(b => b.parentBranchId === branch.id);
  if (dependentBranches.length > 0 && !options.force) {
    const dependentNames = dependentBranches.map(b => `  • ${b.name}`).join('\n');
    throw new Error(
      `Cannot sync '${name}' - the following branches depend on it:\n\n` +
      `${dependentNames}\n\n` +
      `Syncing will destroy all dependent branches due to ZFS clone dependencies.\n` +
      `Either delete the dependent branches first, or use --force to proceed anyway.\n\n` +
      `${chalk.yellow('Warning:')} Using --force will permanently delete all dependent branches!`
    );
  }

  console.log(chalk.dim(`Parent: ${parentBranch.name}`));

  if (dependentBranches.length > 0 && options.force) {
    console.log();
    console.log(chalk.yellow.bold('⚠ Warning: Force sync enabled!'));
    console.log(chalk.yellow(`The following dependent branches will be destroyed:`));
    dependentBranches.forEach(b => {
      console.log(chalk.yellow(`  • ${b.name}`));
    });
    console.log();
  }

  console.log();

  // Get ZFS config from state
  const stateData = state.getState();

  const docker = new DockerManager();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // If force sync, clean up dependent branches first
  if (dependentBranches.length > 0 && options.force) {
    let spinner = ora('Cleaning up dependent branches').start();

    for (const depBranch of dependentBranches) {
      // Stop and remove container
      const depContainerID = await docker.getContainerByName(depBranch.containerName);
      if (depContainerID) {
        await docker.stopContainer(depContainerID);
        await docker.removeContainer(depContainerID);
      }

      // Clean up snapshots from state
      await state.deleteSnapshotsForBranch(depBranch.name);

      // Remove branch from state (will be destroyed with ZFS dataset)
      await state.deleteBranch(project.id, depBranch.id);
    }

    spinner.succeed(`Cleaned up ${dependentBranches.length} dependent branch(es)`);
  }

  // Stop and remove existing container
  let spinner = ora('Stopping branch container').start();
  const containerID = await docker.getContainerByName(branch.containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }
  spinner.succeed('Container stopped');

  // Destroy existing ZFS dataset (with -R flag to destroy any remaining clones)
  spinner = ora('Destroying old dataset').start();
  const datasetName = `${namespace.project}-${namespace.branch}`;
  await zfs.destroyDataset(datasetName, true);
  spinner.succeed('Old dataset destroyed');

  // Create new snapshot from parent's current state
  spinner = ora('Creating new snapshot from parent').start();
  const snapshotName = formatTimestamp(new Date());
  const fullSnapshotName = `${parentBranch.zfsDataset}@${snapshotName}`;

  // For application-consistent snapshot (if parent is running)
  if (parentBranch.status === 'running') {
    const parentContainerID = await docker.getContainerByName(parentBranch.containerName);
    if (parentContainerID) {
      try {
        // Use CHECKPOINT instead of pg_backup_start/stop to avoid session issues
        await docker.execSQL(
          parentContainerID,
          "CHECKPOINT;",
          project.credentials.username
        );

        // Create snapshot immediately after checkpoint
        await zfs.createSnapshot(parentBranch.zfsDatasetName, snapshotName);

        spinner.succeed(`Created new snapshot: ${snapshotName}`);
      } catch (error) {
        throw error;
      }
    }
  } else {
    // Crash-consistent if parent is stopped
    await zfs.createSnapshot(parentBranch.zfsDatasetName, snapshotName);
    spinner.succeed(`Created new snapshot: ${snapshotName}`);
  }

  // Clone the new snapshot
  spinner = ora(`Cloning snapshot`).start();
  await zfs.cloneSnapshot(fullSnapshotName, datasetName);
  spinner.succeed(`Cloned snapshot`);

  const mountpoint = await zfs.getMountpoint(datasetName);

  // Create WAL archive directory
  const walArchivePath = `${PATHS.WAL_ARCHIVE}/${datasetName}`;
  await Bun.write(walArchivePath + '/.keep', '');

  // Recreate container with same port (use project's docker image)
  spinner = ora('Recreating container').start();
  const newContainerID = await docker.createContainer({
    name: branch.containerName,
    image: project.dockerImage,
    port: branch.port,
    dataPath: mountpoint,
    walArchivePath,
    password: project.credentials.password,
    username: project.credentials.username,
    database: project.credentials.database,
  });

  await docker.startContainer(newContainerID);
  spinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(newContainerID);
  spinner.succeed('PostgreSQL is ready');

  // Clean up orphaned snapshots for this branch (ZFS snapshots were destroyed with dataset)
  await state.deleteSnapshotsForBranch(branch.name);

  // Update state
  const sizeBytes = await zfs.getUsedSpace(datasetName);
  branch.sizeBytes = sizeBytes;
  branch.status = 'running';
  branch.snapshotName = fullSnapshotName;
  await state.updateBranch(project.id, branch);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' synced with parent!`));
  console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
  console.log();
}
