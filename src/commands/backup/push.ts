import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { BackupManager } from '../../managers/backup';
import { DockerManager } from '../../managers/docker';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { formatTimestamp, formatBytes } from '../../utils/helpers';
import { UserError } from '../../errors';
import { withProgress } from '../../utils/progress';
import { getContainerName, getDatasetName, getDatasetPath } from '../../utils/naming';
import { CLI_NAME } from '../../config/constants';

export interface BackupPushOptions {
  snapshotOnly?: boolean;  // Only backup ZFS snapshot, skip WAL
  walOnly?: boolean;       // Only backup WAL files, skip snapshot
}

export async function backupPushCommand(branchName: string, options: BackupPushOptions = {}) {
  const target = parseNamespace(branchName);

  console.log();
  if (options.snapshotOnly) {
    console.log(`Backing up snapshot of ${chalk.bold(target.full)} (snapshot only)...`);
  } else if (options.walOnly) {
    console.log(`Backing up WAL files for ${chalk.bold(target.full)} (WAL only)...`);
  } else {
    console.log(`Backing up ${chalk.bold(target.full)}...`);
  }
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  if (!state.isInitialized()) {
    throw new UserError('Velo is not initialized. Create a project first with: velo project create <name>');
  }

  // Check if backup is configured
  const backupConfig = state.getBackupConfig();
  if (!backupConfig) {
    throw new UserError(
      'Backup is not configured',
      `Run '${CLI_NAME} backup init' first to configure S3 backup`
    );
  }

  // Find the branch
  const proj = await state.getProjectByName(target.project);
  if (!proj) {
    throw new UserError(
      `Project '${target.project}' not found`,
      `Run '${CLI_NAME} project list' to see available projects`
    );
  }

  const branch = proj.branches.find(b => b.name === target.full);
  if (!branch) {
    throw new UserError(
      `Branch '${target.full}' not found`,
      `Run '${CLI_NAME} branch list' to see available branches`
    );
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // Compute names
  const containerName = getContainerName(target.project, target.branch);
  const datasetName = getDatasetName(target.project, target.branch);
  const datasetPath = getDatasetPath(stateData.zfsPool, stateData.zfsDatasetBase, target.project, target.branch);

  let snapshotName: string;

  // Create snapshot if not WAL-only
  if (!options.walOnly) {
    // If branch is running, execute CHECKPOINT before snapshot
    if (branch.status === 'running') {
      const docker = new DockerManager();

      const containerID = await docker.getContainerByName(containerName);
      if (!containerID) {
        throw new UserError(`Container ${containerName} not found`);
      }

      await withProgress('Checkpoint', async () => {
        await docker.execSQL(containerID, 'CHECKPOINT;', proj.credentials.username);
      });
    }

    // Create ZFS snapshot with backup- prefix
    const snapshotTimestamp = formatTimestamp(new Date());
    snapshotName = `backup-${snapshotTimestamp}`;

    await withProgress('Create snapshot', async () => {
      await zfs.createSnapshot(datasetName, snapshotName);
    });
  } else {
    // For WAL-only backup, we still need a snapshot name for metadata
    // Use the latest snapshot
    const snapshots = await zfs.listSnapshots(datasetName);
    if (snapshots.length === 0) {
      throw new UserError(
        'No snapshots available for WAL-only backup',
        'Create a snapshot first with --snapshot-only or run a full backup'
      );
    }
    snapshotName = snapshots[snapshots.length - 1]?.name || formatTimestamp(new Date());
  }

  // Push backup to S3
  const backupManager = new BackupManager(backupConfig);
  const metadata = await withProgress('Upload to S3', async () => {
    return await backupManager.pushBackup(
      branch,
      stateData.zfsPool,
      stateData.zfsDatasetBase,
      snapshotName,
      options
    );
  });

  console.log();
  console.log(chalk.green('✓'), 'Backup completed successfully');
  console.log();
  console.log('Details:');
  console.log(`  Snapshot: ${chalk.dim(snapshotName)}`);
  console.log(`  Size: ${formatBytes(metadata.sizeBytes)}`);
  if (metadata.walFileCount > 0) {
    console.log(`  WAL files: ${metadata.walFileCount} (${formatBytes(metadata.walSizeBytes)})`);
  }
  console.log();
}
