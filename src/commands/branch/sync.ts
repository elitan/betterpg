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

  console.log();
  console.log(`Syncing ${chalk.cyan(name)} with ${chalk.cyan(parentBranch.name)}...`);

  if (dependentBranches.length > 0 && options.force) {
    console.log();
    console.log(chalk.yellow('Warning: Force sync enabled!'));
    console.log(chalk.yellow('The following dependent branches will be destroyed:'));
    dependentBranches.forEach(b => {
      console.log(chalk.yellow(`  • ${b.name}`));
    });
  }

  console.log();

  // Get ZFS config from state
  const stateData = state.getState();

  const docker = new DockerManager();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // If force sync, clean up dependent branches first
  if (dependentBranches.length > 0 && options.force) {
    const cleanupStart = Date.now();
    process.stdout.write(chalk.dim('  ▸ Clean up dependent branches'));

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

    const cleanupTime = ((Date.now() - cleanupStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - 'Clean up dependent branches'.length)}${cleanupTime}s`));
  }

  // Stop and remove existing container
  const stopStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Stop container'));
  const containerID = await docker.getContainerByName(branch.containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }
  const stopTime = ((Date.now() - stopStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Stop container'.length)}${stopTime}s`));

  // Checkpoint parent before snapshot
  const datasetName = `${namespace.project}-${namespace.branch}`;
  const snapshotName = formatTimestamp(new Date());
  const fullSnapshotName = `${parentBranch.zfsDataset}@${snapshotName}`;

  if (parentBranch.status === 'running') {
    const parentContainerID = await docker.getContainerByName(parentBranch.containerName);
    if (parentContainerID) {
      try {
        const checkpointStart = Date.now();
        process.stdout.write(chalk.dim(`  ▸ Checkpoint ${parentBranch.name}`));
        await docker.execSQL(
          parentContainerID,
          "CHECKPOINT;",
          project.credentials.username
        );
        const checkpointTime = ((Date.now() - checkpointStart) / 1000).toFixed(1);
        const labelLength = `Checkpoint ${parentBranch.name}`.length;
        console.log(chalk.dim(`${' '.repeat(40 - labelLength)}${checkpointTime}s`));

        // Create snapshot immediately after checkpoint
        const snapshotStart = Date.now();
        process.stdout.write(chalk.dim('  ▸ Create snapshot'));
        await zfs.createSnapshot(parentBranch.zfsDatasetName, snapshotName);
        const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
        console.log(chalk.dim(`${' '.repeat(40 - 'Create snapshot'.length)}${snapshotTime}s`));
      } catch (error) {
        console.log(); // New line after incomplete progress
        throw error;
      }
    }
  } else {
    const snapshotStart = Date.now();
    process.stdout.write(chalk.dim('  ▸ Create snapshot'));
    await zfs.createSnapshot(parentBranch.zfsDatasetName, snapshotName);
    const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - 'Create snapshot'.length)}${snapshotTime}s`));
  }

  // Unmount and destroy existing ZFS dataset (with -R flag to destroy any remaining clones)
  const destroyStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Destroy old dataset'));
  await zfs.unmountDataset(datasetName);
  await zfs.destroyDataset(datasetName, true);
  const destroyTime = ((Date.now() - destroyStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Destroy old dataset'.length)}${destroyTime}s`));

  // Clone the new snapshot
  const cloneStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Clone new snapshot'));
  await zfs.cloneSnapshot(fullSnapshotName, datasetName);
  const cloneTime = ((Date.now() - cloneStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Clone new snapshot'.length)}${cloneTime}s`));

  // Mount the dataset (requires sudo on Linux due to kernel restrictions)
  const mountStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Mount dataset'));
  await zfs.mountDataset(datasetName);
  const mountTime = ((Date.now() - mountStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Mount dataset'.length)}${mountTime}s`));

  const mountpoint = await zfs.getMountpoint(datasetName);

  // Create WAL archive directory
  const walArchivePath = `${PATHS.WAL_ARCHIVE}/${datasetName}`;
  await Bun.write(walArchivePath + '/.keep', '');

  // Recreate container with same port (use project's docker image)
  const containerStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Start container'));
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
  await docker.waitForHealthy(newContainerID);
  const containerTime = ((Date.now() - containerStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Start container'.length)}${containerTime}s`));

  const pgStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ PostgreSQL ready'));
  const pgTime = ((Date.now() - pgStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'PostgreSQL ready'.length)}${pgTime}s`));

  // Clean up orphaned snapshots for this branch (ZFS snapshots were destroyed with dataset)
  await state.deleteSnapshotsForBranch(branch.name);

  // Update state
  const sizeBytes = await zfs.getUsedSpace(datasetName);
  branch.sizeBytes = sizeBytes;
  branch.status = 'running';
  branch.snapshotName = fullSnapshotName;
  await state.updateBranch(project.id, branch);

  console.log();
  console.log('Branch synced:');
  console.log(`  postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${branch.port}/${project.credentials.database}`);
  console.log();
}
