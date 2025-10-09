import ora from 'ora';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { generateUUID, formatTimestamp } from '../../utils/helpers';
import { Snapshot } from '../../types/state';

export interface SnapshotCreateOptions {
  label?: string;
}

export async function snapshotCreateCommand(branchName: string, options: SnapshotCreateOptions = {}) {
  const target = parseNamespace(branchName);

  console.log();
  console.log(chalk.bold(`📸 Creating snapshot of ${chalk.cyan(target.full)}`));
  if (options.label) {
    console.log(chalk.dim(`Label: ${options.label}`));
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

  // If branch is running, execute CHECKPOINT before snapshot
  if (branch.status === 'running') {
    const { DockerManager } = await import('../../managers/docker');
    const docker = new DockerManager();

    const containerID = await docker.getContainerByName(branch.containerName);
    if (!containerID) {
      throw new Error(`Container ${branch.containerName} not found`);
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
  const datasetName = branch.zfsDataset.split('/').pop() || '';
  const snapshotName = options.label
    ? `${snapshotTimestamp}-${options.label}`
    : snapshotTimestamp;

  const spinner = ora('Creating ZFS snapshot').start();
  await zfs.createSnapshot(datasetName, snapshotName);
  const fullSnapshotName = `${branch.zfsDataset}@${snapshotName}`;
  spinner.succeed(`Created snapshot: ${chalk.cyan(snapshotName)}`);

  // Get snapshot size
  const sizeBytes = await zfs.getSnapshotSize(fullSnapshotName);

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
  console.log(chalk.green.bold('✓ Snapshot created successfully!'));
  console.log();
  console.log(chalk.dim('Snapshot ID:  '), snapshot.id);
  console.log(chalk.dim('Branch:       '), target.full);
  console.log(chalk.dim('ZFS Snapshot: '), snapshotName);
  console.log(chalk.dim('Created:      '), new Date(snapshot.createdAt).toLocaleString());
  console.log();
}
