import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { CLI_NAME } from '../../config/constants';

export async function stateRestoreCommand() {
  console.log();
  console.log(chalk.bold(`${CLI_NAME} State Restore`));
  console.log();

  const state = new StateManager(PATHS.STATE);

  // Check if backup exists
  const backupInfo = await state.getBackupInfo();

  if (!backupInfo.exists) {
    console.log(chalk.yellow('No backup file found.'));
    console.log();
    console.log('Backups are created automatically before each state modification.');
    console.log(`Location: ${PATHS.STATE}.backup`);
    console.log();
    return;
  }

  // Show backup info
  console.log(chalk.dim('Backup file found:'));
  console.log(chalk.dim(`  Location: ${PATHS.STATE}.backup`));
  console.log(chalk.dim(`  Modified: ${backupInfo.modifiedAt?.toLocaleString()}`));
  console.log(chalk.dim(`  Size: ${Math.round((backupInfo.size || 0) / 1024)}KB`));
  console.log();

  // Confirm restore
  console.log(chalk.yellow('⚠️  This will replace your current state file with the backup.'));
  console.log();

  const response = prompt('Are you sure you want to restore from backup? (yes/no): ');

  if (response?.toLowerCase() !== 'yes') {
    console.log();
    console.log('Restore cancelled.');
    console.log();
    return;
  }

  // Perform restore
  try {
    await state.restoreFromBackup();
    console.log();
    console.log(chalk.green('✓ State restored from backup successfully.'));
    console.log();
    console.log('Your previous state has been restored.');
    console.log(`Run ${chalk.bold(`${CLI_NAME} status`)} to verify.`);
    console.log();
  } catch (error: any) {
    console.log();
    console.log(chalk.red('✗ Failed to restore state:'), error.message);
    console.log();
  }
}
