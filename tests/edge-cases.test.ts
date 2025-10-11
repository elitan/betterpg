/**
 * Edge cases and error handling tests
 * Using direct command imports
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as cleanup from './helpers/cleanup';
import { getProjectCredentials, getBranchPort, waitForReady } from './helpers/database';
import {
  silenceConsole,
  projectCreateCommand,
  projectGetCommand,
  projectDeleteCommand,
  branchCreateCommand,
  branchGetCommand,
  branchDeleteCommand,
  branchResetCommand,
  startCommand,
  stopCommand,
  restartCommand,
} from './helpers/commands';

describe('Edge Cases and Error Handling', () => {
  // Setup test that runs first
  test('setup: create test project', async () => {
    silenceConsole();
    await cleanup.beforeAll();

    // Create a project for testing
    await projectCreateCommand('edge-test', {});
    const creds = await getProjectCredentials('edge-test');
    const port = await getBranchPort('edge-test/main');
    await waitForReady(port, creds.password, 60000);
  }, { timeout: 120000 });

  afterAll(async () => {
    await cleanup.afterAll();
  });

  describe('Invalid Names', () => {
    test('should reject invalid project names', async () => {
      const invalidNames = ['test project', 'test@project', 'test/project', 'test.project'];

      for (const name of invalidNames) {
        await expect(projectCreateCommand(name, {})).rejects.toThrow();
      }
    });

    test('should reject invalid branch names', async () => {
      const invalidNames = ['test branch', 'test@branch', 'test.branch'];

      for (const name of invalidNames) {
        await expect(branchCreateCommand(`edge-test/${name}`, {})).rejects.toThrow();
      }
    });
  });

  describe('Non-existent Resources', () => {
    test('should fail operations on non-existent project', async () => {
      await expect(projectGetCommand('non-existent')).rejects.toThrow();
      await expect(projectDeleteCommand('non-existent', {})).rejects.toThrow();
    });

    test('should fail operations on non-existent branch', async () => {
      await expect(branchGetCommand('edge-test/non-existent')).rejects.toThrow();
      await expect(branchDeleteCommand('edge-test/non-existent')).rejects.toThrow();
      await expect(stopCommand('edge-test/non-existent')).rejects.toThrow();
      await expect(startCommand('edge-test/non-existent')).rejects.toThrow();
      await expect(restartCommand('edge-test/non-existent')).rejects.toThrow();
    });
  });

  describe('Branch Deletion Constraints', () => {
    test('should prevent deletion of main branch', async () => {
      await expect(branchDeleteCommand('edge-test/main')).rejects.toThrow();
    });

    test('should allow deletion of non-main branches', async () => {
      await branchCreateCommand('edge-test/temp', {});
      await Bun.sleep(3000);

      await branchDeleteCommand('edge-test/temp');
    }, { timeout: 30000 });
  });

  describe('Duplicate Resources', () => {
    test('should prevent duplicate project creation', async () => {
      await expect(projectCreateCommand('edge-test', {})).rejects.toThrow();
    });

    test('should prevent duplicate branch creation', async () => {
      await branchCreateCommand('edge-test/dup', {});
      await Bun.sleep(3000);

      await expect(branchCreateCommand('edge-test/dup', {})).rejects.toThrow();
    }, { timeout: 30000 });
  });

  describe('Invalid Operations', () => {
    test('should fail to reset main branch', async () => {
      await expect(branchResetCommand('edge-test/main', {})).rejects.toThrow();
    });

    test('should fail to create branch with invalid --parent', async () => {
      await expect(
        branchCreateCommand('edge-test/new', { parent: 'edge-test/non-existent' })
      ).rejects.toThrow();
    });

    test('should fail to create branch with malformed namespace', async () => {
      await expect(branchCreateCommand('invalid-namespace', {})).rejects.toThrow();
    });
  });
});
