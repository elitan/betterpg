import { $ } from 'bun';
import ora from 'ora';
import chalk from 'chalk';
import { ZFSManager } from '../managers/zfs';
import { StateManager } from '../managers/state';
import { ConfigManager, DEFAULT_CONFIG } from '../managers/config';
import { PATHS } from '../utils/paths';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function initCommand(options: { pool?: string; datasetBase?: string } = {}) {
  console.log();
  console.log(chalk.bold('🚀 Initializing betterpg'));
  console.log();

  // Check if already initialized
  try {
    await fs.access(PATHS.STATE);
    console.log(chalk.yellow('⚠️  betterpg is already initialized'));
    console.log(chalk.dim(`   State file exists at: ${PATHS.STATE}`));
    console.log();
    return;
  } catch {
    // Not initialized, continue
  }

  // Use provided options or defaults
  const pool = options.pool || DEFAULT_CONFIG.zfs.pool;
  const datasetBase = options.datasetBase || DEFAULT_CONFIG.zfs.datasetBase;

  // Initialize ZFS
  const spinner = ora(`Checking ZFS pool: ${pool}`).start();
  const zfs = new ZFSManager(pool, datasetBase);

  const poolExists = await zfs.poolExists();
  if (!poolExists) {
    spinner.fail(`ZFS pool '${pool}' not found`);
    console.log(chalk.dim(`   Please create the pool first with: zpool create ${pool} <device>`));
    console.log();
    throw new Error(`ZFS pool '${pool}' not found`);
  }

  spinner.succeed(`ZFS pool found: ${pool}`);

  // Create base dataset
  const datasetSpinner = ora(`Creating base dataset: ${pool}/${datasetBase}`).start();

  try {
    await $`zfs list ${pool}/${datasetBase}`.quiet();
    datasetSpinner.succeed(`Base dataset already exists: ${pool}/${datasetBase}`);
  } catch {
    await $`sudo zfs create -p -o compression=${DEFAULT_CONFIG.zfs.compression} -o recordsize=${DEFAULT_CONFIG.zfs.recordsize} ${pool}/${datasetBase}`;
    datasetSpinner.succeed(`Created base dataset: ${pool}/${datasetBase}`);
  }

  // Create config directory and file
  const configSpinner = ora('Creating configuration').start();
  await fs.mkdir(PATHS.CONFIG_DIR, { recursive: true });

  const config = new ConfigManager(PATHS.CONFIG);
  await config.createDefault();
  configSpinner.succeed(`Config created at: ${PATHS.CONFIG}`);

  // Create state directory and file
  const stateSpinner = ora('Initializing state').start();
  await fs.mkdir(PATHS.DATA_DIR, { recursive: true });

  const state = new StateManager(PATHS.STATE);
  await state.initialize(pool, datasetBase);
  stateSpinner.succeed(`State initialized at: ${PATHS.STATE}`);

  // Create WAL archive directory
  await fs.mkdir(PATHS.WAL_ARCHIVE, { recursive: true });

  console.log();
  console.log(chalk.green.bold('✓ betterpg initialized successfully!'));
  console.log();
  console.log(chalk.bold('Next steps:'));
  console.log(chalk.dim('  1. Create a database:'), chalk.cyan('bpg create myapp-prod'));
  console.log(chalk.dim('  2. Create a branch:  '), chalk.cyan('bpg branch myapp-prod myapp-dev'));
  console.log();
}
