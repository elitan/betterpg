import { PATHS } from '../../utils/paths';
import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { WALManager } from '../../managers/wal';
import { StateManager } from '../../managers/state';
import { generateUUID, sanitizeName, formatTimestamp } from '../../utils/helpers';
import { Branch } from '../../types/state';
import { parseNamespace, buildNamespace, getMainBranch } from '../../utils/namespace';
import { parseRecoveryTime, formatDate } from '../../utils/time';
import { Rollback } from '../../utils/rollback';
import { CONTAINER_PREFIX } from '../../config/constants';

export interface BranchCreateOptions {
  from?: string;
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
    // Default to <project>/main
    sourceName = getMainBranch(target.project);
  }

  const source = parseNamespace(sourceName);

  // Validate source and target are in same project
  if (source.project !== target.project) {
    throw new Error(
      `Source and target must be in the same project. Source: ${source.project}, Target: ${target.project}`
    );
  }

  // Parse PITR target if provided
  let recoveryTarget: Date | undefined;

  console.log();
  console.log(`Creating ${chalk.cyan(target.full)} from ${chalk.cyan(source.full)}...`);

  if (options.pitr) {
    recoveryTarget = parseRecoveryTime(options.pitr);
    console.log();
    console.log(chalk.dim(`  Recovery target: ${formatDate(recoveryTarget)}`));
  }

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Find source project and branch
  const sourceProject = await state.getProjectByName(source.project);
  if (!sourceProject) {
    throw new Error(`Project '${source.project}' not found`);
  }

  const sourceBranch = sourceProject.branches.find(b => b.name === source.full);
  if (!sourceBranch) {
    throw new Error(`Source branch '${source.full}' not found`);
  }

  // Check if target already exists
  const existingBranch = sourceProject.branches.find(b => b.name === target.full);
  if (existingBranch) {
    throw new Error(`Branch '${target.full}' already exists`);
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);
  const docker = new DockerManager();
  const wal = new WALManager();

  // Setup rollback for cleanup on failure
  const rollback = new Rollback();

  // For PITR, find existing snapshot before recovery target
  let fullSnapshotName: string;
  let snapshotName: string;
  let createdSnapshot = false;

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
        `Create a snapshot with: pgd snapshot create ${source.full} --label <name>`
      );
    }

    // Sort by creation time (newest first) and take the closest one before target
    validSnapshots.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const selectedSnapshot = validSnapshots[0];

    fullSnapshotName = selectedSnapshot.zfsSnapshot;
    snapshotName = fullSnapshotName.split('@')[1];

    console.log(chalk.dim(`  Using snapshot: ${selectedSnapshot.label || snapshotName} (created ${formatDate(new Date(selectedSnapshot.createdAt))})`));
    console.log();
  } else {
    // Create new snapshot with appropriate consistency level
    snapshotName = formatTimestamp(new Date());
    fullSnapshotName = `${sourceBranch.zfsDataset}@${snapshotName}`;
  }

  // Only create a NEW snapshot if not using PITR (PITR uses existing snapshots)
  if (!options.pitr) {
    // Application-consistent snapshot using CHECKPOINT
    if (sourceBranch.status === 'running') {
      // We use CHECKPOINT instead of pg_backup_start because:
      // 1. ZFS snapshots are atomic and instantaneous
      // 2. CHECKPOINT ensures all data is flushed to disk
      // 3. This provides application-consistent snapshots which are safe for PostgreSQL
      // 4. No need for WAL replay on recovery
      const containerID = await docker.getContainerByName(sourceBranch.containerName);
      if (!containerID) {
        throw new Error(`Container ${sourceBranch.containerName} not found`);
      }

      try {
        const checkpointStart = Date.now();
        process.stdout.write(chalk.dim('  ▸ Checkpoint'));
        // Force a checkpoint to ensure all data is written to disk
        await docker.execSQL(containerID, 'CHECKPOINT;', sourceProject.credentials.username);
        const checkpointTime = ((Date.now() - checkpointStart) / 1000).toFixed(1);
        console.log(chalk.dim(`${' '.repeat(40 - 'Checkpoint'.length)}${checkpointTime}s`));

        // Create ZFS snapshot immediately after checkpoint
        const snapshotStart = Date.now();
        process.stdout.write(chalk.dim(`  ▸ Snapshot ${snapshotName}`));
        await zfs.createSnapshot(sourceBranch.zfsDatasetName, snapshotName);
        createdSnapshot = true;
        const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
        const labelLength = `Snapshot ${snapshotName}`.length;
        console.log(chalk.dim(`${' '.repeat(40 - labelLength)}${snapshotTime}s`));
      } catch (error: any) {
        console.log(); // New line after incomplete progress line
        throw error;
      }
    } else {
      // Database is stopped - direct snapshot
      const snapshotStart = Date.now();
      process.stdout.write(chalk.dim(`  ▸ Snapshot ${snapshotName}`));
      await zfs.createSnapshot(sourceBranch.zfsDatasetName, snapshotName);
      createdSnapshot = true;
      const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
      const labelLength = `Snapshot ${snapshotName}`.length;
      console.log(chalk.dim(`${' '.repeat(40 - labelLength)}${snapshotTime}s`));
    }
  }

  // Clone snapshot - use consistent <project>-<branch> naming
  const targetDatasetName = `${target.project}-${target.branch}`;
  let mountpoint: string;
  let port: number;
  let containerID: string | undefined;

  try {
    const cloneStart = Date.now();
    process.stdout.write(chalk.dim('  ▸ Clone dataset'));
    await zfs.cloneSnapshot(fullSnapshotName, targetDatasetName);
    const cloneTime = ((Date.now() - cloneStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - 'Clone dataset'.length)}${cloneTime}s`));

    // Rollback: destroy cloned dataset
    rollback.add(async () => {
      await zfs.destroyDataset(targetDatasetName, true).catch(() => {});
    });

    // Rollback: destroy snapshot if we created it (not for PITR which uses existing snapshots)
    if (createdSnapshot) {
      rollback.add(async () => {
        await zfs.destroySnapshot(fullSnapshotName).catch(() => {});
      });
    }

    // Mount the dataset (requires sudo on Linux due to kernel restrictions)
    const mountStart = Date.now();
    process.stdout.write(chalk.dim('  ▸ Mount dataset'));
    await zfs.mountDataset(targetDatasetName);
    const mountTime = ((Date.now() - mountStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - 'Mount dataset'.length)}${mountTime}s`));

    mountpoint = await zfs.getMountpoint(targetDatasetName);

    // Use port 0 to let Docker dynamically assign an available port
    port = 0;

    // Pull image if needed (use project's docker image)
    const dockerImage = sourceProject.dockerImage;
    const imageExists = await docker.imageExists(dockerImage);
    if (!imageExists) {
      const pullStart = Date.now();
      process.stdout.write(chalk.dim(`  ▸ Pull ${dockerImage}`));
      await docker.pullImage(dockerImage);
      const pullTime = ((Date.now() - pullStart) / 1000).toFixed(1);
      const labelLength = `Pull ${dockerImage}`.length;
      console.log(chalk.dim(`${' '.repeat(40 - labelLength)}${pullTime}s`));
    }

    // Create WAL archive directory for target branch
    await wal.ensureArchiveDir(targetDatasetName);
    const targetWALArchivePath = wal.getArchivePath(targetDatasetName);

    // Determine which WAL archive to mount
    let walArchivePath = targetWALArchivePath;

    // If PITR is requested, setup recovery configuration
    if (recoveryTarget) {
      const pitrStart = Date.now();
      process.stdout.write(chalk.dim('  ▸ Configure PITR recovery'));

      // Get source WAL archive path (shared across all branches of same project)
      const sourceWALArchivePath = wal.getArchivePath(sourceBranch.zfsDatasetName);

      // Setup recovery configuration in the cloned dataset
      await wal.setupPITRecovery(mountpoint, sourceWALArchivePath, recoveryTarget);

      // For PITR recovery, mount the SOURCE WAL archive so PostgreSQL can read archived WAL files
      walArchivePath = sourceWALArchivePath;

      const pitrTime = ((Date.now() - pitrStart) / 1000).toFixed(1);
      console.log(chalk.dim(`${' '.repeat(40 - 'Configure PITR recovery'.length)}${pitrTime}s`));
    }

    // Create and start container
    const containerName = `${CONTAINER_PREFIX}-${target.project}-${target.branch}`;
    const containerStart = Date.now();
    const containerLabel = recoveryTarget ? 'PostgreSQL WAL replay' : 'PostgreSQL ready';
    process.stdout.write(chalk.dim(`  ▸ ${containerLabel}`));

    containerID = await docker.createContainer({
      name: containerName,
      image: dockerImage,
      port,
      dataPath: mountpoint,
      walArchivePath,
      sslCertDir: sourceProject.sslCertDir,
      password: sourceProject.credentials.password,
      username: sourceProject.credentials.username,
      database: sourceProject.credentials.database,
    });

    // Rollback: remove container
    rollback.add(async () => {
      if (containerID) {
        await docker.removeContainer(containerID).catch(() => {});
      }
    });

    await docker.startContainer(containerID);
    await docker.waitForHealthy(containerID);

    // Get the dynamically assigned port from Docker
    port = await docker.getContainerPort(containerID);

    const containerTime = ((Date.now() - containerStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - containerLabel.length)}${containerTime}s`));

    const sizeBytes = await zfs.getUsedSpace(targetDatasetName);

    const branch: Branch = {
      id: generateUUID(),
      name: target.full,
      projectName: target.project,
      parentBranchId: sourceBranch.id,
      isPrimary: false,
      snapshotName: fullSnapshotName,
      zfsDataset: `${stateData.zfsPool}/${stateData.zfsDatasetBase}/${targetDatasetName}`,
      zfsDatasetName: targetDatasetName,
      containerName,
      port,
      createdAt: new Date().toISOString(),
      sizeBytes,
      status: 'running',
    };

    await state.addBranch(sourceProject.id, branch);

    // Success! Clear rollback steps
    rollback.clear();
  } catch (error) {
    // Operation failed, rollback all created resources
    console.log();
    console.log('Operation failed, cleaning up...');
    await rollback.execute();
    throw error;
  }

  console.log();
  console.log('Connection ready:');
  console.log(`  postgresql://${sourceProject.credentials.username}:${sourceProject.credentials.password}@localhost:${port}/${sourceProject.credentials.database}?sslmode=require`);
  console.log();
}
