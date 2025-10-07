import { PATHS } from '../../utils/paths';
import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { WALManager } from '../../managers/wal';
import { StateManager } from '../../managers/state';
import { ConfigManager } from '../../managers/config';
import { generateUUID, sanitizeName, formatTimestamp } from '../../utils/helpers';
import { Branch } from '../../types/state';
import { parseNamespace, buildNamespace, getMainBranch } from '../../utils/namespace';
import { parseRecoveryTime, formatDate } from '../../utils/time';

export interface BranchCreateOptions {
  from?: string;
  fast?: boolean;
  pitr?: string;  // Point-in-time recovery target
}

export async function branchCreateCommand(targetName: string, options: BranchCreateOptions = {}) {
  // Parse target namespace
  const target = parseNamespace(targetName);

  // Determine source (parent)
  let sourceName: string;
  if (options.from) {
    sourceName = options.from;
  } else {
    // Default to <database>/main
    sourceName = getMainBranch(target.database);
  }

  const source = parseNamespace(sourceName);

  // Validate source and target are in same database
  if (source.database !== target.database) {
    throw new Error(
      `Source and target must be in the same database. Source: ${source.database}, Target: ${target.database}`
    );
  }

  // Parse PITR target if provided
  let recoveryTarget: Date | undefined;
  if (options.pitr) {
    recoveryTarget = parseRecoveryTime(options.pitr);
    console.log();
    console.log(chalk.bold(`⏰ Creating PITR branch`));
    console.log(chalk.dim(`   From: ${chalk.cyan(source.full)} → To: ${chalk.cyan(target.full)}`));
    console.log(chalk.dim(`   Recovery target: ${chalk.yellow(formatDate(recoveryTarget))}`));
    console.log();
  } else {
    const snapshotType = options.fast ? chalk.yellow('crash-consistent (fast)') : chalk.green('application-consistent');
    console.log();
    console.log(chalk.bold(`🌿 Creating ${snapshotType} branch`));
    console.log(chalk.dim(`   From: ${chalk.cyan(source.full)} → To: ${chalk.cyan(target.full)}`));
    console.log();
  }

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Find source database and branch
  const sourceDb = await state.getDatabaseByName(source.database);
  if (!sourceDb) {
    throw new Error(`Database '${source.database}' not found`);
  }

  const sourceBranch = sourceDb.branches.find(b => b.name === source.full);
  if (!sourceBranch) {
    throw new Error(`Source branch '${source.full}' not found`);
  }

  // Check if target already exists
  const existingBranch = sourceDb.branches.find(b => b.name === target.full);
  if (existingBranch) {
    throw new Error(`Branch '${target.full}' already exists`);
  }

  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
  const docker = new DockerManager();
  const wal = new WALManager();

  // For PITR, find existing snapshot before recovery target
  let fullSnapshotName: string;
  let snapshotName: string;

  if (options.pitr && recoveryTarget) {
    // Find snapshots for source branch
    const snapshots = await state.getSnapshotsForBranch(source.full);

    // Filter snapshots created BEFORE recovery target
    const validSnapshots = snapshots.filter(s =>
      new Date(s.createdAt) < recoveryTarget
    );

    if (validSnapshots.length === 0) {
      throw new Error(
        `No snapshots found before recovery target ${formatDate(recoveryTarget)}.\n` +
        `Create a snapshot with: bpg snapshot create ${source.full} --label <name>`
      );
    }

    // Sort by creation time (newest first) and take the closest one before target
    validSnapshots.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const selectedSnapshot = validSnapshots[0];

    fullSnapshotName = selectedSnapshot.zfsSnapshot;
    snapshotName = fullSnapshotName.split('@')[1];

    console.log(chalk.dim(`   Using snapshot: ${chalk.cyan(selectedSnapshot.label || snapshotName)}`));
    console.log(chalk.dim(`   Snapshot created: ${chalk.yellow(formatDate(new Date(selectedSnapshot.createdAt)))}`));
    console.log();
  } else {
    // Create new snapshot with appropriate consistency level
    snapshotName = formatTimestamp(new Date());
    fullSnapshotName = `${sourceBranch.zfsDataset}@${snapshotName}`;
  }

  // Only create a NEW snapshot if not using PITR (PITR uses existing snapshots)
  if (!options.pitr) {
    // For PITR branches, always use crash-consistent snapshots since WAL replay provides consistency
    const useFastSnapshot = options.fast;

    if (!useFastSnapshot && sourceBranch.status === 'running') {
      // Application-consistent snapshot using pg_backup_start
      const spinner = ora('Starting PostgreSQL backup mode').start();
      const containerID = await docker.getContainerByName(sourceBranch.containerName);
      if (!containerID) {
        throw new Error(`Container ${sourceBranch.containerName} not found`);
      }

      try {
        // Start backup mode
        const startLSN = await docker.startBackupMode(containerID, sourceDb.credentials.username);
        spinner.succeed(`Backup mode started ${chalk.dim(`(LSN: ${startLSN})`)}`);

        // Create ZFS snapshot while in backup mode
        const snapshotSpinner = ora(`Creating snapshot: ${snapshotName}`).start();
        // Extract dataset name from full path (e.g., "tank/betterpg/databases/dev" -> "dev")
        const datasetName = sourceBranch.zfsDataset.split('/').pop() || source.branch;
        await zfs.createSnapshot(datasetName, snapshotName);
        snapshotSpinner.succeed(`Created snapshot: ${snapshotName}`);

        // Stop backup mode
        const stopSpinner = ora('Stopping backup mode').start();
        const stopLSN = await docker.stopBackupMode(containerID, sourceDb.credentials.username);
        stopSpinner.succeed(`Backup mode stopped ${chalk.dim(`(LSN: ${stopLSN})`)}`);
      } catch (error: any) {
        // Try to clean up backup mode
        try {
          await docker.stopBackupMode(containerID, sourceDb.credentials.username).catch(() => {});
        } catch {}
        throw error;
      }
    } else {
      // Crash-consistent snapshot (fast mode or database is stopped)
      if (options.fast && sourceBranch.status === 'running') {
        console.log(chalk.yellow(`⚡ Using crash-consistent snapshot (--fast mode)`));
        console.log(chalk.dim(`⚠️  Note: Branch will require WAL replay on startup`));
      }
      const spinner = ora(`Creating snapshot: ${snapshotName}`).start();
      // Extract dataset name from full path
      const datasetName = sourceBranch.zfsDataset.split('/').pop() || source.branch;
      await zfs.createSnapshot(datasetName, snapshotName);
      spinner.succeed(`Created snapshot: ${snapshotName}`);
    }
  }

  // Clone snapshot - use consistent <db>-<branch> naming
  const targetDatasetName = `${target.database}-${target.branch}`;
  const cloneSpinner = ora(`Cloning snapshot to: ${target.branch}`).start();
  await zfs.cloneSnapshot(fullSnapshotName, targetDatasetName);
  cloneSpinner.succeed(`Cloned snapshot to: ${target.branch}`);

  const mountpoint = await zfs.getMountpoint(targetDatasetName);
  const port = await state.allocatePort();

  // Pull image if needed
  const imageExists = await docker.imageExists(cfg.postgres.image);
  if (!imageExists) {
    const pullSpinner = ora(`Pulling image: ${cfg.postgres.image}`).start();
    await docker.pullImage(cfg.postgres.image);
    pullSpinner.succeed(`Pulled image: ${cfg.postgres.image}`);
  }

  // Create WAL archive directory for target branch
  await wal.ensureArchiveDir(targetDatasetName);
  const targetWALArchivePath = wal.getArchivePath(targetDatasetName);

  // If PITR is requested, setup recovery configuration
  if (recoveryTarget) {
    const pitrSpinner = ora('Configuring PITR recovery').start();

    // Get source WAL archive path (shared across all branches of same database)
    const sourceDatasetName = sourceBranch.zfsDataset.split('/').pop() || '';
    const sourceWALArchivePath = wal.getArchivePath(sourceDatasetName);

    // Setup recovery configuration in the cloned dataset
    await wal.setupPITRecovery(mountpoint, sourceWALArchivePath, recoveryTarget);

    pitrSpinner.succeed(`Configured PITR recovery to ${chalk.yellow(formatDate(recoveryTarget))}`);
  }

  // Create container
  const containerName = `bpg-${target.database}-${target.branch}`;
  const containerSpinner = ora(`Creating container: ${containerName}`).start();
  const containerID = await docker.createContainer({
    name: containerName,
    version: cfg.postgres.version,
    port,
    dataPath: mountpoint,
    walArchivePath: targetWALArchivePath,
    password: sourceDb.credentials.password,
    username: sourceDb.credentials.username,
    database: sourceDb.credentials.database,
    sharedBuffers: cfg.postgres.config.shared_buffers,
    maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
  });

  await docker.startContainer(containerID);
  if (recoveryTarget) {
    containerSpinner.text = 'PostgreSQL is replaying WAL logs to recovery target...';
  } else {
    containerSpinner.text = 'Waiting for PostgreSQL to be ready';
  }
  await docker.waitForHealthy(containerID);
  if (recoveryTarget) {
    containerSpinner.succeed('PITR recovery completed - PostgreSQL is ready');
  } else {
    containerSpinner.succeed('PostgreSQL is ready');
  }

  const sizeBytes = await zfs.getUsedSpace(targetDatasetName);

  const branch: Branch = {
    id: generateUUID(),
    name: target.full,
    databaseName: target.database,
    parentBranchId: sourceBranch.id,
    isPrimary: false,
    snapshotName: fullSnapshotName,
    zfsDataset: `${cfg.zfs.pool}/${cfg.zfs.datasetBase}/${targetDatasetName}`,
    containerName,
    port,
    createdAt: new Date().toISOString(),
    sizeBytes,
    status: 'running',
  };

  await state.addBranch(sourceDb.id, branch);

  console.log();
  console.log(chalk.green.bold('✓ Branch created successfully!'));
  console.log();
  console.log(chalk.dim('Branch:  '), chalk.cyan(target.full));
  console.log(chalk.dim('Parent:  '), chalk.dim(source.full));
  console.log();
  console.log(chalk.bold('Connection details:'));
  console.log(chalk.dim('  Host:    '), 'localhost');
  console.log(chalk.dim('  Port:    '), chalk.cyan(port.toString()));
  console.log(chalk.dim('  Database:'), sourceDb.credentials.database);
  console.log(chalk.dim('  Username:'), sourceDb.credentials.username);
  console.log(chalk.dim('  Password:'), chalk.yellow(sourceDb.credentials.password));
  console.log();
}
