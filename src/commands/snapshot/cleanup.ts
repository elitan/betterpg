import ora from 'ora';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { ConfigManager } from '../../managers/config';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

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
    console.log(chalk.bold(`🧹 Cleaning up snapshots older than ${options.days} days (all branches)`));
  } else if (branchName) {
    const target = parseNamespace(branchName);
    console.log(chalk.bold(`🧹 Cleaning up snapshots for ${chalk.cyan(target.full)}`));
    console.log(chalk.dim(`Retention: ${options.days} days`));
  } else {
    throw new Error('Must specify branch name or use --all flag');
  }

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run - no snapshots will be deleted'));
  }
  console.log();

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);

  let deleted: any[] = [];

  if (options.all) {
    // Clean up snapshots across all branches
    const spinner = ora('Finding old snapshots').start();
    deleted = await state.deleteOldSnapshots(undefined, options.days, options.dryRun);
    spinner.succeed(`Found ${deleted.length} snapshot(s) to delete`);
  } else if (branchName) {
    // Clean up snapshots for specific branch
    const target = parseNamespace(branchName);

    const db = await state.getDatabaseByName(target.database);
    if (!db) {
      throw new Error(`Database '${target.database}' not found`);
    }

    const branch = db.branches.find(b => b.name === target.full);
    if (!branch) {
      throw new Error(`Branch '${target.full}' not found`);
    }

    const spinner = ora('Finding old snapshots').start();
    deleted = await state.deleteOldSnapshots(branch.name, options.days, options.dryRun);
    spinner.succeed(`Found ${deleted.length} snapshot(s) to delete`);
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
    const deleteSpinner = ora('Deleting ZFS snapshots').start();
    for (const snap of deleted) {
      try {
        await zfs.destroySnapshot(snap.zfsSnapshot);
      } catch (error: any) {
        deleteSpinner.warn(`Failed to delete snapshot ${snap.id}: ${error.message}`);
      }
    }
    deleteSpinner.succeed(`Deleted ${deleted.length} snapshot(s)`);
  }

  console.log();
  console.log(chalk.green.bold(`✓ Cleanup ${options.dryRun ? 'preview' : 'complete'}!`));
  console.log();
}
