import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { $ } from 'bun';
import { CLI_NAME, CONTAINER_PREFIX } from '../src/config/constants';
import { PATHS } from '../src/utils/paths';
import { DEFAULT_CONFIG } from '../src/managers/config';

const BPG = 'sudo ./dist/bpg';

// Cleanup before and after tests
beforeAll(async () => {
  console.log('🧹 Cleaning up before performance tests...');

  const pool = DEFAULT_CONFIG.zfs.pool;
  const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

  try {
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {}

  try {
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();
  } catch {}

  try {
    await $`sudo rm -rf ${PATHS.DATA_DIR}/* ${PATHS.CONFIG_DIR}/*`.quiet();
  } catch {}

  console.log('✓ Cleanup complete');

  // Initialize system
  await $`${BPG} init`;
});

afterAll(async () => {
  console.log('🧹 Cleaning up after performance tests...');

  const pool = DEFAULT_CONFIG.zfs.pool;
  const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

  try {
    await $`docker ps -a | grep ${CONTAINER_PREFIX}- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {}

  try {
    await $`sudo zfs destroy -r ${pool}/${datasetBase}`.quiet();
    await $`sudo zfs create ${pool}/${datasetBase}`.quiet();
  } catch {}

  try {
    await $`sudo rm -rf ${PATHS.DATA_DIR}/* ${PATHS.CONFIG_DIR}/*`.quiet();
  } catch {}

  console.log('✓ Cleanup complete');
});

describe('BetterPG Performance Tests', () => {

  test('Performance: Create database', async () => {
    const start = performance.now();
    await $`${BPG} create perf-test`;
    const end = performance.now();

    const duration = end - start;
    console.log(`   ⏱️  Database creation took: ${(duration / 1000).toFixed(2)}s`);

    // Should complete in reasonable time (adjust threshold as needed)
    expect(duration).toBeLessThan(60000); // 60 seconds
  });

  test('Performance: Create branch (should be fast due to COW)', async () => {
    // Wait for database to be ready
    await Bun.sleep(3000);

    const start = performance.now();
    await $`${BPG} branch perf-test perf-branch-1`;
    const end = performance.now();

    const duration = end - start;
    console.log(`   ⏱️  Branch creation took: ${(duration / 1000).toFixed(2)}s`);

    // Branching should be fast due to copy-on-write
    expect(duration).toBeLessThan(30000); // 30 seconds
  });

  test('Performance: Create multiple branches sequentially', async () => {
    const start = performance.now();

    for (let i = 2; i <= 5; i++) {
      await $`${BPG} branch perf-test perf-branch-${i}`;
      await Bun.sleep(2000);
    }

    const end = performance.now();
    const duration = end - start;
    const avgTime = duration / 4;

    console.log(`   ⏱️  Created 4 branches in: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   ⏱️  Average per branch: ${(avgTime / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(120000); // 2 minutes for 4 branches
  });

  test('Performance: Stop/Start cycle', async () => {
    const start = performance.now();

    await $`${BPG} stop perf-test`;
    await Bun.sleep(2000);
    await $`${BPG} start perf-test`;
    await Bun.sleep(3000);

    const end = performance.now();
    const duration = end - start;

    console.log(`   ⏱️  Stop/Start cycle took: ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(30000); // 30 seconds
  });

  test('Performance: Restart command', async () => {
    const start = performance.now();
    await $`${BPG} restart perf-test`;
    await Bun.sleep(3000);
    const end = performance.now();

    const duration = end - start;
    console.log(`   ⏱️  Restart took: ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(30000); // 30 seconds
  });

  test('Performance: Reset branch', async () => {
    const start = performance.now();
    await $`${BPG} reset perf-branch-1`;
    await Bun.sleep(3000);
    const end = performance.now();

    const duration = end - start;
    console.log(`   ⏱️  Reset took: ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(45000); // 45 seconds
  });

  test('Performance: List command with multiple databases', async () => {
    const start = performance.now();
    await $`${BPG} list`;
    const end = performance.now();

    const duration = end - start;
    console.log(`   ⏱️  List command took: ${duration.toFixed(2)}ms`);

    expect(duration).toBeLessThan(5000); // Should be very fast
  });

  test('Performance: Status command with multiple databases', async () => {
    const start = performance.now();
    await $`${BPG} status`;
    const end = performance.now();

    const duration = end - start;
    console.log(`   ⏱️  Status command took: ${duration.toFixed(2)}ms`);

    expect(duration).toBeLessThan(10000); // Should be reasonably fast
  });

  test('Performance: Space efficiency check', async () => {
    const pool = DEFAULT_CONFIG.zfs.pool;
    const datasetBase = DEFAULT_CONFIG.zfs.datasetBase;

    const prodSize = parseInt(await $`sudo zfs get -H -p -o value used ${pool}/${datasetBase}/perf-test`.text());
    const branch1Size = parseInt(await $`sudo zfs get -H -p -o value used ${pool}/${datasetBase}/perf-branch-1`.text());

    const ratio = branch1Size / prodSize;
    console.log(`   💾 Primary size: ${(prodSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   💾 Branch size: ${(branch1Size / 1024).toFixed(2)} KB`);
    console.log(`   📊 Branch is ${(ratio * 100).toFixed(2)}% of primary size`);

    // Branch should be significantly smaller (< 10% for fresh clone)
    expect(ratio).toBeLessThan(0.1);
  });

  test('Performance: Destroy multiple branches', async () => {
    const start = performance.now();

    for (let i = 1; i <= 5; i++) {
      await $`${BPG} destroy perf-branch-${i}`;
    }

    const end = performance.now();
    const duration = end - start;

    console.log(`   ⏱️  Destroyed 5 branches in: ${(duration / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(60000); // 60 seconds
  });
});

describe('BetterPG Stress Tests', () => {

  test('Stress: Create and destroy 10 branches', async () => {
    // Create a test database
    await $`${BPG} create stress-test`;
    await Bun.sleep(3000);

    const start = performance.now();

    // Create 10 branches
    for (let i = 1; i <= 10; i++) {
      await $`${BPG} branch stress-test stress-branch-${i}`;
      await Bun.sleep(1500);
    }

    // Destroy all 10 branches
    for (let i = 1; i <= 10; i++) {
      await $`${BPG} destroy stress-branch-${i}`;
    }

    const end = performance.now();
    const duration = end - start;

    console.log(`   ⏱️  Created and destroyed 10 branches in: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   ⏱️  Average time per operation: ${(duration / 20 / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(300000); // 5 minutes

    // Cleanup
    await $`${BPG} destroy stress-test`;
  });

  test('Stress: Rapid stop/start cycles', async () => {
    await $`${BPG} create cycle-test`;
    await Bun.sleep(3000);

    const start = performance.now();

    for (let i = 0; i < 5; i++) {
      await $`${BPG} stop cycle-test`;
      await Bun.sleep(2000);
      await $`${BPG} start cycle-test`;
      await Bun.sleep(3000);
    }

    const end = performance.now();
    const duration = end - start;

    console.log(`   ⏱️  5 stop/start cycles took: ${(duration / 1000).toFixed(2)}s`);
    console.log(`   ⏱️  Average per cycle: ${(duration / 5 / 1000).toFixed(2)}s`);

    expect(duration).toBeLessThan(180000); // 3 minutes

    // Cleanup
    await $`${BPG} destroy cycle-test`;
  });
});
