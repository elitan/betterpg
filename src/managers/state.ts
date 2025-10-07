import * as fs from 'fs/promises';
import { State, Database, Branch, Backup } from '../types/state';

export class StateManager {
  private state: State | null = null;
  private lockFile: string;

  constructor(private filePath: string) {
    this.lockFile = `${filePath}.lock`;
  }

  // State operations
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.state = JSON.parse(content);

      // Migrate old state files
      let needsSave = false;

      if (!this.state.snapshots) {
        this.state.snapshots = [];
        needsSave = true;
      }

      // Remove deprecated nextPort field if it exists
      if ('nextPort' in this.state) {
        delete (this.state as any).nextPort;
        needsSave = true;
      }

      // Populate zfsDatasetName for existing branches
      for (const db of this.state.databases) {
        for (const branch of db.branches) {
          if (!branch.zfsDatasetName) {
            // Extract from full path: "pool/base/name" -> "name"
            branch.zfsDatasetName = branch.zfsDataset.split('/').pop() || `${db.name}-${branch.name.split('/')[1]}`;
            needsSave = true;
          }
        }
      }

      // Save if migrations were applied
      if (needsSave) {
        await this.save();
      }

      this.validate();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error('State file not found. Run "bpg init" first.');
      }
      throw new Error(`Failed to load state: ${error.message}`);
    }
  }

  async save(): Promise<void> {
    if (!this.state) {
      throw new Error('State not loaded');
    }

    await this.acquireLock();

    try {
      const tempFile = `${this.filePath}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(this.state, null, 2), 'utf-8');

      // Ensure data is written to disk before rename
      const fd = await fs.open(tempFile, 'r');
      await fd.sync();
      await fd.close();

      // Atomically replace old file with new file
      await fs.rename(tempFile, this.filePath);

      // Ensure directory entry is updated
      const dir = await fs.open(this.filePath.substring(0, this.filePath.lastIndexOf('/')), 'r');
      await dir.sync();
      await dir.close();
    } finally {
      await this.releaseLock();
    }
  }

  async initialize(pool: string, datasetBase: string): Promise<void> {
    this.state = {
      version: '1.0.0',
      initializedAt: new Date().toISOString(),
      zfsPool: pool,
      zfsDatasetBase: `${pool}/${datasetBase}`,
      databases: [],
      backups: [],
      snapshots: [],
    };

    await this.save();
  }

  // Database operations
  async addDatabase(db: Database): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    if (this.state.databases.some(d => d.name === db.name)) {
      throw new Error(`Database '${db.name}' already exists`);
    }

    this.state.databases.push(db);
    await this.save();
  }

  async getDatabase(nameOrID: string): Promise<Database | null> {
    if (!this.state) throw new Error('State not loaded');

    return this.state.databases.find(
      db => db.name === nameOrID || db.id === nameOrID
    ) || null;
  }

  async getDatabaseByName(name: string): Promise<Database | null> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.databases.find(db => db.name === name) || null;
  }

  async getDatabaseByID(id: string): Promise<Database | null> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.databases.find(db => db.id === id) || null;
  }

  async updateDatabase(db: Database): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const index = this.state.databases.findIndex(d => d.id === db.id);
    if (index === -1) {
      throw new Error(`Database ${db.id} not found`);
    }

    this.state.databases[index] = db;
    await this.save();
  }

  async deleteDatabase(nameOrID: string): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const index = this.state.databases.findIndex(
      db => db.name === nameOrID || db.id === nameOrID
    );

    if (index === -1) {
      throw new Error(`Database '${nameOrID}' not found`);
    }

    this.state.databases.splice(index, 1);
    await this.save();
  }

  async listDatabases(): Promise<Database[]> {
    if (!this.state) throw new Error('State not loaded');
    return [...this.state.databases];
  }

  // Branch operations
  async addBranch(databaseID: string, branch: Branch): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const db = this.state.databases.find(d => d.id === databaseID);
    if (!db) {
      throw new Error(`Database ${databaseID} not found`);
    }

    if (db.branches.some(b => b.name === branch.name)) {
      throw new Error(`Branch '${branch.name}' already exists`);
    }

    db.branches.push(branch);
    await this.save();
  }

  async getBranch(nameOrID: string): Promise<{ branch: Branch; database: Database } | null> {
    if (!this.state) throw new Error('State not loaded');

    for (const db of this.state.databases) {
      const branch = db.branches.find(b => b.name === nameOrID || b.id === nameOrID);
      if (branch) {
        return { branch, database: db };
      }
    }

    return null;
  }

  async getBranchByNamespace(namespacedName: string): Promise<{ branch: Branch; database: Database } | null> {
    if (!this.state) throw new Error('State not loaded');

    for (const db of this.state.databases) {
      const branch = db.branches.find(b => b.name === namespacedName);
      if (branch) {
        return { branch, database: db };
      }
    }

    return null;
  }

  async getMainBranch(databaseName: string): Promise<Branch | null> {
    if (!this.state) throw new Error('State not loaded');

    const db = this.state.databases.find(d => d.name === databaseName);
    if (!db) return null;

    return db.branches.find(b => b.isPrimary) || null;
  }

  async updateBranch(databaseID: string, branch: Branch): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const db = this.state.databases.find(d => d.id === databaseID);
    if (!db) {
      throw new Error(`Database ${databaseID} not found`);
    }

    const index = db.branches.findIndex(b => b.id === branch.id);
    if (index === -1) {
      throw new Error(`Branch ${branch.id} not found`);
    }

    db.branches[index] = branch;
    await this.save();
  }

  async deleteBranch(databaseID: string, branchID: string): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const db = this.state.databases.find(d => d.id === databaseID);
    if (!db) {
      throw new Error(`Database ${databaseID} not found`);
    }

    const index = db.branches.findIndex(b => b.id === branchID);
    if (index === -1) {
      throw new Error(`Branch ${branchID} not found`);
    }

    db.branches.splice(index, 1);
    await this.save();
  }

  async listAllBranches(): Promise<Branch[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.databases.flatMap(db => db.branches);
  }


  // Backup operations
  async addBackup(backup: Backup): Promise<void> {
    if (!this.state) throw new Error('State not loaded');
    this.state.backups.push(backup);
    await this.save();
  }

  async getBackupsForDatabase(databaseID: string): Promise<Backup[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.backups.filter(b => b.databaseId === databaseID);
  }

  async deleteOldBackups(retentionDays: number): Promise<Backup[]> {
    if (!this.state) throw new Error('State not loaded');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const toDelete = this.state.backups.filter(b =>
      new Date(b.timestamp) < cutoff
    );

    this.state.backups = this.state.backups.filter(b =>
      new Date(b.timestamp) >= cutoff
    );

    await this.save();
    return toDelete;
  }

  // Snapshot operations
  async addSnapshot(snapshot: Snapshot): Promise<void> {
    if (!this.state) throw new Error('State not loaded');
    this.state.snapshots.push(snapshot);
    await this.save();
  }

  async getSnapshotsForBranch(branchName: string): Promise<Snapshot[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.snapshots.filter(s => s.branchName === branchName);
  }

  async getSnapshotsForDatabase(databaseName: string): Promise<Snapshot[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.snapshots.filter(s => s.databaseName === databaseName);
  }

  async getSnapshotById(id: string): Promise<Snapshot | undefined> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.snapshots.find(s => s.id === id);
  }

  async deleteSnapshot(id: string): Promise<void> {
    if (!this.state) throw new Error('State not loaded');
    const index = this.state.snapshots.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error(`Snapshot not found: ${id}`);
    }
    this.state.snapshots.splice(index, 1);
    await this.save();
  }

  async deleteOldSnapshots(branchName: string | undefined, retentionDays: number, dryRun: boolean = false): Promise<Snapshot[]> {
    if (!this.state) throw new Error('State not loaded');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const toDelete = this.state.snapshots.filter(s => {
      const isOld = new Date(s.createdAt) < cutoff;
      if (branchName) {
        return s.branchName === branchName && isOld;
      }
      return isOld;
    });

    if (!dryRun) {
      this.state.snapshots = this.state.snapshots.filter(s => {
        const isOld = new Date(s.createdAt) < cutoff;
        if (branchName) {
          return s.branchName !== branchName || !isOld;
        }
        return !isOld;
      });

      await this.save();
    }

    return toDelete;
  }

  async getAllSnapshots(): Promise<Snapshot[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.snapshots;
  }

  // Utility
  getState(): State {
    if (!this.state) throw new Error('State not loaded');
    return this.state;
  }

  private validate(): void {
    if (!this.state) throw new Error('State is null');

    if (!this.state.version || !this.state.zfsPool || !this.state.databases) {
      throw new Error('Invalid state structure');
    }

    const dbNames = new Set<string>();
    const branchNames = new Set<string>();

    for (const db of this.state.databases) {
      if (dbNames.has(db.name)) {
        throw new Error(`Duplicate database name: ${db.name}`);
      }
      dbNames.add(db.name);

      // Check that database has a main branch
      const mainBranch = db.branches.find(b => b.isPrimary);
      if (!mainBranch) {
        throw new Error(`Database '${db.name}' must have a main branch`);
      }

      for (const branch of db.branches) {
        // Branch name should be namespaced
        if (!branch.name.includes('/')) {
          throw new Error(`Branch name must be namespaced: ${branch.name}`);
        }

        if (branchNames.has(branch.name)) {
          throw new Error(`Duplicate branch name: ${branch.name}`);
        }
        branchNames.add(branch.name);

        // Validate branch belongs to correct database
        if (branch.databaseName !== db.name) {
          throw new Error(`Branch '${branch.name}' has incorrect databaseName`);
        }
      }
    }
  }

  private async acquireLock(): Promise<void> {
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      try {
        await fs.writeFile(this.lockFile, process.pid.toString(), { flag: 'wx' });
        return;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Check if lock is stale (process that created it is dead)
          try {
            const lockContent = await fs.readFile(this.lockFile, 'utf-8');
            const lockPid = parseInt(lockContent.trim(), 10);

            if (!isNaN(lockPid)) {
              try {
                // Signal 0 doesn't kill, just checks if process exists
                process.kill(lockPid, 0);
                // Process exists, wait and retry
                await Bun.sleep(100);
                attempts++;
              } catch (killError: any) {
                if (killError.code === 'ESRCH') {
                  // Process doesn't exist, remove stale lock
                  await fs.unlink(this.lockFile).catch(() => {});
                  // Try to acquire lock again immediately
                  continue;
                }
                throw killError;
              }
            } else {
              // Invalid PID in lock file, remove it
              await fs.unlink(this.lockFile).catch(() => {});
              continue;
            }
          } catch (readError) {
            // Can't read lock file, wait and retry
            await Bun.sleep(100);
            attempts++;
          }
        } else {
          throw error;
        }
      }
    }

    throw new Error('Failed to acquire state lock after 5 seconds');
  }

  private async releaseLock(): Promise<void> {
    try {
      await fs.unlink(this.lockFile);
    } catch (error) {
      // Ignore errors
    }
  }
}
