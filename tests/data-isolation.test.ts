/**
 * Data isolation and persistence tests
 * Using direct command imports
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as cleanup from './helpers/cleanup';
import { getProjectCredentials, getBranchPort, query, waitForReady } from './helpers/database';
import {
  silenceConsole,
  projectCreateCommand,
  branchCreateCommand,
  restartCommand,
} from './helpers/commands';

describe('Data Isolation and Persistence', () => {
  let setupDone = false;

  async function ensureSetup() {
    if (setupDone) return;
    setupDone = true;

    silenceConsole();
    await cleanup.beforeAll();

    // Setup: Create project with test data
    await projectCreateCommand('isolation-test', {});
    const creds = await getProjectCredentials('isolation-test');
    const port = await getBranchPort('isolation-test/main');
    await waitForReady(port, creds.password, 60000);
  }

  afterAll(async () => {
    await cleanup.afterAll();
  });

  describe('Data Persistence', () => {
    test('should persist data in main branch', async () => {
      await ensureSetup();
      const creds = await getProjectCredentials('isolation-test');
      const port = await getBranchPort('isolation-test/main');

      await waitForReady(port, creds.password);

      // Create test data
      await query(port, creds.password, 'CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);');
      await query(port, creds.password, "INSERT INTO users (name) VALUES ('Alice'), ('Bob'), ('Charlie');");

      // Verify data exists
      const count = await query(port, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(count).toBe('3');
    }, { timeout: 30000 });

    test('should persist data after restart', async () => {
      await ensureSetup();
      const creds = await getProjectCredentials('isolation-test');
      const port = await getBranchPort('isolation-test/main');

      // Restart
      await restartCommand('isolation-test/main');
      await Bun.sleep(3000);
      await waitForReady(port, creds.password, 60000);

      // Verify data persisted
      const count = await query(port, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(count).toBe('3');
    }, { timeout: 90000 }); // Restart can take longer on resource-constrained machines
  });

  describe('Branch Isolation', () => {
    test('branch should have same data as parent at creation', async () => {
      await ensureSetup();
      // Create branch
      await branchCreateCommand('isolation-test/dev', {});
      await Bun.sleep(3000);

      const creds = await getProjectCredentials('isolation-test');
      const devPort = await getBranchPort('isolation-test/dev');

      await waitForReady(devPort, creds.password);

      // Verify branch has same data
      const count = await query(devPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(count).toBe('3');
    }, { timeout: 30000 });

    test('branch modifications should not affect parent', async () => {
      await ensureSetup();
      const creds = await getProjectCredentials('isolation-test');
      const mainPort = await getBranchPort('isolation-test/main');
      const devPort = await getBranchPort('isolation-test/dev');

      // Modify branch
      await query(devPort, creds.password, "INSERT INTO users (name) VALUES ('Dev User 1'), ('Dev User 2');");

      // Verify branch has 5 rows
      const devCount = await query(devPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(devCount).toBe('5');

      // Verify parent still has 3 rows
      const mainCount = await query(mainPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(mainCount).toBe('3');
    }, { timeout: 30000 });

    test('parent modifications should not affect existing branch', async () => {
      await ensureSetup();
      const creds = await getProjectCredentials('isolation-test');
      const mainPort = await getBranchPort('isolation-test/main');
      const devPort = await getBranchPort('isolation-test/dev');

      // Modify parent
      await query(mainPort, creds.password, "INSERT INTO users (name) VALUES ('Main User');");

      // Verify parent has 4 rows
      const mainCount = await query(mainPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(mainCount).toBe('4');

      // Verify branch still has 5 rows (unchanged)
      const devCount = await query(devPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(devCount).toBe('5');
    }, { timeout: 30000 });
  });

  describe('Multiple Branches', () => {
    test('multiple branches should be isolated from each other', async () => {
      await ensureSetup();
      // Create second branch
      await branchCreateCommand('isolation-test/staging', {});
      await Bun.sleep(3000);

      const creds = await getProjectCredentials('isolation-test');
      const devPort = await getBranchPort('isolation-test/dev');
      const stagingPort = await getBranchPort('isolation-test/staging');

      await waitForReady(stagingPort, creds.password);

      // Staging should have 4 rows (from main at time of creation)
      const stagingCount = await query(stagingPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(stagingCount).toBe('4');

      // Dev should still have 5 rows
      const devCount = await query(devPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(devCount).toBe('5');

      // Modify staging
      await query(stagingPort, creds.password, "INSERT INTO users (name) VALUES ('Staging User');");

      // Verify staging has 5 rows
      const newStagingCount = await query(stagingPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(newStagingCount).toBe('5');

      // Verify dev still has 5 rows (unchanged)
      const newDevCount = await query(devPort, creds.password, 'SELECT COUNT(*) FROM users;');
      expect(newDevCount).toBe('5');
    }, { timeout: 60000 });
  });
});
