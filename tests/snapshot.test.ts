/**
 * Snapshot management tests
 * Using direct command imports
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as cleanup from './helpers/cleanup';
import { getState, getProjectCredentials, getBranchPort, waitForReady } from './helpers/database';
import {
  silenceConsole,
  projectCreateCommand,
  branchCreateCommand,
  snapshotCreateCommand,
  snapshotListCommand,
  snapshotDeleteCommand,
  snapshotCleanupCommand,
} from './helpers/commands';

describe('Snapshot Operations', () => {
  let setupDone = false;

  async function ensureSetup() {
    if (setupDone) return;
    setupDone = true;

    silenceConsole();
    await cleanup.beforeAll();

    // Setup: Create project and branch
    await projectCreateCommand('snap-test', {});
    const creds = await getProjectCredentials('snap-test');
    let port = await getBranchPort('snap-test/main');
    await waitForReady(port, creds.password, 60000);

    await branchCreateCommand('snap-test/dev', {});
    port = await getBranchPort('snap-test/dev');
    await waitForReady(port, creds.password, 60000);
  }

  afterAll(async () => {
    await cleanup.afterAll();
  });

  describe('Create Snapshot', () => {
    test('should create manual snapshot', async () => {
      await ensureSetup();
      await snapshotCreateCommand('snap-test/dev', {});

      // Verify snapshot in state
      const state = await getState();
      const snapshots = state.snapshots?.filter((s: any) => s.branchName === 'snap-test/dev') || [];
      expect(snapshots.length).toBeGreaterThan(0);
    }, { timeout: 15000 });

    test('should create snapshot with label', async () => {
      await ensureSetup();
      await snapshotCreateCommand('snap-test/dev', { label: 'before-migration' });

      // Verify snapshot with label in state
      const state = await getState();
      const labeledSnapshot = state.snapshots?.find((s: any) =>
        s.branchName === 'snap-test/dev' && s.label === 'before-migration'
      );
      expect(labeledSnapshot).toBeDefined();
    }, { timeout: 15000 });
  });

  describe('List Snapshots', () => {
    test('should list all snapshots', async () => {
      await ensureSetup();
      // Verify via state
      const state = await getState();
      const allSnapshots = state.snapshots || [];
      expect(allSnapshots.length).toBeGreaterThan(0);
    });

    test('should list snapshots for specific branch', async () => {
      await ensureSetup();
      const state = await getState();
      const snapshots = state.snapshots?.filter((s: any) => s.branchName === 'snap-test/dev') || [];
      expect(snapshots.length).toBeGreaterThan(0);
    });
  });

  describe('Delete Snapshot', () => {
    test('should delete snapshot by ID', async () => {
      await ensureSetup();
      // Get first snapshot ID
      const state = await getState();
      const snapshots = state.snapshots?.filter((s: any) => s.branchName === 'snap-test/dev') || [];
      const snapshotId = snapshots[0]?.id;

      expect(snapshotId).toBeDefined();

      // Delete snapshot
      await snapshotDeleteCommand(snapshotId);

      // Verify snapshot removed from state
      const newState = await getState();
      const deletedSnapshot = newState.snapshots?.find((s: any) => s.id === snapshotId);
      expect(deletedSnapshot).toBeUndefined();
    }, { timeout: 15000 });

    test('should fail to delete non-existent snapshot', async () => {
      await ensureSetup();
      await expect(snapshotDeleteCommand('non-existent-snapshot-id')).rejects.toThrow();
    });
  });

  describe('Snapshot Cleanup', () => {
    test('should cleanup old snapshots with --days flag', async () => {
      await ensureSetup();
      await snapshotCleanupCommand(undefined, { days: 30, dryRun: true, all: true });
    });

    test('should cleanup specific branch snapshots', async () => {
      await ensureSetup();
      await snapshotCleanupCommand('snap-test/dev', { days: 30, dryRun: true, all: false });
    });
  });
});
