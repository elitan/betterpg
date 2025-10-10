import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { UserError } from '../../errors';
import { withProgress } from '../../utils/progress';

export interface SnapshotCleanupOptions {
  days: number;
  dryRun?: boolean;
  all?: boolean;
}

export async function snapshotCleanupCommand(
  branchName: string | undefined,
  options: SnapshotCleanupOptions
) {
  console.log();
  if (options.all) {
    console.log(chalk.bold(`Cleaning up snapshots older than ${options.days} days (all branches)`));
  } else if (branchName) {
    const target = parseNamespace(branchName);
    console.log(chalk.bold(`Cleaning up snapshots for ${chalk.cyan(target.full)}`));
    console.log(chalk.dim(`Retention: ${options.days} days`));
  } else {
    throw new UserError(
      'Must specify branch name or use --all flag',
      "Usage: 'pgd snapshot cleanup <project>/<branch> --days <n>' or 'pgd snapshot cleanup --all --days <n>'"
    );
  }

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run - no snapshots will be deleted'));
  }
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  // Get ZFS config from state
  const stateData = state.getState();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);

  let deleted: any[] = [];

  if (options.all) {
    // Clean up snapshots across all branches
    deleted = await withProgress('Find old snapshots', async () => {
      return await state.deleteOldSnapshots(undefined, options.days, options.dryRun);
    });
    console.log(`Found ${deleted.length} snapshot(s) to delete`);
  } else if (branchName) {
    // Clean up snapshots for specific branch
    const target = parseNamespace(branchName);

    const proj = await state.getProjectByName(target.project);
    if (!proj) {
      throw new UserError(
        `Project '${target.project}' not found`,
        "Run 'pgd project list' to see available projects"
      );
    }

    const branch = proj.branches.find(b => b.name === target.full);
    if (!branch) {
      throw new UserError(
        `Branch '${target.full}' not found`,
        "Run 'pgd branch list' to see available branches"
      );
    }

    deleted = await withProgress('Find old snapshots', async () => {
      return await state.deleteOldSnapshots(branch.name, options.days, options.dryRun);
    });
    console.log(`Found ${deleted.length} snapshot(s) to delete`);
  }

  if (deleted.length === 0) {
    console.log(chalk.green('No snapshots to clean up'));
    console.log();
    return;
  }

  // Display what will be deleted
  console.log();
  for (const snap of deleted) {
    const age = Math.floor(
      (Date.now() - new Date(snap.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    console.log(
      chalk.dim('  •'),
      snap.label || snap.id.substring(0, 8),
      chalk.dim(`(${snap.branchName}, ${age} days old)`)
    );
  }
  console.log();

  if (!options.dryRun) {
    // Delete the actual ZFS snapshots
    await withProgress('Delete ZFS snapshots', async () => {
      for (const snap of deleted) {
        try {
          await zfs.destroySnapshot(snap.zfsSnapshot);
        } catch (error: any) {
          console.log();
          console.log(chalk.yellow(`Warning: Failed to delete snapshot ${snap.id}: ${error.message}`));
        }
      }
    });
    console.log(`Deleted ${deleted.length} snapshot(s)`);
  }

  console.log();
  console.log(chalk.green.bold(`✓ Cleanup ${options.dryRun ? 'preview' : 'complete'}!`));
  console.log();
}
