import chalk from 'chalk';
import * as prompts from '@clack/prompts';
import { StateManager } from '../../managers/state';
import { BackupManager } from '../../managers/backup';
import { PATHS } from '../../utils/paths';
import { UserError } from '../../errors';
import type { BackupConfig } from '../../types/state';

/**
 * Initialize backup configuration with S3
 * This is an optional one-time setup that can be done anytime after project creation
 */
export async function backupInitCommand() {
  console.log();
  console.log(chalk.bold('Initialize Backup Configuration'));
  console.log(chalk.dim('═'.repeat(60)));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  if (!state.isInitialized()) {
    throw new UserError('Velo is not initialized. Create a project first with: velo project create <name>');
  }

  const stateData = state.getState();

  // Check if backup is already configured
  if (stateData.backupConfig) {
    console.log(chalk.yellow('⚠'), 'Backup is already configured');
    console.log();
    console.log('Current configuration:');
    console.log(`  Endpoint: ${stateData.backupConfig.endpoint}`);
    console.log(`  Bucket: ${stateData.backupConfig.bucket}`);
    console.log();

    const overwrite = await prompts.confirm({
      message: 'Do you want to reconfigure backup?',
    });

    if (prompts.isCancel(overwrite) || !overwrite) {
      console.log();
      console.log(chalk.dim('Backup configuration unchanged'));
      console.log();
      return;
    }
  }

  console.log('S3-compatible storage configuration:');
  console.log();

  // Prompt for S3 configuration
  const endpoint = await prompts.text({
    message: 'S3 Endpoint',
    placeholder: 'localhost:9000, s3.amazonaws.com, s3.us-west-002.backblazeb2.com',
    validate: (value) => {
      if (!value) return 'Endpoint is required';
      return;
    },
  });

  if (prompts.isCancel(endpoint)) {
    console.log();
    console.log(chalk.dim('Cancelled'));
    console.log();
    process.exit(0);
  }

  const bucket = await prompts.text({
    message: 'Bucket Name',
    placeholder: 'velo-backup',
    validate: (value) => {
      if (!value) return 'Bucket name is required';
      return;
    },
  });

  if (prompts.isCancel(bucket)) {
    console.log();
    console.log(chalk.dim('Cancelled'));
    console.log();
    process.exit(0);
  }

  const accessKeyId = await prompts.text({
    message: 'Access Key ID',
    validate: (value) => {
      if (!value) return 'Access key ID is required';
      return;
    },
  });

  if (prompts.isCancel(accessKeyId)) {
    console.log();
    console.log(chalk.dim('Cancelled'));
    console.log();
    process.exit(0);
  }

  const secretAccessKey = await prompts.password({
    message: 'Secret Access Key',
    validate: (value) => {
      if (!value) return 'Secret access key is required';
      return;
    },
  });

  if (prompts.isCancel(secretAccessKey)) {
    console.log();
    console.log(chalk.dim('Cancelled'));
    console.log();
    process.exit(0);
  }

  const repositoryPath = await prompts.text({
    message: 'Repository Path (in S3 bucket)',
    placeholder: 'velo-repo',
    initialValue: 'velo-repo',
  });

  if (prompts.isCancel(repositoryPath)) {
    console.log();
    console.log(chalk.dim('Cancelled'));
    console.log();
    process.exit(0);
  }

  // Create backup configuration
  const backupConfig: BackupConfig = {
    provider: 's3',
    endpoint: endpoint as string,
    bucket: bucket as string,
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    repositoryPath: repositoryPath as string,
    kopiaConfigPath: `${PATHS.BASE_DIR}/kopia`,
  };

  console.log();
  const spinner = prompts.spinner();
  spinner.start('Initializing Kopia repository...');

  try {
    // Initialize Kopia repository
    const backupManager = new BackupManager(backupConfig);
    await backupManager.initRepository();

    // Save configuration to state
    state.setBackupConfig(backupConfig);
    await state.save();

    spinner.stop('Backup configured successfully');
    console.log();
    console.log(chalk.green('✓'), 'Backup is now ready to use');
    console.log();
    console.log('Next steps:');
    console.log(`  ${chalk.dim('•')} Backup a branch: velo backup push <project>/<branch>`);
    console.log(`  ${chalk.dim('•')} List backups: velo backup list`);
    console.log();
  } catch (error: any) {
    spinner.stop('Failed to initialize backup');
    throw error;
  }
}
