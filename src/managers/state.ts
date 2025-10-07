import * as fs from 'fs/promises';
import { State, Project, Branch, Backup } from '../types/state';

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
      projects: [],
      backups: [],
      snapshots: [],
    };

    await this.save();
  }

  // Project operations
  async addProject(proj: Project): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    if (this.state.projects.some(p => p.name === proj.name)) {
      throw new Error(`Project '${proj.name}' already exists`);
    }

    this.state.projects.push(proj);
    await this.save();
  }

  async getProject(nameOrID: string): Promise<Project | null> {
    if (!this.state) throw new Error('State not loaded');

    return this.state.projects.find(
      proj => proj.name === nameOrID || proj.id === nameOrID
    ) || null;
  }

  async getProjectByName(name: string): Promise<Project | null> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.projects.find(proj => proj.name === name) || null;
  }

  async getProjectByID(id: string): Promise<Project | null> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.projects.find(proj => proj.id === id) || null;
  }

  async updateProject(proj: Project): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const index = this.state.projects.findIndex(p => p.id === proj.id);
    if (index === -1) {
      throw new Error(`Project ${proj.id} not found`);
    }

    this.state.projects[index] = proj;
    await this.save();
  }

  async deleteProject(nameOrID: string): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const index = this.state.projects.findIndex(
      proj => proj.name === nameOrID || proj.id === nameOrID
    );

    if (index === -1) {
      throw new Error(`Project '${nameOrID}' not found`);
    }

    this.state.projects.splice(index, 1);
    await this.save();
  }

  async listProjects(): Promise<Project[]> {
    if (!this.state) throw new Error('State not loaded');
    return [...this.state.projects];
  }

  // Branch operations
  async addBranch(projectID: string, branch: Branch): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const proj = this.state.projects.find(p => p.id === projectID);
    if (!proj) {
      throw new Error(`Project ${projectID} not found`);
    }

    if (proj.branches.some(b => b.name === branch.name)) {
      throw new Error(`Branch '${branch.name}' already exists`);
    }

    proj.branches.push(branch);
    await this.save();
  }

  async getBranch(nameOrID: string): Promise<{ branch: Branch; project: Project } | null> {
    if (!this.state) throw new Error('State not loaded');

    for (const proj of this.state.projects) {
      const branch = proj.branches.find(b => b.name === nameOrID || b.id === nameOrID);
      if (branch) {
        return { branch, project: proj };
      }
    }

    return null;
  }

  async getBranchByNamespace(namespacedName: string): Promise<{ branch: Branch; project: Project } | null> {
    if (!this.state) throw new Error('State not loaded');

    for (const proj of this.state.projects) {
      const branch = proj.branches.find(b => b.name === namespacedName);
      if (branch) {
        return { branch, project: proj };
      }
    }

    return null;
  }

  async getMainBranch(projectName: string): Promise<Branch | null> {
    if (!this.state) throw new Error('State not loaded');

    const proj = this.state.projects.find(p => p.name === projectName);
    if (!proj) return null;

    return proj.branches.find(b => b.isPrimary) || null;
  }

  async updateBranch(projectID: string, branch: Branch): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const proj = this.state.projects.find(p => p.id === projectID);
    if (!proj) {
      throw new Error(`Project ${projectID} not found`);
    }

    const index = proj.branches.findIndex(b => b.id === branch.id);
    if (index === -1) {
      throw new Error(`Branch ${branch.id} not found`);
    }

    proj.branches[index] = branch;
    await this.save();
  }

  async deleteBranch(projectID: string, branchID: string): Promise<void> {
    if (!this.state) throw new Error('State not loaded');

    const proj = this.state.projects.find(p => p.id === projectID);
    if (!proj) {
      throw new Error(`Project ${projectID} not found`);
    }

    const index = proj.branches.findIndex(b => b.id === branchID);
    if (index === -1) {
      throw new Error(`Branch ${branchID} not found`);
    }

    proj.branches.splice(index, 1);
    await this.save();
  }

  async listAllBranches(): Promise<Branch[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.projects.flatMap(proj => proj.branches);
  }


  // Backup operations
  async addBackup(backup: Backup): Promise<void> {
    if (!this.state) throw new Error('State not loaded');
    this.state.backups.push(backup);
    await this.save();
  }

  async getBackupsForProject(projectID: string): Promise<Backup[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.backups.filter(b => b.projectId === projectID);
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

  async getSnapshotsForProject(projectName: string): Promise<Snapshot[]> {
    if (!this.state) throw new Error('State not loaded');
    return this.state.snapshots.filter(s => s.projectName === projectName);
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

    if (!this.state.version || !this.state.zfsPool || !this.state.projects) {
      throw new Error('Invalid state structure');
    }

    const projNames = new Set<string>();
    const branchNames = new Set<string>();

    for (const proj of this.state.projects) {
      if (projNames.has(proj.name)) {
        throw new Error(`Duplicate project name: ${proj.name}`);
      }
      projNames.add(proj.name);

      // Check that project has a main branch
      const mainBranch = proj.branches.find(b => b.isPrimary);
      if (!mainBranch) {
        throw new Error(`Project '${proj.name}' must have a main branch`);
      }

      for (const branch of proj.branches) {
        // Branch name should be namespaced
        if (!branch.name.includes('/')) {
          throw new Error(`Branch name must be namespaced: ${branch.name}`);
        }

        if (branchNames.has(branch.name)) {
          throw new Error(`Duplicate branch name: ${branch.name}`);
        }
        branchNames.add(branch.name);

        // Validate branch belongs to correct project
        if (branch.projectName !== proj.name) {
          throw new Error(`Branch '${branch.name}' has incorrect projectName`);
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
