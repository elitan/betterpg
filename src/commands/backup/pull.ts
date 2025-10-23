import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { BackupManager } from '../../managers/backup';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { UserError, SystemError } from '../../errors';
import { CLI_NAME } from '../../config/constants';

export interface BackupPullOptions {
  from?: string;   // Specific backup ID to restore from
  pitr?: string;   // Point-in-time recovery timestamp
}

export async function backupPullCommand(branchName: string, options: BackupPullOptions = {}) {
  const target = parseNamespace(branchName);

  console.log();
  console.log(`Restoring ${chalk.bold(target.full)} from backup...`);
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

  // Get state data for ZFS config
  const stateData = state.getState();

  // Restore backup from S3
  const backupManager = new BackupManager(backupConfig);
  await backupManager.pullBackup(
    target.full,
    stateData.zfsPool,
    stateData.zfsDatasetBase,
    options
  );

  console.log();
  console.log(chalk.green('✓'), 'Backup restored successfully');
  console.log();
}
