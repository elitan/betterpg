import chalk from 'chalk';
import * as prompts from '@clack/prompts';
import { StateManager } from '../../managers/state';
import { BackupManager } from '../../managers/backup';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { UserError } from '../../errors';
import { CLI_NAME } from '../../config/constants';

export interface BackupCleanupOptions {
  days: number;
  dryRun?: boolean;
}

export async function backupCleanupCommand(branchName: string, options: BackupCleanupOptions) {
  const target = parseNamespace(branchName);

  console.log();
  console.log(`Cleaning up backups for ${chalk.bold(target.full)}...`);
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

  // Verify branch exists
  const proj = await state.getProjectByName(target.project);
  if (!proj) {
    throw new UserError(
      `Project '${target.project}' not found`,
      `Run '${CLI_NAME} project list' to see available projects`
    );
  }

  const branch = proj.branches.find(b => b.name === target.full);
  if (!branch) {
    throw new UserError(
      `Branch '${target.full}' not found`,
      `Run '${CLI_NAME} branch list' to see available branches`
    );
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - options.days);

  console.log(`Removing backups older than ${chalk.bold(options.days)} days`);
  console.log(`Cutoff date: ${chalk.dim(cutoffDate.toISOString())}`);
  console.log();

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run mode - no backups will be deleted'));
    console.log();
  }

  // Get state data for ZFS config
  const stateData = state.getState();

  // Cleanup old backups
  const backupManager = new BackupManager(backupConfig);

  if (options.dryRun) {
    // List backups that would be deleted
    const allBackups = await backupManager.listBackups(target.full);
    const oldBackups = allBackups.filter(b => b.timestamp < cutoffDate);

    if (oldBackups.length === 0) {
      console.log(chalk.dim('No backups to delete'));
      console.log();
      return;
    }

    console.log(`Would delete ${chalk.bold(oldBackups.length)} backup(s):`);
    console.log();
    for (const backup of oldBackups) {
      console.log(`  ${chalk.dim('•')} ${backup.snapshotName} (${backup.timestamp.toISOString()})`);
    }
    console.log();
    console.log(`Run without ${chalk.bold('--dry-run')} to delete these backups`);
    console.log();
    return;
  }

  // Confirm deletion
  const confirm = await prompts.confirm({
    message: `Delete all backups older than ${options.days} days?`,
  });

  if (prompts.isCancel(confirm) || !confirm) {
    console.log();
    console.log(chalk.dim('Cancelled'));
    console.log();
    return;
  }

  console.log();
  const deletedCount = await backupManager.cleanupBackups(target.full, options.days);

  console.log();
  if (deletedCount > 0) {
    console.log(chalk.green('✓'), `Deleted ${chalk.bold(deletedCount)} backup(s)`);
  } else {
    console.log(chalk.dim('No backups to delete'));
  }
  console.log();
}
