import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ConfigManager } from '../../managers/config';
import { formatTimestamp } from '../../utils/helpers';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

export async function branchSyncCommand(name: string) {
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

  const { branch, database } = result;

  // Prevent syncing main branch
  if (branch.isPrimary) {
    throw new Error(`Cannot sync main branch. Main branch has no parent.`);
  }

  // Find parent branch
  const parentBranch = database.branches.find(b => b.id === branch.parentBranchId);
  if (!parentBranch) {
    throw new Error(`Parent branch not found for '${name}'`);
  }

  console.log(chalk.dim(`Parent: ${parentBranch.name}`));
  console.log();

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const docker = new DockerManager();
  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);

  // Stop and remove existing container
  let spinner = ora('Stopping branch container').start();
  const containerID = await docker.getContainerByName(branch.containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }
  spinner.succeed('Container stopped');

  // Destroy existing ZFS dataset
  spinner = ora('Destroying old dataset').start();
  const datasetName = `${namespace.database}-${namespace.branch}`;
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
        // Start backup mode
        await docker.execSQL(
          parentContainerID,
          "SELECT pg_backup_start('betterpg-sync', false);",
          database.credentials.username
        );

        // Create snapshot
        await zfs.createSnapshot(namespace.database, snapshotName);

        // Stop backup mode
        await docker.execSQL(
          parentContainerID,
          "SELECT pg_backup_stop();",
          database.credentials.username
        );

        spinner.succeed(`Created new snapshot: ${snapshotName}`);
      } catch (error) {
        // Try to clean up
        try {
          await docker.execSQL(parentContainerID, "SELECT pg_backup_stop();", database.credentials.username).catch(() => {});
        } catch {}
        throw error;
      }
    }
  } else {
    // Crash-consistent if parent is stopped
    await zfs.createSnapshot(namespace.database, snapshotName);
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

  // Recreate container with same port
  spinner = ora('Recreating container').start();
  const newContainerID = await docker.createContainer({
    name: branch.containerName,
    version: cfg.postgres.version,
    port: branch.port,
    dataPath: mountpoint,
    walArchivePath,
    password: database.credentials.password,
    username: database.credentials.username,
    database: database.credentials.database,
    sharedBuffers: cfg.postgres.config.shared_buffers,
    maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
  });

  await docker.startContainer(newContainerID);
  spinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(newContainerID);
  spinner.succeed('PostgreSQL is ready');

  // Update state
  const sizeBytes = await zfs.getUsedSpace(datasetName);
  branch.sizeBytes = sizeBytes;
  branch.status = 'running';
  branch.snapshotName = fullSnapshotName;
  await state.updateBranch(database.id, branch);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' synced with parent!`));
  console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
  console.log();
}
