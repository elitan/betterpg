import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { BackupManager } from '../../managers/backup';
import { DockerManager } from '../../managers/docker';
import { WALManager } from '../../managers/wal';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { UserError, SystemError } from '../../errors';
import { CLI_NAME } from '../../config/constants';
import { generatePassword } from '../../utils/helpers';
import { getDatasetName } from '../../utils/naming';

export interface BackupPullOptions {
  from?: string;   // Specific backup ID to restore from
  pitr?: string;   // Point-in-time recovery timestamp
  to?: string;     // Target branch name (default: source branch name)
}

export async function backupPullCommand(sourceBranch: string, options: BackupPullOptions = {}) {
  const source = parseNamespace(sourceBranch);

  console.log();
  console.log(`Restoring ${chalk.bold(source.full)} from backup...`);
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

  // Determine target branch name
  const targetBranchName = options.to || source.full;
  const target = parseNamespace(targetBranchName);

  // Get project
  const project = await state.getProjectByName(target.project);
  if (!project) {
    throw new UserError(
      `Project '${target.project}' does not exist`,
      `Create it first with: ${CLI_NAME} project create ${target.project}`
    );
  }

  // Check if target branch already exists
  const existingBranch = project.branches.find(b => b.name === target.full);
  if (existingBranch) {
    throw new UserError(`Branch '${target.full}' already exists`);
  }

  // Get state data for ZFS config
  const stateData = state.getState();

  // Generate new dataset name and password
  const datasetName = getDatasetName(target.project, target.branch);
  const password = generatePassword();

  // Restore backup from S3
  console.log();
  const backupManager = new BackupManager(backupConfig);
  const { mountPath } = await backupManager.pullBackup(
    source.full,
    stateData.zfsPool,
    stateData.zfsDatasetBase,
    datasetName,
    {
      from: options.from,
      pitr: options.pitr,
    }
  );

  // Create Docker container
  console.log();
  console.log(`Creating PostgreSQL container...`);
  const docker = new DockerManager();
  const containerName = `velo-${target.project}-${target.branch}`;

  // Get WAL archive path and use project's SSL cert directory
  const walManager = new WALManager();
  const walArchivePath = walManager.getArchivePath(datasetName);
  const sslCertDir = project.sslCertDir;

  // Ensure WAL archive directory exists
  await walManager.ensureArchiveDir(datasetName);

  const containerID = await docker.createContainer({
    name: containerName,
    image: project.dockerImage,
    port: 0, // Let Docker assign a random port
    dataPath: mountPath,
    walArchivePath,
    sslCertDir,
    password,
    username: 'postgres',
    database: 'postgres',
  });

  await docker.startContainer(containerID);
  await docker.waitForHealthy(containerID);

  // Get assigned port
  const port = await docker.getContainerPort(containerID);

  // Add branch to state
  // If restoring the main branch, set isPrimary to true
  const isPrimary = target.branch === 'main';

  await state.addBranch(project.id, {
    name: target.full,
    projectName: target.project,
    zfsDataset: datasetName,
    dockerContainerId: containerID,
    port,
    password,
    isPrimary,
    createdAt: new Date(),
  });

  await state.save();

  console.log();
  console.log(chalk.green('✓'), 'Backup restored successfully');
  console.log();
  console.log(chalk.bold('Connection details:'));
  console.log(`  Host:     ${chalk.cyan('localhost')}`);
  console.log(`  Port:     ${chalk.cyan(port)}`);
  console.log(`  Database: ${chalk.cyan('postgres')}`);
  console.log(`  User:     ${chalk.cyan('postgres')}`);
  console.log(`  Password: ${chalk.cyan(password)}`);
  console.log();
  console.log(`  ${chalk.dim(`psql -h localhost -p ${port} -U postgres`)}`);
  console.log();

  if (options.pitr) {
    console.log(chalk.yellow('ℹ'), `Database recovered to: ${options.pitr}`);
    console.log();
  }
}
