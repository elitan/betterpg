import ora from 'ora';
import chalk from 'chalk';
import { $ } from 'bun';
import { ZFSManager } from '../../managers/zfs';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { WALManager } from '../../managers/wal';
import { CertManager } from '../../managers/cert';
import { generateUUID, generatePassword } from '../../utils/helpers';
import { Project, Branch } from '../../types/state';
import { PATHS } from '../../utils/paths';
import { buildNamespace, validateName } from '../../utils/namespace';
import { CONTAINER_PREFIX } from '../../config/constants';
import { DEFAULTS } from '../../config/defaults';
import { getZFSPool } from '../../utils/zfs-pool';
import { validateAllPermissions } from '../../utils/zfs-permissions';
import { requireSetup } from '../../utils/setup-check';
import * as fs from 'fs/promises';

interface CreateOptions {
  pool?: string;
  version?: string;
  image?: string;
}

export async function projectCreateCommand(name: string, options: CreateOptions = {}) {
  // Validate name FIRST before any operations
  validateName(name, 'project');

  // Check if setup has been completed
  await requireSetup();

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

  console.log();
  console.log(`Creating project ${chalk.cyan(name)}...`);
  console.log();

  // Load state
  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Auto-detect or validate ZFS pool
  let pool: string;
  if (options.pool) {
    const poolStart = Date.now();
    process.stdout.write(chalk.dim(`  ▸ Validate ZFS pool ${options.pool}`));
    pool = await getZFSPool(options.pool);
    const poolTime = ((Date.now() - poolStart) / 1000).toFixed(1);
    const labelLength = `Validate ZFS pool ${options.pool}`.length;
    console.log(chalk.dim(`${' '.repeat(40 - labelLength)}${poolTime}s`));
  } else {
    const poolStart = Date.now();
    process.stdout.write(chalk.dim('  ▸ Detect ZFS pool'));
    pool = await getZFSPool();
    const poolTime = ((Date.now() - poolStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - 'Detect ZFS pool'.length)}${poolTime}s`));
  }

  // Validate permissions before proceeding
  const permStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Validate permissions'));
  await validateAllPermissions(pool, DEFAULTS.zfs.datasetBase);
  const permTime = ((Date.now() - permStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Validate permissions'.length)}${permTime}s`));

  // Auto-initialize state if needed (first project create)
  if (!state.isInitialized()) {
    const initStart = Date.now();
    process.stdout.write(chalk.dim('  ▸ Initialize pgd'));

    // Create WAL archive directory
    await fs.mkdir(PATHS.WAL_ARCHIVE, { recursive: true });

    // Initialize state
    await state.autoInitialize(pool, DEFAULTS.zfs.datasetBase);
    const initTime = ((Date.now() - initStart) / 1000).toFixed(1);
    console.log(chalk.dim(`${' '.repeat(40 - 'Initialize pgd'.length)}${initTime}s`));
  }

  // Check if project already exists
  const existing = await state.getProjectByName(name);
  if (existing) {
    throw new Error(`Project '${name}' already exists`);
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const fullDatasetBase = stateData.zfsDatasetBase; // e.g., "pgd/databases"

  // Initialize managers
  const zfs = new ZFSManager(pool, fullDatasetBase);
  const docker = new DockerManager();
  const wal = new WALManager();
  const cert = new CertManager();

  // Use port 0 to let Docker dynamically assign an available port
  let port = 0;

  // Create ZFS dataset for main branch
  const mainBranchName = buildNamespace(name, 'main');
  const mainDatasetName = `${name}-main`; // Use consistent naming: <project>-<branch>

  const datasetStart = Date.now();
  process.stdout.write(chalk.dim(`  ▸ Create dataset ${mainBranchName}`));
  await zfs.createDataset(mainDatasetName, {
    compression: DEFAULTS.zfs.compression,
    recordsize: DEFAULTS.zfs.recordsize,
    atime: DEFAULTS.zfs.atime,
  });
  const datasetTime = ((Date.now() - datasetStart) / 1000).toFixed(1);
  const datasetLabel = `Create dataset ${mainBranchName}`.length;
  console.log(chalk.dim(`${' '.repeat(40 - datasetLabel)}${datasetTime}s`));

  // Mount the dataset (requires sudo on Linux due to kernel restrictions)
  const mountStart = Date.now();
  process.stdout.write(chalk.dim(`  ▸ Mount dataset`));
  await zfs.mountDataset(mainDatasetName);
  const mountTime = ((Date.now() - mountStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Mount dataset'.length)}${mountTime}s`));

  // Get dataset mountpoint
  const mountpoint = await zfs.getMountpoint(mainDatasetName);

  // Generate SSL certificates
  const certStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Generate SSL certificates'));
  const certPaths = await cert.generateCerts(name);
  const certTime = ((Date.now() - certStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Generate SSL certificates'.length)}${certTime}s`));

  // Generate credentials
  const password = generatePassword();
  const containerName = `${CONTAINER_PREFIX}-${name}-main`;

  // Pull PostgreSQL image if needed
  const imageExists = await docker.imageExists(dockerImage);
  if (!imageExists) {
    const pullStart = Date.now();
    process.stdout.write(chalk.dim(`  ▸ Pull ${dockerImage}`));
    await docker.pullImage(dockerImage);
    const pullTime = ((Date.now() - pullStart) / 1000).toFixed(1);
    const pullLabel = `Pull ${dockerImage}`.length;
    console.log(chalk.dim(`${' '.repeat(40 - pullLabel)}${pullTime}s`));
  }

  // Create WAL archive directory
  await wal.ensureArchiveDir(mainDatasetName);
  const walArchivePath = wal.getArchivePath(mainDatasetName);

  // Create and start Docker container for main branch
  const containerStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ PostgreSQL ready'));

  const containerID = await docker.createContainer({
    name: containerName,
    image: dockerImage,
    port,
    dataPath: mountpoint,
    walArchivePath,
    sslCertDir: certPaths.certDir,
    password,
    username: 'postgres',
    database: 'postgres',
  });

  await docker.startContainer(containerID);
  await docker.waitForHealthy(containerID);

  // Get the dynamically assigned port from Docker
  port = await docker.getContainerPort(containerID);

  const containerTime = ((Date.now() - containerStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'PostgreSQL ready'.length)}${containerTime}s`));

  // Get dataset size
  const sizeBytes = await zfs.getUsedSpace(mainDatasetName);

  // Create main branch
  const mainBranch: Branch = {
    id: generateUUID(),
    name: mainBranchName,
    projectName: name,
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
    name: name,
    dockerImage,
    sslCertDir: certPaths.certDir,
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
  console.log('Connection ready:');
  console.log(`  postgresql://postgres:${password}@localhost:${port}/postgres?sslmode=require`);
  console.log();
}
