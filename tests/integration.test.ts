import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'bun';
import { $ } from 'bun';

async function runBPG(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = spawn(['sudo', './dist/bpg', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  return { exitCode: proc.exitCode ?? 1, stdout, stderr };
}

let DB_PASSWORD = '';
let DB_PORT = '';
let DEV_PORT = '';

// Helper functions
async function getStateValue(jsonPath: string): Promise<string> {
  const file = Bun.file('/var/lib/betterpg/state.json');
  const json = await file.json();
  const keys = jsonPath.replace(/^\./,  '').split(/[\.\[]/).map(k => k.replace(/\]$/, ''));
  let value: any = json;
  for (const key of keys) {
    if (key === '') continue;
    value = value?.[key];
  }
  return String(value || '');
}

async function checkContainerRunning(name: string): Promise<boolean> {
  const proc = spawn(['docker', 'ps'], { stdout: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  return stdout.includes(name);
}

async function checkContainerStopped(name: string): Promise<boolean> {
  const proc = spawn(['docker', 'ps', '-a'], { stdout: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  return stdout.includes(name) && stdout.includes('Exited');
}

async function queryDatabase(port: string, password: string, query: string): Promise<string> {
  const proc = spawn(['psql', '-h', 'localhost', '-p', port, '-U', 'postgres', '-d', 'postgres', '-t', '-c', query], {
    env: { ...process.env, PGPASSWORD: password },
    stdout: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  return stdout.trim();
}

// Cleanup before and after tests
beforeAll(async () => {
  console.log('🧹 Cleaning up before tests...');

  // Stop and remove containers
  try {
    await $`docker ps -a | grep bpg- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {}

  // Clean up ZFS datasets
  try {
    await $`sudo zfs destroy -r tank/betterpg/databases`.quiet();
    await $`sudo zfs create tank/betterpg/databases`.quiet();
  } catch {}

  // Remove state and config
  try {
    await $`sudo rm -rf /var/lib/betterpg/* /etc/betterpg/*`.quiet();
  } catch {}

  console.log('✓ Cleanup complete');
});

afterAll(async () => {
  console.log('🧹 Cleaning up after tests...');

  // Stop and remove containers
  try {
    await $`docker ps -a | grep bpg- | awk '{print $1}' | xargs -r docker rm -f`.quiet();
  } catch {}

  // Clean up ZFS datasets
  try {
    await $`sudo zfs destroy -r tank/betterpg/databases`.quiet();
    await $`sudo zfs create tank/betterpg/databases`.quiet();
  } catch {}

  // Remove state and config
  try {
    await $`sudo rm -rf /var/lib/betterpg/* /etc/betterpg/*`.quiet();
  } catch {}

  console.log('✓ Cleanup complete');
});

describe('BetterPG Integration Tests', () => {

  test('01: Initialize betterpg', async () => {
    await runBPG('init');

    const stateExists = await Bun.file('/var/lib/betterpg/state.json').exists();
    const configExists = await Bun.file('/etc/betterpg/config.yaml').exists();

    expect(stateExists).toBe(true);
    expect(configExists).toBe(true);
  });

  test('02: Create primary database', async () => {
    await $`${BPG} create test-prod`;

    // Check ZFS dataset exists
    const zfsResult = await $`sudo zfs list tank/betterpg/databases/test-prod`.quiet();
    expect(zfsResult.exitCode).toBe(0);

    // Check container is running
    const isRunning = await checkContainerRunning('bpg-test-prod');
    expect(isRunning).toBe(true);

    // Store password and port for later tests
    DB_PASSWORD = await getStateValue('.databases[0].credentials.password');
    DB_PORT = await getStateValue('.databases[0].port');
  });

  test('03: Create test data', async () => {
    // Wait for PostgreSQL to be ready
    await Bun.sleep(2000);

    await $`PGPASSWORD=${DB_PASSWORD} psql -h localhost -p ${DB_PORT} -U postgres -d postgres -c "CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW());"`;
    await $`PGPASSWORD=${DB_PASSWORD} psql -h localhost -p ${DB_PORT} -U postgres -d postgres -c "INSERT INTO test_table (name) VALUES ('test-data-1'), ('test-data-2'), ('test-data-3');"`;

    const count = await queryDatabase(DB_PORT, DB_PASSWORD, 'SELECT COUNT(*) FROM test_table;');
    expect(count).toBe('3');
  });

  test('04: Status command works', async () => {
    const result = await $`${BPG} status`;
    expect(result.exitCode).toBe(0);
  });

  test('05: Stop database', async () => {
    await $`${BPG} stop test-prod`;
    await Bun.sleep(2000);

    const isStopped = await checkContainerStopped('bpg-test-prod');
    expect(isStopped).toBe(true);

    const stateStatus = await getStateValue('.databases[0].status');
    expect(stateStatus).toBe('stopped');
  });

  test('06: Start database and verify data persistence', async () => {
    await $`${BPG} start test-prod`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning('bpg-test-prod');
    expect(isRunning).toBe(true);

    // Verify data persisted
    const count = await queryDatabase(DB_PORT, DB_PASSWORD, 'SELECT COUNT(*) FROM test_table;');
    expect(count).toBe('3');
  });

  test('07: Restart database', async () => {
    await $`${BPG} restart test-prod`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning('bpg-test-prod');
    expect(isRunning).toBe(true);
  });

  test('08: Create branch', async () => {
    await $`${BPG} branch test-prod test-dev`;

    const zfsResult = await $`sudo zfs list tank/betterpg/databases/test-dev`.quiet();
    expect(zfsResult.exitCode).toBe(0);

    // Check snapshot was created
    const snapshotResult = await $`sudo zfs list -t snapshot | grep tank/betterpg/databases/test-prod@`.quiet();
    expect(snapshotResult.exitCode).toBe(0);

    DEV_PORT = await getStateValue('.databases[0].branches[0].port');
  });

  test('09: Verify branch has same data', async () => {
    await Bun.sleep(3000);

    const count = await queryDatabase(DEV_PORT, DB_PASSWORD, 'SELECT COUNT(*) FROM test_table;');
    expect(count).toBe('3');
  });

  test('10: Modify branch data (isolated from primary)', async () => {
    await $`PGPASSWORD=${DB_PASSWORD} psql -h localhost -p ${DEV_PORT} -U postgres -d postgres -c "INSERT INTO test_table (name) VALUES ('dev-only-data-1'), ('dev-only-data-2');"`;

    const prodCount = await queryDatabase(DB_PORT, DB_PASSWORD, 'SELECT COUNT(*) FROM test_table;');
    const devCount = await queryDatabase(DEV_PORT, DB_PASSWORD, 'SELECT COUNT(*) FROM test_table;');

    expect(prodCount).toBe('3');
    expect(devCount).toBe('5');
  });

  test('11: Stop branch', async () => {
    await $`${BPG} stop test-dev`;
    await Bun.sleep(2000);

    const isStopped = await checkContainerStopped('bpg-test-dev');
    expect(isStopped).toBe(true);
  });

  test('12: Start branch', async () => {
    await $`${BPG} start test-dev`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning('bpg-test-dev');
    expect(isRunning).toBe(true);
  });

  test('13: Reset branch to parent snapshot', async () => {
    await $`${BPG} reset test-dev`;
    await Bun.sleep(3000);

    const isRunning = await checkContainerRunning('bpg-test-dev');
    expect(isRunning).toBe(true);

    // Verify data was reset
    const count = await queryDatabase(DEV_PORT, DB_PASSWORD, 'SELECT COUNT(*) FROM test_table;');
    expect(count).toBe('3');
  });

  test('14: Idempotent start on running database', async () => {
    const result = await $`${BPG} start test-prod`;
    expect(result.exitCode).toBe(0);
  });

  test('15: Idempotent stop on stopped database', async () => {
    await $`${BPG} stop test-prod`;
    await Bun.sleep(2000);

    const result = await $`${BPG} stop test-prod`;
    expect(result.exitCode).toBe(0);

    // Start it back up
    await $`${BPG} start test-prod`;
    await Bun.sleep(3000);
  });

  test('16: Status with mixed running/stopped states', async () => {
    await $`${BPG} stop test-dev`;
    await Bun.sleep(2000);

    const result = await $`${BPG} status`;
    expect(result.exitCode).toBe(0);

    await $`${BPG} start test-dev`;
    await Bun.sleep(3000);
  });

  test('17: Create second branch', async () => {
    await $`${BPG} branch test-prod test-staging`;

    const zfsResult = await $`sudo zfs list tank/betterpg/databases/test-staging`.quiet();
    expect(zfsResult.exitCode).toBe(0);
  });

  test('18: List command shows all databases and branches', async () => {
    const result = await $`${BPG} list`;
    expect(result.exitCode).toBe(0);
  });

  test('19: Verify ZFS space efficiency (copy-on-write)', async () => {
    const prodSize = parseInt(await $`sudo zfs get -H -p -o value used tank/betterpg/databases/test-prod`.text());
    const devSize = parseInt(await $`sudo zfs get -H -p -o value used tank/betterpg/databases/test-dev`.text());
    const stagingSize = parseInt(await $`sudo zfs get -H -p -o value used tank/betterpg/databases/test-staging`.text());

    expect(devSize).toBeLessThan(prodSize);
    expect(stagingSize).toBeLessThan(prodSize);
  });

  test('20: Destroy branches', async () => {
    await $`${BPG} destroy test-staging`;
    await $`${BPG} destroy test-dev`;

    const stagingExists = await $`sudo zfs list tank/betterpg/databases/test-staging`.quiet();
    const devExists = await $`sudo zfs list tank/betterpg/databases/test-dev`.quiet();

    expect(stagingExists.exitCode).not.toBe(0);
    expect(devExists.exitCode).not.toBe(0);
  });

  test('21: Edge case - Reset primary database should fail', async () => {
    const result = await $`${BPG} reset test-prod`.quiet();
    expect(result.exitCode).not.toBe(0);
  });

  test('22: Edge case - Start non-existent database should fail', async () => {
    const result = await $`${BPG} start non-existent`.quiet();
    expect(result.exitCode).not.toBe(0);
  });
});
