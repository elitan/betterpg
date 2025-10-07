#!/usr/bin/env bun
/**
 * Comprehensive integration test suite for betterpg
 * Uses Bun's $ shell for all operations
 */

import { $ } from 'bun';
import { CLI_NAME, CONTAINER_PREFIX } from '../src/config/constants';
import { PATHS } from '../src/utils/paths';
import { DEFAULT_CONFIG } from '../src/managers/config';

// Colors
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m';

let testsPassed = 0;
let testsFailed = 0;

function log(message: string, color = NC) {
  console.log(`${color}${message}${NC}`);
}

async function cleanup() {
  log('\n🧹 Cleaning up...', YELLOW);

  const pool = DEFAULT_CONFIG.zfs.pool;
  const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

  // Stop and remove containers
  try {
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {}

  // Clean up ZFS datasets
  try {
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();
  } catch {}

  // Remove state and config
  try {
    await $`sudo rm -rf ${PATHS.DATA_DIR}/* ${PATHS.CONFIG_DIR}/*`.quiet();
  } catch {}

  log('✓ Cleanup complete', GREEN);
}

async function checkContainerRunning(name: string): Promise<boolean> {
  const result = await $`docker ps | grep ${name}`.quiet();
  return result.exitCode === 0;
}

async function checkContainerStopped(name: string): Promise<boolean> {
  const result = await $`docker ps -a | grep ${name} | grep Exited`.quiet();
  return result.exitCode === 0;
}

const BPG = 'sudo ./dist/bpg';

async function test(name: string, fn: () => Promise<void>) {
  try {
    log(`\n${BLUE}=== ${name} ===${NC}`, BLUE);
    await fn();
    testsPassed++;
  } catch (error) {
    log(`✗ ${name} failed: ${error}`, RED);
    testsFailed++;
    throw error;
  }
}

async function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
  log(`✓ ${message}`, GREEN);
}

async function bpg(...args: string[]) {
  return await $`${BPG} ${args}`;
}

async function main() {
  log('🧪 Running integration tests\n', YELLOW);

  // Initial cleanup
  await cleanup();

  // Build first
  log('📦 Building...', YELLOW);
  await $`bun run build`;
  log('✓ Build complete\n', GREEN);

  let dbPassword = '';
  let dbPort = '';
  let devPort = '';

  await test('Test 1: Initialize system', async () => {
    await bpg('init');

    const stateExists = await Bun.file(PATHS.STATE).exists();
    const configExists = await Bun.file(PATHS.CONFIG).exists();

    assert(stateExists && configExists, 'Init successful');
  });

  await test('Test 2: Create primary database', async () => {
    await bpg('create', 'test-prod');

    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

    const zfsResult = await $`sudo zfs list ${pool}/${datasetBase}/test-prod`.quiet();
    assert(zfsResult.exitCode === 0, 'Database created');

    const isRunning = await checkContainerRunning(`${CONTAINER_PREFIX}-test-prod`);
    assert(isRunning, 'Container is running');

    // Get credentials from state
    const state = await Bun.file(PATHS.STATE).json();
    dbPassword = state.databases[0].credentials.password;
    dbPort = state.databases[0].port;
  });

  await test('Test 3: Create test data', async () => {
    await Bun.sleep(3000);

    await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${dbPort} -U postgres -d postgres -c "CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW());"`;
    await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${dbPort} -U postgres -d postgres -c "INSERT INTO test_table (name) VALUES ('test-data-1'), ('test-data-2'), ('test-data-3');"`;

    const result = await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${dbPort} -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;"`.text();
    const count = result.trim();

    assert(count === '3', 'Test data created');
  });

  await test('Test 4: Status command works', async () => {
    const result = await $`${BPG} status`;
    assert(result.exitCode === 0, 'Status command executed');
  });

  await test('Test 5: Stop database', async () => {
    await $`${BPG} stop test-prod`;
    await Bun.sleep(2000);

    const isStopped = await checkContainerStopped(`${CONTAINER_PREFIX}-test-prod`);
    assert(isStopped, 'Database stopped successfully');

    const state = await Bun.file(PATHS.STATE).json();
    assert(state.databases[0].status === 'stopped', 'State updated correctly');
  });

  await test('Test 6: Start database and verify data persistence', async () => {
    await $`${BPG} start test-prod`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning(`${CONTAINER_PREFIX}-test-prod`);
    assert(isRunning, 'Database started successfully');

    const result = await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${dbPort} -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;"`.text();
    const count = result.trim();
    assert(count === '3', 'Data persisted after stop/start');
  });

  await test('Test 7: Restart database', async () => {
    await $`${BPG} restart test-prod`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning(`${CONTAINER_PREFIX}-test-prod`);
    assert(isRunning, 'Database restarted successfully');
  });

  await test('Test 8: Create branch', async () => {
    await $`${BPG} branch test-prod test-dev`;

    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

    const zfsResult = await $`sudo zfs list ${pool}/${datasetBase}/test-dev`.quiet();
    assert(zfsResult.exitCode === 0, 'Branch created');

    const snapshotResult = await $`sudo zfs list -t snapshot | grep ${pool}/${datasetBase}/test-prod@`.quiet();
    assert(snapshotResult.exitCode === 0, 'Snapshot created');

    const state = await Bun.file(PATHS.STATE).json();
    devPort = state.databases[0].branches[0].port;
  });

  await test('Test 9: Verify branch has same data', async () => {
    await Bun.sleep(3000);

    const result = await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${devPort} -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;"`.text();
    const count = result.trim();
    assert(count === '3', 'Branch has same data as primary');
  });

  await test('Test 10: Modify branch data (isolated from primary)', async () => {
    await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${devPort} -U postgres -d postgres -c "INSERT INTO test_table (name) VALUES ('dev-only-data-1'), ('dev-only-data-2');"`;

    const prodResult = await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${dbPort} -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;"`.text();
    const devResult = await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${devPort} -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;"`.text();

    const prodCount = prodResult.trim();
    const devCount = devResult.trim();

    assert(prodCount === '3' && devCount === '5', 'Branch data modified, primary unchanged');
  });

  await test('Test 11: Stop branch', async () => {
    await $`${BPG} stop test-dev`;
    await Bun.sleep(2000);

    const isStopped = await checkContainerStopped(`${CONTAINER_PREFIX}-test-dev`);
    assert(isStopped, 'Branch stopped successfully');
  });

  await test('Test 12: Start branch', async () => {
    await $`${BPG} start test-dev`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning(`${CONTAINER_PREFIX}-test-dev`);
    assert(isRunning, 'Branch started successfully');
  });

  await test('Test 13: Reset branch to parent snapshot', async () => {
    await $`${BPG} reset test-dev`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning(`${CONTAINER_PREFIX}-test-dev`);
    assert(isRunning, 'Branch running after reset');

    const result = await $`PGPASSWORD=${dbPassword} psql -h localhost -p ${devPort} -U postgres -d postgres -t -c "SELECT COUNT(*) FROM test_table;"`.text();
    const count = result.trim();
    assert(count === '3', 'Branch data reset to parent snapshot');
  });

  await test('Test 14: Idempotent operations', async () => {
    await $`${BPG} start test-prod`;
    log('✓ Start on running database is idempotent', GREEN);

    await $`${BPG} stop test-prod`;
    await Bun.sleep(2000);
    await $`${BPG} stop test-prod`;
    log('✓ Stop on stopped database is idempotent', GREEN);

    await $`${BPG} start test-prod`;
    await Bun.sleep(3000);
  });

  await test('Test 15: Status with mixed states', async () => {
    await $`${BPG} stop test-dev`;
    await Bun.sleep(2000);

    const result = await $`${BPG} status`;
    assert(result.exitCode === 0, 'Status shows mixed running/stopped states');

    await $`${BPG} start test-dev`;
    await Bun.sleep(3000);
  });

  await test('Test 16: Create second branch', async () => {
    await $`${BPG} branch test-prod test-staging`;

    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

    const zfsResult = await $`sudo zfs list ${pool}/${datasetBase}/test-staging`.quiet();
    assert(zfsResult.exitCode === 0, 'Second branch created');
  });

  await test('Test 17: List command', async () => {
    const result = await $`${BPG} list`;
    assert(result.exitCode === 0, 'List command shows all databases and branches');
  });

  await test('Test 18: Verify ZFS space efficiency', async () => {
    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

    const prodSizeResult = await $`sudo zfs get -H -p -o value used ${pool}/${datasetBase}/test-prod`.text();
    const devSizeResult = await $`sudo zfs get -H -p -o value used ${pool}/${datasetBase}/test-dev`.text();
    const stagingSizeResult = await $`sudo zfs get -H -p -o value used ${pool}/${datasetBase}/test-staging`.text();

    const prodSize = parseInt(prodSizeResult.trim());
    const devSize = parseInt(devSizeResult.trim());
    const stagingSize = parseInt(stagingSizeResult.trim());

    log(`Primary size: ${(prodSize / 1024 / 1024).toFixed(2)} MB`, NC);
    log(`Dev branch size: ${(devSize / 1024).toFixed(2)} KB`, NC);
    log(`Staging branch size: ${(stagingSize / 1024).toFixed(2)} KB`, NC);

    assert(devSize < prodSize && stagingSize < prodSize, 'Branches use less space (copy-on-write working)');
  });

  await test('Test 19: Destroy branches', async () => {
    await $`${BPG} destroy test-staging`;
    await $`${BPG} destroy test-dev`;

    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

    const stagingExists = await $`sudo zfs list ${pool}/${datasetBase}/test-staging`.quiet();
    const devExists = await $`sudo zfs list ${pool}/${datasetBase}/test-dev`.quiet();

    assert(stagingExists.exitCode !== 0 && devExists.exitCode !== 0, 'Branches destroyed');
  });

  await test('Test 20: Edge case - Reset primary database should fail', async () => {
    const result = await $`${BPG} reset test-prod`.quiet();
    assert(result.exitCode !== 0, 'Reset correctly rejects primary databases');
  });

  await test('Test 21: Edge case - Start non-existent database should fail', async () => {
    const result = await $`${BPG} start non-existent`.quiet();
    assert(result.exitCode !== 0, 'Start correctly rejects non-existent databases');
  });

  await test('Test 22: Final status check', async () => {
    const result = await $`${BPG} status`;
    assert(result.exitCode === 0, 'Final status check complete');
  });

  // Final cleanup
  await cleanup();

  // Summary
  log(`\n${'='.repeat(50)}`, BLUE);
  log(`🎉 All tests completed!`, GREEN);
  log(`   Passed: ${testsPassed}`, GREEN);
  log(`   Failed: ${testsFailed}`, testsFailed > 0 ? RED : GREEN);
  log(`${'='.repeat(50)}\n`, BLUE);

  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  log(`\n❌ Test suite failed: ${error}`, RED);
  await cleanup();
  process.exit(1);
});
