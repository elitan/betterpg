import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ConfigManager } from '../../managers/config';
import { WALManager } from '../../managers/wal';
import { generateUUID, generatePassword, sanitizeName } from '../../utils/helpers';
import { Database, Branch } from '../../types/state';
import { PATHS } from '../../utils/paths';
import { buildNamespace } from '../../utils/namespace';
import { CONTAINER_PREFIX } from '../../config/constants';

export async function dbCreateCommand(name: string) {
  console.log();
  console.log(chalk.bold(`🚀 Creating database: ${chalk.cyan(name)}`));
  console.log();

  // Load config and state
  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Sanitize and validate name
  const sanitizedName = sanitizeName(name);
  if (sanitizedName !== name) {
    console.log(chalk.yellow(`📝 Sanitized name: ${name} → ${sanitizedName}`));
  }

  // Check if database already exists
  const existing = await state.getDatabaseByName(sanitizedName);
  if (existing) {
    throw new Error(`Database '${sanitizedName}' already exists`);
  }

  // Initialize managers
  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
  const docker = new DockerManager();
  const wal = new WALManager();

  // Use port 0 to let Docker dynamically assign an available port
  let port = 0;

  // Create ZFS dataset for main branch
  const mainBranchName = buildNamespace(sanitizedName, 'main');
  const mainDatasetName = `${sanitizedName}-main`; // Use consistent naming: <db>-<branch>
  const spinner = ora(`Creating ZFS dataset: ${mainBranchName}`).start();
  await zfs.createDataset(mainDatasetName, {
    compression: cfg.zfs.compression,
    recordsize: cfg.zfs.recordsize,
  });
  spinner.succeed(`Created ZFS dataset: ${mainBranchName}`);

  // Get dataset mountpoint
  const mountpoint = await zfs.getMountpoint(mainDatasetName);

  // Generate credentials
  const password = generatePassword();
  const containerName = `${CONTAINER_PREFIX}-${sanitizedName}-main`;

  // Pull PostgreSQL image if needed
  const imageExists = await docker.imageExists(cfg.postgres.image);
  if (!imageExists) {
    const pullSpinner = ora(`Pulling PostgreSQL image: ${cfg.postgres.image}`).start();
    await docker.pullImage(cfg.postgres.image);
    pullSpinner.succeed(`Pulled PostgreSQL image: ${cfg.postgres.image}`);
  }

  // Create WAL archive directory
  await wal.ensureArchiveDir(mainDatasetName);
  const walArchivePath = wal.getArchivePath(mainDatasetName);

  // Create Docker container for main branch
  const createSpinner = ora('Creating PostgreSQL container').start();
  const containerID = await docker.createContainer({
    name: containerName,
    version: cfg.postgres.version,
    port,
    dataPath: mountpoint,
    walArchivePath,
    password,
    username: 'postgres',
    database: 'postgres',
    sharedBuffers: cfg.postgres.config.shared_buffers,
    maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
    extraConfig: cfg.postgres.config,
  });
  createSpinner.succeed(`Created container ${chalk.dim(containerID.slice(0, 12))}`);

  // Start container
  const startSpinner = ora('Starting PostgreSQL container').start();
  await docker.startContainer(containerID);
  startSpinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(containerID);

  // Get the dynamically assigned port from Docker
  port = await docker.getContainerPort(containerID);

  startSpinner.succeed('PostgreSQL is ready');

  // Get dataset size
  const sizeBytes = await zfs.getUsedSpace(mainDatasetName);

  // Create main branch
  const mainBranch: Branch = {
    id: generateUUID(),
    name: mainBranchName,
    databaseName: sanitizedName,
    parentBranchId: null, // main has no parent
    isPrimary: true,
    snapshotName: null, // main has no snapshot
    zfsDataset: `${cfg.zfs.pool}/${cfg.zfs.datasetBase}/${mainDatasetName}`,
    zfsDatasetName: mainDatasetName,
    containerName,
    port,
    createdAt: new Date().toISOString(),
    sizeBytes,
    status: 'running',
  };

  // Create database record with main branch
  const database: Database = {
    id: generateUUID(),
    name: sanitizedName,
    postgresVersion: cfg.postgres.version,
    createdAt: new Date().toISOString(),
    credentials: {
      username: 'postgres',
      password,
      database: 'postgres',
    },
    branches: [mainBranch],
  };

  await state.addDatabase(database);

  console.log();
  console.log(chalk.green.bold('✓ Database created successfully!'));
  console.log();
  console.log(chalk.dim('Main branch:'), chalk.cyan(mainBranchName));
  console.log();
  console.log(chalk.bold('Connection details:'));
  console.log(chalk.dim('  Host:    '), 'localhost');
  console.log(chalk.dim('  Port:    '), chalk.cyan(port.toString()));
  console.log(chalk.dim('  Database:'), 'postgres');
  console.log(chalk.dim('  Username:'), 'postgres');
  console.log(chalk.dim('  Password:'), chalk.yellow(password));
  console.log();
  console.log(chalk.bold('Connection string:'));
  console.log(chalk.dim('  ') + chalk.cyan(`postgresql://postgres:${password}@localhost:${port}/postgres`));
  console.log();
}
