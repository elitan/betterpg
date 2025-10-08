/**
 * WAL (Write-Ahead Log) operations tests
 * Using direct command imports
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as cleanup from './helpers/cleanup';
import { getProjectCredentials, getBranchPort, waitForReady } from './helpers/database';
import {
  silenceConsole,
  projectCreateCommand,
  walInfoCommand,
  walCleanupCommand,
} from './helpers/commands';

describe('WAL Operations', () => {
  let setupDone = false;

  async function ensureSetup() {
    if (setupDone) return;
    setupDone = true;

    silenceConsole();
    await cleanup.beforeAll();

    // Setup: Create project
    await projectCreateCommand('wal-test', {});
    const creds = await getProjectCredentials('wal-test');
    const port = await getBranchPort('wal-test/main');
    await waitForReady(port, creds.password, 60000);
  }

  afterAll(async () => {
    await cleanup.afterAll();
  });

  describe('WAL Info', () => {
    test('should show WAL info for all branches', async () => {
      await ensureSetup();
      await walInfoCommand(undefined);
    }, { timeout: 60000 }); // PostgreSQL startup + WAL archiving can take time

    test('should show WAL info for specific branch', async () => {
      await ensureSetup();
      await walInfoCommand('wal-test/main');
    }, { timeout: 60000 });

    test('should fail for non-existent branch', async () => {
      await expect(walInfoCommand('wal-test/non-existent')).rejects.toThrow();
    });
  });

  describe('WAL Cleanup', () => {
    test('should cleanup old WAL files', async () => {
      await ensureSetup();
      await walCleanupCommand('wal-test/main', { days: 30 });
    }, { timeout: 60000 });

    test('should fail to cleanup non-existent branch', async () => {
      await expect(walCleanupCommand('wal-test/non-existent', { days: 30 })).rejects.toThrow();
    });
  });
});
