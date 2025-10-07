import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { $ } from 'bun';
import { CLI_NAME, CONTAINER_PREFIX } from '../src/config/constants';
import { PATHS } from '../src/utils/paths';
import { DEFAULT_CONFIG } from '../src/managers/config';

const BPG = './dist/bpg';

describe('Namespace CLI Tests', () => {
  beforeAll(async () => {
    console.log('🧹 Cleaning up before tests...');
    // Clean up any existing state
    await $`rm -rf ${PATHS.CONFIG_DIR} ${PATHS.DATA_DIR}`.quiet();

    // Clean up Docker containers
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();

    // Clean up ZFS datasets
    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();

    console.log('✓ Cleanup complete\n');
  });

  afterAll(async () => {
    console.log('\n🧹 Cleaning up after tests...');
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();
    await $`rm -rf ${PATHS.CONFIG_DIR} ${PATHS.DATA_DIR}`.quiet();
    console.log('✓ Cleanup complete');
  });

  test('01: Initialize system', async () => {
    const result = await $`${BPG} init`;
    expect(result.exitCode).toBe(0);

    // Check files exist
    const stateExists = await Bun.file(PATHS.STATE).exists();
    const configExists = await Bun.file(PATHS.CONFIG).exists();

    expect(stateExists).toBe(true);
    expect(configExists).toBe(true);
  });

  test('02: Create database with db create', async () => {
    const result = await $`${BPG} db create test-db1`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Database created successfully');
    expect(result.stdout.toString()).toContain('test-db1/main');
  }, 30000); // 30 second timeout for container startup

  test('03: List databases with db list', async () => {
    const result = await $`${BPG} db list`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('test-db1');
    expect(result.stdout.toString()).toContain('Branches');
  });

  test('04: Get database details with db get', async () => {
    const result = await $`${BPG} db get test-db1`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Database: test-db1');
    expect(result.stdout.toString()).toContain('PostgreSQL');
    expect(result.stdout.toString()).toContain('Branches:');
  });

  test('05: Create branch with namespace', async () => {
    const result = await $`${BPG} branch create test-db1/dev`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Branch created successfully');
    expect(result.stdout.toString()).toContain('test-db1/dev');
  }, 30000);

  test('06: List all branches', async () => {
    const result = await $`${BPG} branch list`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('test-db1');
    expect(result.stdout.toString()).toContain('main');
    expect(result.stdout.toString()).toContain('dev');
  });

  test('07: List branches for specific database', async () => {
    const result = await $`${BPG} branch list test-db1`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('main');
    expect(result.stdout.toString()).toContain('dev');
  });

  test('08: Get branch details', async () => {
    const result = await $`${BPG} branch get test-db1/dev`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Branch: test-db1/dev');
    expect(result.stdout.toString()).toContain('Type');
    expect(result.stdout.toString()).toContain('branch');
  });

  test('09: Create second database', async () => {
    const result = await $`${BPG} db create test-db2`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('test-db2/main');
  }, 30000);

  test('10: Create staging branch', async () => {
    const result = await $`${BPG} branch create test-db2/staging`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('application-consistent');
  }, 30000);

  test('11: Create branch with --from option', async () => {
    const result = await $`${BPG} branch create test-db1/staging --from test-db1/dev`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('test-db1/staging');
  }, 30000);

  test('12: Verify multiple branches exist', async () => {
    const result = await $`${BPG} branch list test-db1`;
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain('main');
    expect(output).toContain('dev');
    expect(output).toContain('staging');
  });

  test('13: Delete child branch first (staging)', async () => {
    // Must delete child branches before syncing parent
    const result = await $`${BPG} branch delete test-db1/staging`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('deleted successfully');
  });

  test('14: Sync branch with parent', async () => {
    // Wait a moment to ensure parent has different state
    await Bun.sleep(1000);

    const result = await $`${BPG} branch sync test-db1/dev`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('synced with parent');
  }, 30000);

  test('15: Verify branches after delete and sync', async () => {
    const result = await $`${BPG} branch list test-db1`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toContain('staging');
    expect(result.stdout.toString()).toContain('dev');
  });

  test('16: Cannot delete main branch', async () => {
    const result = await $`${BPG} branch delete test-db1/main`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Cannot delete main branch');
  });

  test('17: Cannot delete database with branches without --force', async () => {
    const result = await $`${BPG} db delete test-db1`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toContain('--force');
  });

  test('18: Delete database with --force', async () => {
    const result = await $`${BPG} db delete test-db1 --force`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('deleted successfully');
  });

  test('19: Verify database was deleted', async () => {
    const result = await $`${BPG} db list`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).not.toContain('test-db1');
    expect(result.stdout.toString()).toContain('test-db2');
  });

  test('20: Delete database without branches', async () => {
    // First delete the branch
    await $`${BPG} branch delete test-db2/staging`;

    // Now delete database (no --force needed)
    const result = await $`${BPG} db delete test-db2`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('deleted successfully');
  });

  test('21: Verify no databases remain', async () => {
    const result = await $`${BPG} db list`;
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('No databases found');
  });

  test('22: Error handling - invalid namespace format', async () => {
    await $`${BPG} db create testdb3`; // Create a db first

    const result = await $`${BPG} branch create invalid-name`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Invalid namespace format');
  }, 30000);

  test('23: Error handling - branch across databases', async () => {
    await $`${BPG} db create db1`;
    await $`${BPG} db create db2`;

    const result = await $`${BPG} branch create db1/dev --from db2/main`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('same database');
  }, 60000);

  test('24: Error handling - non-existent database', async () => {
    const result = await $`${BPG} db get nonexistent`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('not found');
  });

  test('25: Error handling - non-existent branch', async () => {
    const result = await $`${BPG} branch get db1/nonexistent`.nothrow();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('not found');
  });
});
