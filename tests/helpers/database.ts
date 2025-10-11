/**
 * PostgreSQL and state file utilities
 */

import { spawn } from 'bun';
import { PATHS } from '../../src/utils/paths';
import * as path from 'path';
import * as os from 'os';

/**
 * Execute PostgreSQL query
 */
export async function query(
  port: string,
  password: string,
  sql: string,
  database = 'postgres'
): Promise<string> {
  const proc = spawn(
    [
      'psql',
      '-h', 'localhost',
      '-p', port,
      '-U', 'postgres',
      '-d', database,
      '-t', // Tuples only (no headers/footers)
      '-c', sql,
    ],
    {
      env: { ...process.env, PGPASSWORD: password },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`PostgreSQL query failed (exit code ${proc.exitCode}): ${stderr}`);
  }

  return stdout.trim();
}

/**
 * Get state file as JSON
 * Note: When running with sudo, state file is in /root even if HOME is preserved
 */
export async function getState(): Promise<any> {
  // When running with sudo (UID 0), velo creates state in /root
  const statePath = process.getuid?.() === 0
    ? '/root/.velo/state.json'
    : PATHS.STATE;

  const file = Bun.file(statePath);
  return await file.json();
}

/**
 * Get value from state file using path notation
 * Examples:
 *   - getStateValue('projects[0].name')
 *   - getStateValue('projects[0].credentials.password')
 */
export async function getStateValue(path: string): Promise<any> {
  const state = await getState();

  // Parse path like "projects[0].credentials.password"
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');

  let value: any = state;
  for (const key of keys) {
    if (value === undefined || value === null) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

/**
 * Get project credentials
 */
export async function getProjectCredentials(projectName: string): Promise<{
  username: string;
  password: string;
  database: string;
}> {
  const state = await getState();
  const project = state.projects?.find((p: any) => p.name === projectName);

  if (!project) {
    throw new Error(`Project ${projectName} not found in state`);
  }

  return project.credentials;
}

/**
 * Get branch port
 */
export async function getBranchPort(branchName: string): Promise<string> {
  const state = await getState();

  for (const project of state.projects || []) {
    const branch = project.branches?.find((b: any) => b.name === branchName);
    if (branch) {
      return branch.port;
    }
  }

  throw new Error(`Branch ${branchName} not found in state`);
}

/**
 * Wait for PostgreSQL to be ready
 */
export async function waitForReady(
  port: string,
  password: string,
  timeoutMs = 10000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await query(port, password, 'SELECT 1;');
      return; // Success
    } catch {
      await Bun.sleep(500);
    }
  }

  throw new Error(`PostgreSQL did not become ready within ${timeoutMs}ms`);
}

/**
 * Force WAL switch and wait for archiving to complete
 * This ensures WAL files are archived without relying on timing
 */
export async function forceWALArchive(
  port: string,
  password: string
): Promise<void> {
  // Force PostgreSQL to switch to a new WAL file and archive the old one
  await query(port, password, 'SELECT pg_switch_wal();');

  // Force checkpoint to ensure archiving completes
  await query(port, password, 'CHECKPOINT;');
}

/**
 * Wait for WAL files to be archived
 * Polls the WAL archive directory until expected number of files appear
 */
export async function waitForWALArchive(
  datasetName: string,
  minFiles: number = 1,
  timeoutMs = 30000
): Promise<void> {
  const { WALManager } = await import('../../src/managers/wal');
  const wal = new WALManager();
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const info = await wal.getArchiveInfo(datasetName);
    if (info.fileCount >= minFiles) {
      return; // Success
    }
    await Bun.sleep(500);
  }

  throw new Error(`WAL files not archived after ${timeoutMs}ms`);
}

/**
 * Ensure WAL archiving has happened
 * Combines forced WAL switch with verification
 */
export async function ensureWALArchived(
  port: string,
  password: string,
  datasetName: string,
  minFiles: number = 1
): Promise<void> {
  // Force WAL switch and checkpoint
  await forceWALArchive(port, password);

  // Wait for files to appear in archive
  await waitForWALArchive(datasetName, minFiles);
}
