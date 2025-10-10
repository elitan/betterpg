import chalk from 'chalk';
import { $ } from 'bun';
import * as fs from 'fs/promises';

/**
 * Setup command - grants ZFS permissions and configures Docker access
 * This must be run with sudo as it modifies system permissions
 */
export async function setupCommand() {
  // Check if running as root/sudo
  const isRoot = process.getuid && process.getuid() === 0;

  if (!isRoot) {
    console.log();
    console.log(chalk.red('✗ This command must be run with sudo'));
    console.log();
    console.log('Usage:');
    console.log('  sudo pgd setup');
    console.log();
    console.log('This one-time setup will:');
    console.log('  • Detect ZFS pool');
    console.log('  • Grant ZFS delegation permissions');
    console.log('  • Add user to docker group');
    console.log('  • Create pgd group');
    console.log('  • Install minimal sudoers config for mount/unmount');
    console.log();
    process.exit(1);
  }

  // Get the actual user (not root)
  const actualUser = process.env.SUDO_USER || process.env.USER;

  if (!actualUser || actualUser === 'root') {
    console.log();
    console.log(chalk.red('✗ Could not determine target user'));
    console.log('Please run with sudo as a regular user, not as root directly');
    console.log();
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold('pgd Permission Setup'));
  console.log(chalk.dim('═'.repeat(60)));
  console.log();
  console.log(`User: ${chalk.green(actualUser)}`);
  console.log();

  // Step 1: Check ZFS
  console.log(chalk.yellow('[1/5]'), 'Checking ZFS installation...');

  try {
    // Try standard locations for ZFS binaries
    // Bun's $ shell in compiled binaries might not have PATH set correctly
    try {
      await $`/usr/sbin/zpool status`.quiet();
    } catch (error) {
      // Fallback to PATH-based command
      await $`zpool status`.quiet();
    }
    console.log(chalk.green('✓'), 'ZFS is installed');
  } catch (error) {
    console.log(chalk.red('✗'), 'ZFS is not installed');
    console.log();
    console.log('Install ZFS first:');
    console.log('  Ubuntu/Debian: sudo apt install zfsutils-linux');
    console.log();
    process.exit(1);
  }
  console.log();

  // Step 2: Detect ZFS pool
  console.log(chalk.yellow('[2/5]'), 'Detecting ZFS pools...');

  let pool: string;
  try {
    // Use full path to ensure it works in compiled binary
    const poolsOutput = await $`/usr/sbin/zpool list -H -o name`.text();
    const pools = poolsOutput.trim().split('\n').filter(p => p);

    if (pools.length === 0) {
      console.log(chalk.red('✗'), 'No ZFS pools found');
      console.log();
      console.log('Create a ZFS pool first:');
      console.log('  Testing: sudo truncate -s 10G /tmp/zfs-pool.img && sudo zpool create tank /tmp/zfs-pool.img');
      console.log('  Production: sudo zpool create tank /dev/sdb');
      console.log();
      process.exit(1);
    }

    if (pools.length === 1) {
      pool = pools[0];
      console.log(chalk.green('✓'), `Found pool: ${chalk.green(pool)}`);
    } else {
      console.log('Multiple pools found:');
      pools.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      console.log();

      // Prompt for pool selection
      const stdin = Bun.stdin.stream();
      const reader = stdin.getReader();

      process.stdout.write('Enter pool name to use for pgd: ');

      const { value } = await reader.read();
      reader.releaseLock();

      const input = new TextDecoder().decode(value).trim();

      if (!pools.includes(input)) {
        console.log(chalk.red('✗'), `Pool '${input}' not found`);
        process.exit(1);
      }

      pool = input;
      console.log(chalk.green('✓'), `Using pool: ${chalk.green(pool)}`);
    }
  } catch (error) {
    console.log(chalk.red('✗'), 'Failed to detect ZFS pools');
    process.exit(1);
  }
  console.log();

  // Step 3: Grant ZFS permissions
  console.log(chalk.yellow('[3/5]'), 'Granting ZFS delegation permissions...');

  try {
    // Check if delegation is enabled
    const delegation = await $`/usr/sbin/zpool get -H -o value delegation ${pool}`.text();

    if (delegation.trim() !== 'on') {
      console.log('Enabling ZFS delegation on pool...');
      await $`/usr/sbin/zpool set delegation=on ${pool}`;
    }

    // Create base dataset if needed
    const baseDataset = `${pool}/pgd`;
    try {
      await $`/usr/sbin/zfs list ${baseDataset}`.quiet();
    } catch (error) {
      console.log(`Creating base dataset: ${baseDataset}`);
      await $`/usr/sbin/zfs create ${baseDataset}`;
    }

    // Create databases dataset if needed
    const databasesDataset = `${pool}/pgd/databases`;
    try {
      await $`/usr/sbin/zfs list ${databasesDataset}`.quiet();
    } catch (error) {
      console.log(`Creating databases dataset: ${databasesDataset}`);
      await $`/usr/sbin/zfs create ${databasesDataset}`;
    }

    // Grant permissions
    console.log(`Granting permissions to user '${actualUser}'...`);
    await $`/usr/sbin/zfs allow ${actualUser} create,destroy,snapshot,clone,mount ${databasesDataset}`;
    await $`/usr/sbin/zfs allow ${actualUser} promote,send,receive ${databasesDataset}`;
    await $`/usr/sbin/zfs allow ${actualUser} compression,recordsize,mountpoint,atime ${databasesDataset}`;

    console.log(chalk.green('✓'), 'ZFS permissions granted');
  } catch (error) {
    console.log(chalk.red('✗'), 'Failed to grant ZFS permissions');
    console.error(error);
    process.exit(1);
  }
  console.log();

  // Step 4: Configure Docker
  console.log(chalk.yellow('[4/5]'), 'Configuring Docker access...');

  try {
    await $`command -v docker`.quiet();

    // Check if docker group exists
    try {
      await $`getent group docker`.quiet();
    } catch (error) {
      console.log('Creating docker group...');
      await $`groupadd docker`;
    }

    // Check if user is in docker group
    const groups = await $`groups ${actualUser}`.text();

    if (!groups.includes('docker')) {
      console.log(`Adding user '${actualUser}' to docker group...`);
      await $`usermod -aG docker ${actualUser}`;
      console.log(chalk.green('✓'), 'User added to docker group');
    } else {
      console.log(chalk.green('✓'), 'User already in docker group');
    }
  } catch (error) {
    console.log(chalk.yellow('⚠'), 'Docker not installed (optional)');
    console.log('Install Docker before using pgd: https://docs.docker.com/engine/install/');
  }
  console.log();

  // Step 5: Install sudoers config
  console.log(chalk.yellow('[5/5]'), 'Installing sudoers configuration...');

  try {
    // Create pgd group if needed
    try {
      await $`getent group pgd`.quiet();
      console.log(chalk.green('✓'), 'pgd group exists');
    } catch (error) {
      console.log('Creating pgd group...');
      await $`groupadd pgd`;
      console.log(chalk.green('✓'), 'pgd group created');
    }

    // Add user to pgd group
    const pgdGroups = await $`groups ${actualUser}`.text();

    if (!pgdGroups.includes('pgd')) {
      console.log(`Adding user '${actualUser}' to pgd group...`);
      await $`usermod -aG pgd ${actualUser}`;
      console.log(chalk.green('✓'), 'User added to pgd group');
    } else {
      console.log(chalk.green('✓'), 'User already in pgd group');
    }

    // Create sudoers file
    const sudoersContent = `# pgd - PostgreSQL database branching tool
# This file grants minimal sudo permissions for ZFS mount/unmount operations only
# These operations require CAP_SYS_ADMIN capability on Linux

# Allow pgd group members to run ZFS mount/unmount commands without password
%pgd ALL=(ALL) NOPASSWD: /sbin/zfs mount *
%pgd ALL=(ALL) NOPASSWD: /sbin/zfs unmount *

# Security notes:
# - Only mount/unmount commands are allowed (not create, destroy, etc.)
# - All other ZFS operations use delegation (no sudo required)
# - This is much more secure than granting full sudo access
`;

    await fs.writeFile('/etc/sudoers.d/pgd', sudoersContent);
    await $`chmod 0440 /etc/sudoers.d/pgd`;

    // Verify sudoers syntax
    try {
      await $`visudo -c -f /etc/sudoers.d/pgd`.quiet();
      console.log(chalk.green('✓'), 'Sudoers configuration installed');
    } catch (error) {
      console.log(chalk.red('✗'), 'Sudoers syntax error');
      await $`rm /etc/sudoers.d/pgd`;
      process.exit(1);
    }
  } catch (error) {
    console.log(chalk.red('✗'), 'Failed to configure sudoers');
    console.error(error);
    process.exit(1);
  }
  console.log();

  // Success!
  console.log(chalk.dim('═'.repeat(60)));
  console.log(chalk.green('✓ Setup Complete!'));
  console.log(chalk.dim('═'.repeat(60)));
  console.log();
  console.log('Configuration summary:');
  console.log(`  • ZFS pool: ${pool}`);
  console.log('  • ZFS delegation: create, destroy, snapshot, clone, promote, etc.');
  console.log('  • Groups: docker, pgd');
  console.log('  • Sudoers: /etc/sudoers.d/pgd (ZFS mount/unmount only)');
  console.log();
  console.log(chalk.yellow('IMPORTANT: Log out and log back in now!'));
  console.log('Group membership (docker, pgd) requires a new login session.');
  console.log();
  console.log(chalk.yellow('After re-logging in:'));
  console.log('  1. Verify setup: pgd doctor');
  console.log('  2. Create first project: pgd project create myapp');
  console.log();
  console.log(chalk.green('Security Note:'));
  console.log('pgd uses sudo ONLY for ZFS mount/unmount (Linux kernel limitation).');
  console.log('All other operations use ZFS delegation - much more secure than full sudo.');
  console.log();
}
