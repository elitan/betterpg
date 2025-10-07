import ora from 'ora';
import chalk from 'chalk';
import { $ } from 'bun';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { WALManager } from '../../managers/wal';
import { generateUUID, generatePassword, sanitizeName } from '../../utils/helpers';
import { Project, Branch } from '../../types/state';
import { PATHS } from '../../utils/paths';
import { buildNamespace } from '../../utils/namespace';
import { CONTAINER_PREFIX } from '../../config/constants';
import { DEFAULTS } from '../../config/defaults';
import { getZFSPool } from '../../utils/zfs-pool';
import * as fs from 'fs/promises';

interface CreateOptions {
  pool?: string;
  version?: string;
  image?: string;
}

export async function projectCreateCommand(name: string, options: CreateOptions = {}) {
  console.log();
  console.log(chalk.bold(`🚀 Creating project: ${chalk.cyan(name)}`));
  console.log();

  // Validate flags
  if (options.version && options.image) {
    throw new Error('Cannot specify both --version and --image. Use one or the other.');
  }

  // Determine Docker image to use
  let dockerImage: string;
  if (options.image) {
    dockerImage = options.image;
  } else if (options.version) {
    dockerImage = `postgres:${options.version}-alpine`;
  } else {
    dockerImage = DEFAULTS.postgres.defaultImage;
  }

  // Sanitize and validate name
  const sanitizedName = sanitizeName(name);
  if (sanitizedName !== name) {
    console.log(chalk.yellow(`📝 Sanitized name: ${name} → ${sanitizedName}`));
  }

  // Load state
  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Auto-detect or validate ZFS pool
  let pool: string;
  if (options.pool) {
    const poolSpinner = ora(`Validating ZFS pool: ${options.pool}`).start();
    pool = await getZFSPool(options.pool);
    poolSpinner.succeed(`Using ZFS pool: ${pool}`);
  } else {
    const poolSpinner = ora('Detecting ZFS pool').start();
    pool = await getZFSPool();
    poolSpinner.succeed(`Auto-detected ZFS pool: ${pool}`);
  }

  // Auto-initialize state if needed (first project create)
  if (!state.isInitialized()) {
    const initSpinner = ora('Initializing BetterPG').start();

    // Create WAL archive directory
    await fs.mkdir(PATHS.WAL_ARCHIVE, { recursive: true });

    // Initialize state
    await state.autoInitialize(pool, DEFAULTS.zfs.datasetBase);
    initSpinner.succeed('BetterPG initialized');
  }

  // Check if project already exists
  const existing = await state.getProjectByName(sanitizedName);
  if (existing) {
    throw new Error(`Project '${sanitizedName}' already exists`);
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const fullDatasetBase = stateData.zfsDatasetBase; // e.g., "betterpg/databases"

  // Initialize managers
  const zfs = new ZFSManager(pool, fullDatasetBase);
  const docker = new DockerManager();
  const wal = new WALManager();

  // Use port 0 to let Docker dynamically assign an available port
  let port = 0;

  // Create ZFS dataset for main branch
  const mainBranchName = buildNamespace(sanitizedName, 'main');
  const mainDatasetName = `${sanitizedName}-main`; // Use consistent naming: <project>-<branch>
  const spinner = ora(`Creating ZFS dataset: ${mainBranchName}`).start();
  await zfs.createDataset(mainDatasetName, {
    compression: DEFAULTS.zfs.compression,
    recordsize: DEFAULTS.zfs.recordsize,
  });
  spinner.succeed(`Created ZFS dataset: ${mainBranchName}`);

  // Get dataset mountpoint
  const mountpoint = await zfs.getMountpoint(mainDatasetName);

  // Generate credentials
  const password = generatePassword();
  const containerName = `${CONTAINER_PREFIX}-${sanitizedName}-main`;

  // Pull PostgreSQL image if needed
  const imageExists = await docker.imageExists(dockerImage);
  if (!imageExists) {
    const pullSpinner = ora(`Pulling PostgreSQL image: ${dockerImage}`).start();
    await docker.pullImage(dockerImage);
    pullSpinner.succeed(`Pulled PostgreSQL image: ${dockerImage}`);
  }

  // Create WAL archive directory
  await wal.ensureArchiveDir(mainDatasetName);
  const walArchivePath = wal.getArchivePath(mainDatasetName);

  // Create Docker container for main branch
  const createSpinner = ora('Creating PostgreSQL container').start();
  const containerID = await docker.createContainer({
    name: containerName,
    image: dockerImage,
    port,
    dataPath: mountpoint,
    walArchivePath,
    password,
    username: 'postgres',
    database: 'postgres',
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
    projectName: sanitizedName,
    parentBranchId: null, // main has no parent
    isPrimary: true,
    snapshotName: null, // main has no snapshot
    zfsDataset: `${pool}/${fullDatasetBase}/${mainDatasetName}`,
    zfsDatasetName: mainDatasetName,
    containerName,
    port,
    createdAt: new Date().toISOString(),
    sizeBytes,
    status: 'running',
  };

  // Create project record with main branch
  const project: Project = {
    id: generateUUID(),
    name: sanitizedName,
    dockerImage,
    createdAt: new Date().toISOString(),
    credentials: {
      username: 'postgres',
      password,
      database: 'postgres',
    },
    branches: [mainBranch],
  };

  await state.addProject(project);

  console.log();
  console.log(chalk.green.bold('✓ Project created successfully!'));
  console.log();
  console.log(chalk.dim('Docker image:'), chalk.cyan(dockerImage));
  console.log(chalk.dim('Main branch: '), chalk.cyan(mainBranchName));
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
