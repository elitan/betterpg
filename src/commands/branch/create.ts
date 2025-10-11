import { PATHS } from '../../utils/paths';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { WALManager } from '../../managers/wal';
import { StateManager } from '../../managers/state';
import { generateUUID, formatTimestamp } from '../../utils/helpers';
import type { Branch } from '../../types/state';
import { parseNamespace, getMainBranch } from '../../utils/namespace';
import { parseRecoveryTime, formatDate } from '../../utils/time';
import { Rollback } from '../../utils/rollback';
import { UserError } from '../../errors';
import { withProgress } from '../../utils/progress';
import { getContainerName, getDatasetName, getDatasetPath } from '../../utils/naming';

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
    throw new UserError(
      `Source and target must be in the same project`,
      `Source: ${source.project}, Target: ${target.project}`
    );
  }

  // Parse PITR target if provided
  let recoveryTarget: Date | undefined;

  console.log();
  console.log(`Creating ${chalk.bold(target.full)} from ${chalk.bold(source.full)}...`);

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
    throw new UserError(
      `Project '${source.project}' not found`,
      "Run 'pgd project list' to see available projects"
    );
  }

  const sourceBranch = sourceProject.branches.find(b => b.name === source.full);
  if (!sourceBranch) {
    throw new UserError(
      `Source branch '${source.full}' not found`,
      "Run 'pgd branch list' to see available branches"
    );
  }

  // Check if target already exists
  const existingBranch = sourceProject.branches.find(b => b.name === target.full);
  if (existingBranch) {
    throw new UserError(`Branch '${target.full}' already exists`);
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);
  const docker = new DockerManager();
  const wal = new WALManager();

  // Setup rollback for cleanup on failure
  const rollback = new Rollback();

  // For PITR, find existing snapshot before recovery target
  // Note: These will always be assigned by either PITR or non-PITR block below
  let fullSnapshotName!: string;
  let snapshotName!: string;
  let createdSnapshot = false;

  if (options.pitr && recoveryTarget) {
    // Find snapshots for source branch
    const snapshots = await state.getSnapshotsForBranch(source.full);

    // Filter snapshots created BEFORE recovery target
    const validSnapshots = snapshots.filter(s =>
      new Date(s.createdAt) < recoveryTarget
    );

    if (validSnapshots.length === 0) {
      throw new UserError(
        `No snapshots found before recovery target ${formatDate(recoveryTarget)}`,
        `Create a snapshot with: pgd snapshot create ${source.full} ${chalk.bold('--label')} <name>`
      );
    }

    // Sort by creation time (newest first) and take the closest one before target
    validSnapshots.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const selectedSnapshot = validSnapshots[0]!; // Safe: we checked validSnapshots.length > 0

    fullSnapshotName = selectedSnapshot.zfsSnapshot;
    const parts = fullSnapshotName.split('@');
    if (parts.length !== 2 || !parts[1]) {
      throw new UserError(`Invalid snapshot name format: ${fullSnapshotName}`);
    }
    snapshotName = parts[1];

    console.log(chalk.dim(`  Using snapshot: ${selectedSnapshot.label || snapshotName} (created ${formatDate(new Date(selectedSnapshot.createdAt))})`));
    console.log();
  }

  // Compute source branch names
  const sourceNamespace = parseNamespace(source.full);
  const sourceContainerName = getContainerName(sourceNamespace.project, sourceNamespace.branch);
  const sourceDatasetName = getDatasetName(sourceNamespace.project, sourceNamespace.branch);
  const sourceDatasetPath = getDatasetPath(stateData.zfsPool, stateData.zfsDatasetBase, sourceNamespace.project, sourceNamespace.branch);

  // For non-PITR, create new snapshot with appropriate consistency level
  if (!options.pitr) {
    snapshotName = formatTimestamp(new Date());
    fullSnapshotName = `${sourceDatasetPath}@${snapshotName}`;
  }

  // At this point, either PITR or non-PITR block has set these variables
  // The ! operator above tells TypeScript we guarantee they'll be assigned

  // Only create a NEW snapshot if not using PITR (PITR uses existing snapshots)
  if (!options.pitr) {
    // Application-consistent snapshot using CHECKPOINT
    if (sourceBranch.status === 'running') {
      // We use CHECKPOINT instead of pg_backup_start because:
      // 1. ZFS snapshots are atomic and instantaneous
      // 2. CHECKPOINT ensures all data is flushed to disk
      // 3. This provides application-consistent snapshots which are safe for PostgreSQL
      // 4. No need for WAL replay on recovery
      const containerID = await docker.getContainerByName(sourceContainerName);
      if (!containerID) {
        throw new UserError(`Container ${sourceContainerName} not found`);
      }

      await withProgress('Checkpoint', async () => {
        // Force a checkpoint to ensure all data is written to disk
        await docker.execSQL(containerID, 'CHECKPOINT;', sourceProject.credentials.username);
      });

      // Create ZFS snapshot immediately after checkpoint
      await withProgress(`Snapshot ${snapshotName}`, async () => {
        await zfs.createSnapshot(sourceDatasetName, snapshotName);
        createdSnapshot = true;
      });
    } else {
      // Database is stopped - direct snapshot
      await withProgress(`Snapshot ${snapshotName}`, async () => {
        await zfs.createSnapshot(sourceDatasetName, snapshotName);
        createdSnapshot = true;
      });
    }
  }

  // Clone snapshot - use consistent <project>-<branch> naming
  const targetDatasetName = getDatasetName(target.project, target.branch);
  const targetDatasetPath = getDatasetPath(stateData.zfsPool, stateData.zfsDatasetBase, target.project, target.branch);
  const targetContainerName = getContainerName(target.project, target.branch);
  let mountpoint: string;
  let port: number;
  let containerID: string | undefined;

  try {
    await withProgress('Clone dataset', async () => {
      await zfs.cloneSnapshot(fullSnapshotName, targetDatasetName);
    });

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
    await withProgress('Mount dataset', async () => {
      await zfs.mountDataset(targetDatasetName);
    });

    mountpoint = await zfs.getMountpoint(targetDatasetName);

    // Use port 0 to let Docker dynamically assign an available port
    port = 0;

    // Pull image if needed (use project's docker image)
    const dockerImage = sourceProject.dockerImage;
    const imageExists = await docker.imageExists(dockerImage);
    if (!imageExists) {
      await withProgress(`Pull ${dockerImage}`, async () => {
        await docker.pullImage(dockerImage);
      });
    }

    // Create WAL archive directory for target branch
    await wal.ensureArchiveDir(targetDatasetName);
    const targetWALArchivePath = wal.getArchivePath(targetDatasetName);

    // Determine which WAL archive to mount
    let walArchivePath = targetWALArchivePath;

    // If PITR is requested, setup recovery configuration
    if (recoveryTarget) {
      await withProgress('Configure PITR recovery', async () => {
        // Get source WAL archive path (shared across all branches of same project)
        const sourceWALArchivePath = wal.getArchivePath(sourceDatasetName);

        // Setup recovery configuration in the cloned dataset
        await wal.setupPITRecovery(mountpoint, sourceWALArchivePath, recoveryTarget);

        // For PITR recovery, mount the SOURCE WAL archive so PostgreSQL can read archived WAL files
        walArchivePath = sourceWALArchivePath;
      });
    }

    // Create and start container
    const containerLabel = recoveryTarget ? 'PostgreSQL WAL replay' : 'PostgreSQL ready';
    containerID = await withProgress(containerLabel, async () => {
      const id = await docker.createContainer({
        name: targetContainerName,
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
        await docker.removeContainer(id).catch(() => {});
      });

      await docker.startContainer(id);
      await docker.waitForHealthy(id);

      return id;
    });

    // Get the dynamically assigned port from Docker
    port = await docker.getContainerPort(containerID);

    const sizeBytes = await zfs.getUsedSpace(targetDatasetName);

    const branch: Branch = {
      id: generateUUID(),
      name: target.full,
      projectName: target.project,
      parentBranchId: sourceBranch.id,
      isPrimary: false,
      snapshotName: fullSnapshotName,
      zfsDataset: targetDatasetName,
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
  console.log(chalk.bold(`Branch '${target.full}' created`));
  console.log();
  console.log(chalk.bold('Connection ready:'));
  console.log(`  postgresql://${sourceProject.credentials.username}:${sourceProject.credentials.password}@localhost:${port}/${sourceProject.credentials.database}?sslmode=require`);
  console.log();
}
