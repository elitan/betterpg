import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';
import { PATHS } from '../utils/paths';

export async function resetCommand(name: string) {
  console.log();
  console.log(chalk.bold(`🔄 Resetting branch: ${chalk.cyan(name)}`));
  console.log();

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const branchResult = await state.getBranch(name);

  if (!branchResult) {
    throw new Error(`Branch '${name}' not found. Only branches can be reset.`);
  }

  const { branch, database: parentDb } = branchResult;

  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
  const docker = new DockerManager();

  const containerID = await docker.getContainerByName(branch.containerName);
  if (!containerID) {
    throw new Error(`Container '${branch.containerName}' not found`);
  }

  // Stop and remove container
  let spinner = ora('Stopping container').start();
  await docker.stopContainer(containerID);
  await docker.removeContainer(containerID);
  spinner.succeed('Container removed');

  // Destroy and re-clone ZFS dataset
  spinner = ora('Destroying ZFS dataset').start();
  await zfs.destroyDataset(branch.name);
  spinner.succeed('Dataset destroyed');

  spinner = ora(`Re-cloning from snapshot: ${branch.snapshotName}`).start();
  await zfs.cloneSnapshot(branch.snapshotName, branch.name);
  spinner.succeed('Clone created');

  const mountpoint = await zfs.getMountpoint(branch.name);

  // Create WAL archive directory
  const walArchivePath = `${PATHS.WAL_ARCHIVE}/${branch.name}`;
  await Bun.write(walArchivePath + '/.keep', '');

  // Recreate container
  spinner = ora('Recreating container').start();
  const newContainerID = await docker.createContainer({
    name: branch.containerName,
    version: cfg.postgres.version,
    port: branch.port,
    dataPath: mountpoint,
    walArchivePath,
    password: parentDb.credentials.password,
    username: parentDb.credentials.username,
    database: parentDb.credentials.database,
    sharedBuffers: cfg.postgres.config.shared_buffers,
    maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
  });

  await docker.startContainer(newContainerID);
  spinner.text = 'Waiting for PostgreSQL to be ready';
  await docker.waitForHealthy(newContainerID);
  spinner.succeed('PostgreSQL is ready');

  // Update state
  const sizeBytes = await zfs.getUsedSpace(branch.name);
  branch.sizeBytes = sizeBytes;
  branch.status = 'running';
  await state.updateBranch(parentDb.id, branch);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' has been reset to parent snapshot!`));
  console.log(chalk.dim('   Port:'), chalk.cyan(branch.port.toString()));
  console.log();
}
