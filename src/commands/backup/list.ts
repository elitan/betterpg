import chalk from 'chalk';
import Table from 'cli-table3';
import { StateManager } from '../../managers/state';
import { BackupManager } from '../../managers/backup';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { formatBytes } from '../../utils/helpers';
import { formatDistanceToNow } from 'date-fns';
import { UserError } from '../../errors';
import { CLI_NAME } from '../../config/constants';

export async function backupListCommand(branchName?: string) {
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

  // Parse branch name if provided
  let target;
  if (branchName) {
    target = parseNamespace(branchName);
    console.log(`Backups for ${chalk.bold(target.full)}:`);
  } else {
    console.log('All backups:');
  }
  console.log();

  // List backups from S3
  const backupManager = new BackupManager(backupConfig);
  const backups = await backupManager.listBackups(branchName);

  if (backups.length === 0) {
    console.log(chalk.dim('No backups found'));
    console.log();
    if (branchName) {
      console.log(`Create a backup with: ${CLI_NAME} backup push ${branchName}`);
    } else {
      console.log(`Create a backup with: ${CLI_NAME} backup push <project>/<branch>`);
    }
    console.log();
    return;
  }

  // Create table
  const table = new Table({
    head: ['Branch', 'Snapshot', 'Age', 'Size', 'WAL Files'].map(h => chalk.bold(h)),
    style: {
      head: [],
      border: ['dim'],
    },
  });

  for (const backup of backups) {
    table.push([
      backup.branchName,
      chalk.dim(backup.snapshotName),
      formatDistanceToNow(backup.timestamp, { addSuffix: true }),
      formatBytes(backup.sizeBytes),
      backup.walFileCount > 0
        ? `${backup.walFileCount} (${formatBytes(backup.walSizeBytes)})`
        : chalk.dim('-'),
    ]);
  }

  console.log(table.toString());
  console.log();
}
