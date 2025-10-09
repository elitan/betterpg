import ora from 'ora';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';

export async function snapshotDeleteCommand(snapshotId: string) {
  console.log();
  console.log(`Deleting snapshot ${chalk.cyan(snapshotId)}...`);
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Find the snapshot
  const snapshot = await state.getSnapshotById(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // Delete ZFS snapshot
  const spinner = ora('Deleting ZFS snapshot').start();
  await zfs.destroySnapshot(snapshot.zfsSnapshot);
  spinner.succeed('ZFS snapshot deleted');

  // Remove from state
  await state.deleteSnapshot(snapshotId);

  console.log();
  console.log(chalk.green.bold('✓ Snapshot deleted successfully!'));
  console.log();
}
