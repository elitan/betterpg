/**
 * Test cleanup utilities
 */

import { $ } from 'bun';
import { CONTAINER_PREFIX } from '../../src/config/constants';
import { PATHS } from '../../src/utils/paths';

/**
 * Get ZFS pool and dataset base from state or use defaults
 */
async function getZfsConfig(): Promise<{ pool: string; datasetBase: string }> {
  try {
    const state = await Bun.file(PATHS.STATE).json();
    return {
      pool: state.zfsPool || 'tank',
      datasetBase: state.zfsDatasetBase || 'pgd/databases',
    };
  } catch {
    return {
      pool: 'tank',
      datasetBase: 'pgd/databases',
    };
  }
}

/**
 * Cleanup before tests
 */
export async function beforeAll(): Promise<void> {
  const { pool, datasetBase } = await getZfsConfig();

  // Stop and remove all pgd containers
  try {
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {
    // Ignore errors
  }

  // Clean up ZFS datasets
  try {
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
  } catch {
    // Ignore errors
  }

  try {
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();
  } catch {
    // Ignore errors
  }

  // Remove state directory
  try {
    await $`rm -rf ${PATHS.DATA_DIR}`.quiet();
  } catch {
    // Ignore errors
  }

  // When running with sudo (UID 0), also clean /root directories
  if (process.getuid?.() === 0) {
    try {
      await $`rm -rf /root/.pgd`.quiet();
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Cleanup after tests
 */
export async function afterAll(): Promise<void> {
  const { pool, datasetBase } = await getZfsConfig();

  // Stop and remove all pgd containers
  try {
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {
    // Ignore errors
  }

  // Clean up ZFS datasets
  try {
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
  } catch {
    // Ignore errors
  }

  try {
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();
  } catch {
    // Ignore errors
  }

  // Remove state directory
  try {
    await $`rm -rf ${PATHS.DATA_DIR}`.quiet();
  } catch {
    // Ignore errors
  }

  // When running with sudo (UID 0), also clean /root directories
  if (process.getuid?.() === 0) {
    try {
      await $`rm -rf /root/.pgd`.quiet();
    } catch {
      // Ignore errors
    }
  }
}
