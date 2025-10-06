import { PATHS } from '../utils/paths';
import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';
import { generateUUID, sanitizeName, formatTimestamp } from '../utils/helpers';
import { Branch } from '../types/state';




export interface BranchOptions {
  fast?: boolean;
}

export async function branchCommand(source: string, target: string, options: BranchOptions = {}) {
  const snapshotType = options.fast ? chalk.yellow('crash-consistent (fast)') : chalk.green('application-consistent');
  console.log();
  console.log(chalk.bold(`🌿 Creating ${snapshotType} branch: ${chalk.cyan(source)} → ${chalk.cyan(target)}`));
  console.log();

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Sanitize target name
  const sanitizedTarget = sanitizeName(target);
  if (sanitizedTarget !== target) {
    console.log(chalk.yellow(`📝 Sanitized name: ${target} → ${sanitizedTarget}`));
  }

  // Find source database
  const sourceDb = await state.getDatabase(source);
  if (!sourceDb) {
    throw new Error(`Source database '${source}' not found`);
  }

  // Check if target already exists
  const existingDb = await state.getDatabaseByName(sanitizedTarget);
  const existingBranch = await state.getBranch(sanitizedTarget);
  if (existingDb || existingBranch) {
    throw new Error(`Database or branch '${sanitizedTarget}' already exists`);
  }

  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
  const docker = new DockerManager();

  // Create snapshot with appropriate consistency level
  const snapshotName = formatTimestamp(new Date());
  const fullSnapshotName = `${sourceDb.zfsDataset}@${snapshotName}`;

  let backupLSN: string | null = null;

  if (!options.fast && sourceDb.status === 'running') {
    // Application-consistent snapshot using pg_backup_start
    const spinner = ora('Starting PostgreSQL backup mode').start();
    const containerID = await docker.getContainerByName(sourceDb.containerName);
    if (!containerID) {
      throw new Error(`Container ${sourceDb.containerName} not found`);
    }

    try {
      // Execute backup start/snapshot/stop workflow
      const combinedSQL = "SELECT pg_backup_start('betterpg-snapshot', false); SELECT lsn FROM pg_backup_stop();";

      // Start backup mode
      const startOutput = await docker.execSQL(
        containerID,
        "SELECT pg_backup_start('betterpg-snapshot', false);",
        sourceDb.credentials.username
      );
      const startLSN = startOutput.trim();
      spinner.succeed(`Backup mode started ${chalk.dim(`(LSN: ${startLSN})`)}`);

      // Create ZFS snapshot while in backup mode
      const snapshotSpinner = ora(`Creating snapshot: ${snapshotName}`).start();
      await zfs.createSnapshot(sourceDb.name, snapshotName);
      snapshotSpinner.succeed(`Created snapshot: ${snapshotName}`);

      // Stop backup mode
      const stopSpinner = ora('Stopping backup mode').start();
      const fullOutput = await docker.execSQL(containerID, combinedSQL, sourceDb.credentials.username);
      const lines = fullOutput.split('\n').filter(l => l.trim());
      const stopLSN = lines[lines.length - 1];
      stopSpinner.succeed(`Backup mode stopped ${chalk.dim(`(LSN: ${stopLSN})`)}`);
    } catch (error: any) {
      // Try to clean up backup mode
      try {
        const cleanupSQL = "SELECT pg_backup_start('cleanup', false); SELECT pg_backup_stop();";
        await docker.execSQL(containerID, cleanupSQL, sourceDb.credentials.username).catch(() => {});
      } catch {}
      throw error;
    }
  } else {
    // Crash-consistent snapshot (fast mode or database is stopped)
    if (options.fast && sourceDb.status === 'running') {
      console.log(chalk.yellow(`⚡ Using crash-consistent snapshot (--fast mode)`));
      console.log(chalk.dim(`⚠️  Note: Branch will require WAL replay on startup`));
    }
    const spinner = ora(`Creating snapshot: ${snapshotName}`).start();
    await zfs.createSnapshot(sourceDb.name, snapshotName);
    spinner.succeed(`Created snapshot: ${snapshotName}`);
  }

  // Clone snapshot
  const cloneSpinner = ora(`Cloning snapshot to: ${sanitizedTarget}`).start();
  await zfs.cloneSnapshot(fullSnapshotName, sanitizedTarget);
  cloneSpinner.succeed(`Cloned snapshot to: ${sanitizedTarget}`);

  const mountpoint = await zfs.getMountpoint(sanitizedTarget);
  const port = await state.allocatePort();

  // Pull image
  const imageExists = await docker.imageExists(cfg.postgres.image);
  if (!imageExists) {
    const pullSpinner = ora(`Pulling image: ${cfg.postgres.image}`).start();
    await docker.pullImage(cfg.postgres.image);
    pullSpinner.succeed(`Pulled image: ${cfg.postgres.image}`);
  }

  // Create WAL archive directory
  const walArchivePath = `${PATHS.WAL_ARCHIVE}/${sanitizedTarget}`;
  await Bun.write(walArchivePath + '/.keep', '');

  // Create container
  const containerName = `bpg-${sanitizedTarget}`;
  const containerSpinner = ora(`Creating container: ${containerName}`).start();
  const containerID = await docker.createContainer({
    name: containerName,
    version: cfg.postgres.version,
    port,
    dataPath: mountpoint,
    walArchivePath,
    password: sourceDb.credentials.password,
    username: sourceDb.credentials.username,
    database: sourceDb.credentials.database,
    sharedBuffers: cfg.postgres.config.shared_buffers,
    maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
  });

  await docker.startContainer(containerID);
  containerSpinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(containerID);
  containerSpinner.succeed('PostgreSQL is ready');

  const sizeBytes = await zfs.getUsedSpace(sanitizedTarget);

  const branch: Branch = {
    id: generateUUID(),
    name: sanitizedTarget,
    parentId: sourceDb.id,
    snapshotName: fullSnapshotName,
    zfsDataset: `${cfg.zfs.pool}/${cfg.zfs.datasetBase}/${sanitizedTarget}`,
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
  console.log(chalk.bold('Connection details:'));
  console.log(chalk.dim('  Host:    '), 'localhost');
  console.log(chalk.dim('  Port:    '), chalk.cyan(port.toString()));
  console.log(chalk.dim('  Database:'), sourceDb.credentials.database);
  console.log(chalk.dim('  Username:'), sourceDb.credentials.username);
  console.log(chalk.dim('  Password:'), chalk.yellow(sourceDb.credentials.password));
  console.log();
}
