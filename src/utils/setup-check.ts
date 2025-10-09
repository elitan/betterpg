import chalk from 'chalk';
import { $ } from 'bun';
import { getZFSPool } from './zfs-pool';
import { DEFAULTS } from '../config/defaults';

/**
 * Check if pgd setup has been completed
 * Returns true if setup is complete, false otherwise
 */
export async function isSetupComplete(): Promise<boolean> {
  try {
    // Skip check if running as root
    if (process.getuid && process.getuid() === 0) {
      return true;
    }

    // Check 1: ZFS pool exists
    let pool: string;
    try {
      pool = await getZFSPool();
    } catch (error) {
      return false; // No ZFS pool found
    }

    // Check 2: ZFS permissions are granted
    const datasetPath = `${pool}/${DEFAULTS.zfs.datasetBase}`;
    try {
      // Try to check permissions - if this fails, delegation is not set up
      const allowOutput = await $`zfs allow ${datasetPath}`.quiet().text();
      const currentUser = await $`whoami`.text();
      const username = currentUser.trim();

      // Check if current user has required permissions
      if (!allowOutput.includes(username)) {
        return false;
      }
    } catch (error) {
      return false; // ZFS permissions not configured
    }

    // Check 3: User is in docker group
    try {
      const groups = await $`groups`.text();
      if (!groups.includes('docker')) {
        return false;
      }
    } catch (error) {
      return false;
    }

    // Check 4: User is in pgd group
    try {
      const groups = await $`groups`.text();
      if (!groups.includes('pgd')) {
        return false;
      }
    } catch (error) {
      return false;
    }

    // We intentionally skip checking if /etc/sudoers.d/pgd exists because:
    // - Regular users cannot read sudoers files (they have mode 0440, root-only readable)
    // - The test would always fail even when setup is complete
    // - Verifying pgd group membership (above) is sufficient proof that setup ran successfully
    // - If the sudoers file is somehow missing, ZFS mount/unmount operations will fail with clear sudo errors

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Display setup error message and exit
 */
export function displaySetupError(): never {
  console.log();
  console.log(chalk.red('✗ pgd setup not complete'));
  console.log();
  console.log('pgd requires one-time setup to configure permissions.');
  console.log();
  console.log('Run the following command:');
  console.log(chalk.cyan('  sudo pgd setup'));
  console.log();
  console.log('This will:');
  console.log('  • Detect ZFS pool');
  console.log('  • Grant ZFS delegation permissions');
  console.log('  • Add you to docker and pgd groups');
  console.log('  • Configure minimal sudoers for mount/unmount');
  console.log();
  console.log('After setup, log out and back in, then verify with:');
  console.log(chalk.cyan('  pgd doctor'));
  console.log();
  process.exit(1);
}

/**
 * Check setup and display error if not complete
 * Call this at the start of commands that require setup
 */
export async function requireSetup(): Promise<void> {
  const isComplete = await isSetupComplete();
  if (!isComplete) {
    displaySetupError();
  }
}
