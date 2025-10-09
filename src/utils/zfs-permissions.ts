import { $ } from 'bun';
import chalk from 'chalk';

/**
 * Required ZFS permissions for pgd to operate without sudo
 */
const REQUIRED_PERMISSIONS = [
  'create',
  'destroy',
  'snapshot',
  'clone',
  'mount',
  'promote',
];

/**
 * Check if current user has ZFS delegation permissions on a dataset
 */
export async function checkZFSPermissions(pool: string, datasetBase: string): Promise<boolean> {
  try {
    const dataset = `${pool}/${datasetBase}`;

    // Check if dataset exists
    const datasetExists = await $`zfs list ${dataset}`.quiet().then(() => true).catch(() => false);

    if (!datasetExists) {
      return false;
    }

    // Get permissions for current user
    const output = await $`zfs allow ${dataset}`.text();
    const username = process.env.USER || process.env.USERNAME || '';

    if (!username) {
      return false;
    }

    // Parse output to find user permissions
    // Format: "user johan create,destroy,snapshot,clone,mount,promote,..."
    const lines = output.split('\n');
    let userPermissions: string[] = [];

    for (const line of lines) {
      // Look for lines starting with the username
      const match = line.match(new RegExp(`user ${username}\\s+(.+)`));
      if (match) {
        userPermissions = match[1].split(',').map(p => p.trim());
        break;
      }
    }

    // Check if user has all required permissions
    for (const perm of REQUIRED_PERMISSIONS) {
      if (!userPermissions.includes(perm)) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate ZFS permissions and provide helpful error message if missing
 * Throws error if permissions are not set up correctly
 *
 * Skips validation if running as root (for tests and setup scripts)
 */
export async function validateZFSPermissions(pool: string, datasetBase: string): Promise<void> {
  // Skip validation if running as root (tests, sudo operations)
  if (process.getuid && process.getuid() === 0) {
    return;
  }

  const hasPermissions = await checkZFSPermissions(pool, datasetBase);

  if (!hasPermissions) {
    const username = process.env.USER || process.env.USERNAME || 'current user';

    console.error();
    console.error(chalk.red.bold('✗ Missing ZFS Permissions'));
    console.error();
    console.error(chalk.yellow('pgd requires ZFS delegation permissions to operate without sudo.'));
    console.error();
    console.error(chalk.bold('To fix this, run the one-time setup:'));
    console.error();
    console.error(chalk.cyan('  sudo pgd setup'));
    console.error();
    console.error(chalk.dim('This will grant the necessary ZFS permissions to your user account.'));
    console.error(chalk.dim(`Dataset: ${pool}/${datasetBase}`));
    console.error(chalk.dim(`User: ${username}`));
    console.error();

    throw new Error('ZFS permissions not configured. Run: sudo pgd setup');
  }
}

/**
 * Check if user is in docker group (for Docker socket access)
 */
export async function checkDockerPermissions(): Promise<boolean> {
  try {
    // Try to run a simple docker command without sudo
    await $`docker ps`.quiet();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate Docker permissions and provide helpful error message if missing
 *
 * Skips validation if running as root (for tests and setup scripts)
 */
export async function validateDockerPermissions(): Promise<void> {
  // Skip validation if running as root (tests, sudo operations)
  if (process.getuid && process.getuid() === 0) {
    return;
  }

  const hasPermissions = await checkDockerPermissions();

  if (!hasPermissions) {
    const username = process.env.USER || process.env.USERNAME || 'current user';

    console.error();
    console.error(chalk.red.bold('✗ Missing Docker Permissions'));
    console.error();
    console.error(chalk.yellow('pgd requires Docker access without sudo.'));
    console.error();
    console.error(chalk.bold('To fix this, run the one-time setup:'));
    console.error();
    console.error(chalk.cyan('  sudo pgd setup'));
    console.error();
    console.error(chalk.dim('Then log out and log back in for the docker group to take effect.'));
    console.error(chalk.dim(`User: ${username}`));
    console.error();

    throw new Error('Docker permissions not configured. Run: sudo pgd setup and re-login.');
  }
}

/**
 * Validate all required permissions for pgd
 */
export async function validateAllPermissions(pool: string, datasetBase: string): Promise<void> {
  await validateDockerPermissions();
  await validateZFSPermissions(pool, datasetBase);
}
