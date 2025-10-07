import ora from 'ora';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { ConfigManager } from '../../managers/config';
import { PATHS } from '../../utils/paths';

export async function snapshotDeleteCommand(snapshotId: string) {
  console.log();
  console.log(chalk.bold(`🗑️  Deleting snapshot: ${chalk.cyan(snapshotId)}`));
  console.log();

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Find the snapshot
  const snapshot = await state.getSnapshotById(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);

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
