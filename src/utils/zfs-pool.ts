import { $ } from 'bun';

/**
 * Auto-detect ZFS pool
 * - If exactly 1 pool exists, return it
 * - If 0 pools exist, throw error
 * - If multiple pools exist, throw error (user must specify --pool)
 */
export async function autoDetectZFSPool(): Promise<string> {
  try {
    const result = await $`zpool list -H -o name`.text();
    const pools = result.trim().split('\n').filter(Boolean);

    if (pools.length === 0) {
      throw new Error('No ZFS pools found. Please create a ZFS pool first.');
    }

    if (pools.length === 1) {
      return pools[0]!; // Safe: we checked length === 1
    }

    throw new Error(
      `Multiple ZFS pools found: ${pools.join(', ')}. Please specify one using --pool <name>`
    );
  } catch (error: any) {
    if (error.message.includes('zpool: command not found')) {
      throw new Error('ZFS is not installed or not in PATH');
    }
    throw error;
  }
}

/**
 * Validate that a specific ZFS pool exists
 */
export async function validateZFSPool(poolName: string): Promise<boolean> {
  try {
    await $`zpool list ${poolName}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get ZFS pool to use (provided or auto-detected)
 */
export async function getZFSPool(providedPool?: string): Promise<string> {
  if (providedPool) {
    const exists = await validateZFSPool(providedPool);
    if (!exists) {
      throw new Error(`ZFS pool '${providedPool}' not found`);
    }
    return providedPool;
  }

  return autoDetectZFSPool();
}
