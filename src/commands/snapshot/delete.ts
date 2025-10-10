import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';
import { UserError } from '../../errors';
import { withProgress } from '../../utils/progress';

export async function snapshotDeleteCommand(snapshotId: string) {
  console.log();
  console.log(`Deleting snapshot ${chalk.cyan(snapshotId)}...`);
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Find the snapshot
  const snapshot = await state.getSnapshotById(snapshotId);
  if (!snapshot) {
    throw new UserError(
      `Snapshot not found: ${snapshotId}`,
      "Run 'pgd snapshot list' to see available snapshots"
    );
  }

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  // Delete ZFS snapshot
  await withProgress('Delete ZFS snapshot', async () => {
    await zfs.destroySnapshot(snapshot.zfsSnapshot);
  });

  // Remove from state
  await state.deleteSnapshot(snapshotId);

  console.log();
  console.log(chalk.green.bold('✓ Snapshot deleted successfully!'));
  console.log();
}
