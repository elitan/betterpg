/**
 * Branch sync tests
 * Using direct command imports
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as cleanup from './helpers/cleanup';
import { getProjectCredentials, getBranchPort, query, waitForReady } from './helpers/database';
import {
  silenceConsole,
  projectCreateCommand,
  branchCreateCommand,
  branchSyncCommand,
} from './helpers/commands';

describe('Branch Sync', () => {
  let setupDone = false;

  async function ensureSetup() {
    if (setupDone) return;
    setupDone = true;

    silenceConsole();
    await cleanup.beforeAll();

    // Setup: Create project with test data
    await projectCreateCommand('sync-test', {});

    const creds = await getProjectCredentials('sync-test');
    const mainPort = await getBranchPort('sync-test/main');
    await waitForReady(mainPort, creds.password, 60000);

    // Create initial data
    await query(mainPort, creds.password, 'CREATE TABLE sync_data (id SERIAL PRIMARY KEY, value TEXT);');
    await query(mainPort, creds.password, "INSERT INTO sync_data (value) VALUES ('initial');");
  }

  afterAll(async () => {
    await cleanup.afterAll();
  });

  describe('Sync Operations', () => {
    test('should sync branch with parent changes', async () => {
      await ensureSetup();
      const creds = await getProjectCredentials('sync-test');
      const mainPort = await getBranchPort('sync-test/main');

      // Create branch
      await branchCreateCommand('sync-test/dev', {});
      await Bun.sleep(3000);

      // Modify parent
      await query(mainPort, creds.password, "INSERT INTO sync_data (value) VALUES ('parent-change');");

      // Sync branch
      await branchSyncCommand('sync-test/dev', {});
      await Bun.sleep(3000);

      // Verify branch has parent changes
      const devPort = await getBranchPort('sync-test/dev');
      await waitForReady(devPort, creds.password);

      const count = await query(devPort, creds.password, "SELECT COUNT(*) FROM sync_data WHERE value='parent-change';");
      expect(count).toBe('1');
    }, { timeout: 60000 });

    test('should discard local branch changes after sync', async () => {
      const creds = await getProjectCredentials('sync-test');
      const devPort = await getBranchPort('sync-test/dev');

      // Add local changes to branch
      await query(devPort, creds.password, "INSERT INTO sync_data (value) VALUES ('dev-only');");

      // Verify local change exists
      const beforeSync = await query(devPort, creds.password, "SELECT COUNT(*) FROM sync_data WHERE value='dev-only';");
      expect(beforeSync).toBe('1');

      // Sync branch
      await branchSyncCommand('sync-test/dev', {});
      await Bun.sleep(3000);

      // Verify local change is gone
      const afterSync = await query(devPort, creds.password, "SELECT COUNT(*) FROM sync_data WHERE value='dev-only';");
      expect(afterSync).toBe('0');
    }, { timeout: 60000 });

    test('should sync multiple times', async () => {
      const creds = await getProjectCredentials('sync-test');
      const mainPort = await getBranchPort('sync-test/main');
      const devPort = await getBranchPort('sync-test/dev');

      // First parent change and sync
      await query(mainPort, creds.password, "INSERT INTO sync_data (value) VALUES ('change-1');");
      await branchSyncCommand('sync-test/dev', {});
      await Bun.sleep(3000);

      // Verify first change
      const count1 = await query(devPort, creds.password, "SELECT COUNT(*) FROM sync_data WHERE value='change-1';");
      expect(count1).toBe('1');

      // Second parent change and sync
      await query(mainPort, creds.password, "INSERT INTO sync_data (value) VALUES ('change-2');");
      await branchSyncCommand('sync-test/dev', {});
      await Bun.sleep(3000);

      // Verify second change
      const count2 = await query(devPort, creds.password, "SELECT COUNT(*) FROM sync_data WHERE value='change-2';");
      expect(count2).toBe('1');
    }, { timeout: 60000 });

    test('should fail to sync main branch', async () => {
      await expect(branchSyncCommand('sync-test/main', {})).rejects.toThrow();
    });

    test('should fail to sync non-existent branch', async () => {
      await expect(branchSyncCommand('sync-test/non-existent', {})).rejects.toThrow();
    });
  });
});
