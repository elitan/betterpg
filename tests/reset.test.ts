/**
 * Branch reset tests
 * Using direct command imports
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as cleanup from './helpers/cleanup';
import { getProjectCredentials, getBranchPort, query, waitForReady } from './helpers/database';
import { waitForProjectReady, waitForBranchReady } from './helpers/wait';
import {
  silenceConsole,
  projectCreateCommand,
  branchCreateCommand,
  branchResetCommand,
} from './helpers/commands';

describe('Branch Reset', () => {
  let setupDone = false;

  async function ensureSetup() {
    if (setupDone) return;
    setupDone = true;

    silenceConsole();
    await cleanup.beforeAll();

    // Setup: Create project with test data
    await projectCreateCommand('reset-test', {});
    await waitForProjectReady('reset-test');

    const creds = await getProjectCredentials('reset-test');
    const mainPort = await getBranchPort('reset-test/main');

    // Create initial data
    await query(mainPort, creds.password, 'CREATE TABLE reset_data (id SERIAL PRIMARY KEY, value TEXT);');
    await query(mainPort, creds.password, "INSERT INTO reset_data (value) VALUES ('initial');");
  }

  afterAll(async () => {
    await cleanup.afterAll();
  });

  describe('Reset Operations', () => {
    test('should reset branch with parent changes', async () => {
      await ensureSetup();
      const creds = await getProjectCredentials('reset-test');
      const mainPort = await getBranchPort('reset-test/main');

      // Create branch
      await branchCreateCommand('reset-test/dev', {});
      await waitForBranchReady('reset-test', 'dev');

      // Modify parent
      await query(mainPort, creds.password, "INSERT INTO reset_data (value) VALUES ('parent-change');");

      // Reset branch
      await branchResetCommand('reset-test/dev', {});
      await waitForBranchReady('reset-test', 'dev');

      // Verify branch has parent changes
      const devPort = await getBranchPort('reset-test/dev');
      await waitForReady(devPort, creds.password);

      const count = await query(devPort, creds.password, "SELECT COUNT(*) FROM reset_data WHERE value='parent-change';");
      expect(count).toBe('1');
    }, { timeout: 60000 });

    test('should discard local branch changes after reset', async () => {
      const creds = await getProjectCredentials('reset-test');
      const devPort = await getBranchPort('reset-test/dev');

      // Add local changes to branch
      await query(devPort, creds.password, "INSERT INTO reset_data (value) VALUES ('dev-only');");

      // Verify local change exists
      const beforeReset = await query(devPort, creds.password, "SELECT COUNT(*) FROM reset_data WHERE value='dev-only';");
      expect(beforeReset).toBe('1');

      // Reset branch
      await branchResetCommand('reset-test/dev', {});
      await waitForBranchReady('reset-test', 'dev');

      // Verify local change is gone
      const afterReset = await query(devPort, creds.password, "SELECT COUNT(*) FROM reset_data WHERE value='dev-only';");
      expect(afterReset).toBe('0');
    }, { timeout: 60000 });

    test('should reset multiple times', async () => {
      const creds = await getProjectCredentials('reset-test');
      const mainPort = await getBranchPort('reset-test/main');
      const devPort = await getBranchPort('reset-test/dev');

      // First parent change and reset
      await query(mainPort, creds.password, "INSERT INTO reset_data (value) VALUES ('change-1');");
      await branchResetCommand('reset-test/dev', {});
      await waitForBranchReady('reset-test', 'dev');

      // Verify first change
      const count1 = await query(devPort, creds.password, "SELECT COUNT(*) FROM reset_data WHERE value='change-1';");
      expect(count1).toBe('1');

      // Second parent change and reset
      await query(mainPort, creds.password, "INSERT INTO reset_data (value) VALUES ('change-2');");
      await branchResetCommand('reset-test/dev', {});
      await waitForBranchReady('reset-test', 'dev');

      // Verify second change
      const count2 = await query(devPort, creds.password, "SELECT COUNT(*) FROM reset_data WHERE value='change-2';");
      expect(count2).toBe('1');
    }, { timeout: 60000 });

    test('should fail to reset main branch', async () => {
      await expect(branchResetCommand('reset-test/main', {})).rejects.toThrow();
    });

    test('should fail to reset non-existent branch', async () => {
      await expect(branchResetCommand('reset-test/non-existent', {})).rejects.toThrow();
    });
  });
});
