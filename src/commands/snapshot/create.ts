import ora from 'ora';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { generateUUID, formatTimestamp } from '../../utils/helpers';
import { Snapshot } from '../../types/state';
import { getContainerName, getDatasetName, getDatasetPath } from '../../utils/naming';

export interface SnapshotCreateOptions {
  label?: string;
}

export async function snapshotCreateCommand(branchName: string, options: SnapshotCreateOptions = {}) {
  const target = parseNamespace(branchName);

  console.log();
  if (options.label) {
    console.log(`Creating snapshot of ${chalk.cyan(target.full)} (${chalk.dim(options.label)})...`);
  } else {
    console.log(`Creating snapshot of ${chalk.cyan(target.full)}...`);
  }
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Find the branch
  const proj = await state.getProjectByName(target.project);
  if (!proj) {
    throw new Error(`Project '${target.project}' not found`);
  }

  const branch = proj.branches.find(b => b.name === target.full);
  if (!branch) {
    throw new Error(`Branch '${target.full}' not found`);
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // Compute names
  const containerName = getContainerName(target.project, target.branch);
  const datasetName = getDatasetName(target.project, target.branch);
  const datasetPath = getDatasetPath(stateData.zfsPool, stateData.zfsDatasetBase, target.project, target.branch);

  // If branch is running, execute CHECKPOINT before snapshot
  if (branch.status === 'running') {
    const { DockerManager } = await import('../../managers/docker');
    const docker = new DockerManager();

    const containerID = await docker.getContainerByName(containerName);
    if (!containerID) {
      throw new Error(`Container ${containerName} not found`);
    }

    const spinner = ora('Running CHECKPOINT').start();
    try {
      await docker.execSQL(containerID, 'CHECKPOINT;', proj.credentials.username);
      spinner.succeed('CHECKPOINT completed');
    } catch (error: any) {
      spinner.fail('CHECKPOINT failed');
      throw error;
    }
  }

  // Create ZFS snapshot
  const snapshotTimestamp = formatTimestamp(new Date());
  const snapshotName = options.label
    ? `${snapshotTimestamp}-${options.label}`
    : snapshotTimestamp;

  const snapshotStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Create snapshot'));
  await zfs.createSnapshot(datasetName, snapshotName);
  const fullSnapshotName = `${datasetPath}@${snapshotName}`;
  const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Create snapshot'.length)}${snapshotTime}s`));

  // Get snapshot size
  const sizeStart = Date.now();
  process.stdout.write(chalk.dim('  ▸ Calculate size'));
  const sizeBytes = await zfs.getSnapshotSize(fullSnapshotName);
  const sizeTime = ((Date.now() - sizeStart) / 1000).toFixed(1);
  console.log(chalk.dim(`${' '.repeat(40 - 'Calculate size'.length)}${sizeTime}s`));

  // Create snapshot record
  const snapshot: Snapshot = {
    id: generateUUID(),
    branchId: branch.id,
    branchName: branch.name,
    projectName: target.project,
    zfsSnapshot: fullSnapshotName,
    createdAt: new Date().toISOString(),
    label: options.label,
    sizeBytes,
  };

  await state.addSnapshot(snapshot);

  console.log();
  console.log('Snapshot created:');
  console.log(`  ID: ${snapshot.id}`);
  console.log(`  Name: ${snapshotName}`);
  console.log();
}
