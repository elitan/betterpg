import { PATHS } from '../../utils/paths';
import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ConfigManager } from '../../managers/config';
import { generateUUID, sanitizeName, formatTimestamp } from '../../utils/helpers';
import { Branch } from '../../types/state';
import { parseNamespace, buildNamespace, getMainBranch } from '../../utils/namespace';

export interface BranchCreateOptions {
  from?: string;
  fast?: boolean;
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

  const snapshotType = options.fast ? chalk.yellow('crash-consistent (fast)') : chalk.green('application-consistent');
  console.log();
  console.log(chalk.bold(`🌿 Creating ${snapshotType} branch`));
  console.log(chalk.dim(`   From: ${chalk.cyan(source.full)} → To: ${chalk.cyan(target.full)}`));
  console.log();

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

  // Create snapshot with appropriate consistency level
  const snapshotName = formatTimestamp(new Date());
  const fullSnapshotName = `${sourceBranch.zfsDataset}@${snapshotName}`;

  if (!options.fast && sourceBranch.status === 'running') {
    // Application-consistent snapshot using pg_backup_start
    const spinner = ora('Starting PostgreSQL backup mode').start();
    const containerID = await docker.getContainerByName(sourceBranch.containerName);
    if (!containerID) {
      throw new Error(`Container ${sourceBranch.containerName} not found`);
    }

    try {
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
      // Extract dataset name from full path (e.g., "tank/betterpg/databases/dev" -> "dev")
      const datasetName = sourceBranch.zfsDataset.split('/').pop() || source.branch;
      await zfs.createSnapshot(datasetName, snapshotName);
      snapshotSpinner.succeed(`Created snapshot: ${snapshotName}`);

      // Stop backup mode
      const stopSpinner = ora('Stopping backup mode').start();
      const combinedSQL = "SELECT pg_backup_start('betterpg-snapshot', false); SELECT lsn FROM pg_backup_stop();";
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

  // Create WAL archive directory
  const walArchivePath = `${PATHS.WAL_ARCHIVE}/${targetDatasetName}`;
  await Bun.write(walArchivePath + '/.keep', '');

  // Create container
  const containerName = `bpg-${target.database}-${target.branch}`;
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
