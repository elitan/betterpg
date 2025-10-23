import { $ } from 'bun';
import { PATHS } from '../utils/paths';
import { UserError, SystemError } from '../errors';
import type { BackupConfig, Branch } from '../types/state';
import { WALManager } from './wal';

export interface BackupMetadata {
  id: string;
  branchName: string;         // Namespaced: <project>/<branch>
  datasetName: string;         // ZFS dataset name
  snapshotName: string;        // ZFS snapshot name with @
  timestamp: Date;
  sizeBytes: number;
  walFileCount: number;
  walSizeBytes: number;
}

export interface PushBackupOptions {
  snapshotOnly?: boolean;  // Only backup ZFS snapshot, skip WAL
  walOnly?: boolean;       // Only backup WAL files, skip snapshot
}

export interface PullBackupOptions {
  from?: string;          // Specific backup ID to restore from
  pitr?: string;          // Point-in-time recovery timestamp
}

export class BackupManager {
  private walManager: WALManager;
  private readonly KOPIA_PASSWORD = 'velo-backup-password';

  constructor(private config: BackupConfig) {
    this.walManager = new WALManager();
  }

  /**
   * Initialize Kopia repository to S3 backend
   */
  async initRepository(): Promise<void> {
    try {
      // Set Kopia config directory
      const configPath = this.config.kopiaConfigPath;
      await $`mkdir -p ${configPath}`.quiet();

      // Check if repository is already connected
      const checkResult = await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${configPath} kopia repository status`.nothrow().quiet();
      if (checkResult.exitCode === 0) {
        throw new UserError('Kopia repository already initialized');
      }

      // Initialize Kopia repository with S3 backend
      // Check if endpoint is localhost (use HTTP instead of HTTPS)
      const disableTLS = this.config.endpoint.includes('localhost') || this.config.endpoint.includes('127.0.0.1');

      await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${configPath} kopia repository create s3 \
        --bucket=${this.config.bucket} \
        --endpoint=${this.config.endpoint} \
        --access-key=${this.config.accessKeyId} \
        --secret-access-key=${this.config.secretAccessKey} \
        --prefix=${this.config.repositoryPath} \
        ${disableTLS ? '--disable-tls' : ''}`;

    } catch (error: any) {
      if (error instanceof UserError) {
        throw error;
      }
      throw new SystemError(`Failed to initialize Kopia repository: ${error.message}`);
    }
  }

  /**
   * Push backup: CHECKPOINT → ZFS snapshot → backup to S3 via Kopia
   */
  async pushBackup(
    branch: Branch,
    zfsPool: string,
    zfsDatasetBase: string,
    snapshotName: string,
    options: PushBackupOptions = {}
  ): Promise<BackupMetadata> {
    const { snapshotOnly = false, walOnly = false } = options;

    if (snapshotOnly && walOnly) {
      throw new UserError('Cannot use both --snapshot-only and --wal-only flags');
    }

    const datasetName = branch.zfsDataset;
    const fullDatasetPath = `${zfsPool}/${zfsDatasetBase}/${datasetName}`;
    const mountPath = `/${fullDatasetPath}`;
    const walArchivePath = this.walManager.getArchivePath(datasetName);

    let walFileCount = 0;
    let walSizeBytes = 0;
    let snapshotSizeBytes = 0;

    try {
      // Backup ZFS snapshot data (unless --wal-only)
      if (!walOnly) {
        // Get snapshot size
        const sizeResult = await $`zfs get -Hp -o value used ${fullDatasetPath}@${snapshotName}`.text();
        snapshotSizeBytes = parseInt(sizeResult.trim());

        // Backup snapshot data via Kopia
        // Note: Kopia prefixes all tag keys with "tag:" automatically
        // Use underscore separator for sub-keys to avoid "duplicate key" errors
        await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot create ${mountPath} \
          --tags=velo_branch:${branch.name} \
          --tags=velo_dataset:${datasetName} \
          --tags=velo_snapshot:${snapshotName}`;
      }

      // Backup WAL archives (unless --snapshot-only)
      if (!snapshotOnly) {
        const walInfo = await this.walManager.getArchiveInfo(datasetName);
        walFileCount = walInfo.fileCount;
        walSizeBytes = walInfo.sizeBytes;

        if (walFileCount > 0) {
          // Backup WAL archive directory via Kopia
          await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot create ${walArchivePath} \
            --tags=velo_branch:${branch.name} \
            --tags=velo_dataset:${datasetName} \
            --tags=velo_type:wal`;
        }
      }

      return {
        id: snapshotName,
        branchName: branch.name,
        datasetName,
        snapshotName,
        timestamp: new Date(),
        sizeBytes: snapshotSizeBytes,
        walFileCount,
        walSizeBytes,
      };
    } catch (error: any) {
      throw new SystemError(`Failed to push backup: ${error.message}`);
    }
  }

  /**
   * List backups for a branch (or all branches)
   */
  async listBackups(branchName?: string): Promise<BackupMetadata[]> {
    try {
      // List all snapshots from Kopia
      const result = await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot list --json`.text();
      const snapshots = JSON.parse(result);

      const backups: BackupMetadata[] = [];

      for (const snapshot of snapshots) {
        const tags = snapshot.tags || {};
        // Kopia prefixes all tag keys with "tag:"
        const branch = tags['tag:velo_branch'];
        const dataset = tags['tag:velo_dataset'];
        const snapshotName = tags['tag:velo_snapshot'];
        const type = tags['tag:velo_type'];

        // Skip WAL-only snapshots for now (we'll aggregate them)
        if (type === 'wal') continue;

        // Filter by branch if specified
        if (branchName && branch !== branchName) continue;

        backups.push({
          id: snapshotName || snapshot.id,
          branchName: branch || 'unknown',
          datasetName: dataset || 'unknown',
          snapshotName: snapshotName || 'unknown',
          timestamp: new Date(snapshot.startTime),
          sizeBytes: snapshot.stats?.totalFileSize || 0,
          walFileCount: 0,  // TODO: Aggregate WAL snapshots
          walSizeBytes: 0,
        });
      }

      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error: any) {
      throw new SystemError(`Failed to list backups: ${error.message}`);
    }
  }

  /**
   * Pull backup: Download from S3 → restore ZFS dataset
   *
   * Flow:
   * 1. Find backup to restore (by ID or latest)
   * 2. Restore snapshot data from Kopia to temp directory
   * 3. Create new ZFS dataset
   * 4. Copy restored data to ZFS mount point
   * 5. If PITR: restore WAL archives and configure recovery
   * 6. Return dataset name for container creation
   */
  async pullBackup(
    branchName: string,
    zfsPool: string,
    zfsDatasetBase: string,
    targetDatasetName: string,
    options: PullBackupOptions = {}
  ): Promise<{ datasetName: string; mountPath: string }> {
    const { from, pitr } = options;

    try {
      // 1. Find backup to restore
      let backupToRestore: BackupMetadata;

      if (from) {
        // Restore specific backup by ID
        const allBackups = await this.listBackups(branchName);
        const backup = allBackups.find(b => b.id === from || b.snapshotName === from);
        if (!backup) {
          throw new UserError(`Backup '${from}' not found for branch '${branchName}'`);
        }
        backupToRestore = backup;
      } else {
        // Restore latest backup
        const backups = await this.listBackups(branchName);
        if (backups.length === 0) {
          throw new UserError(`No backups found for branch '${branchName}'`);
        }
        backupToRestore = backups[0]; // Already sorted by timestamp DESC
      }

      console.log(`Restoring backup: ${backupToRestore.snapshotName} (${backupToRestore.timestamp.toISOString()})`);

      // 2. Find the Kopia snapshot ID
      const snapshotsResult = await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot list --json`.text();
      const snapshots = JSON.parse(snapshotsResult);

      const snapshot = snapshots.find((s: any) => {
        const tags = s.tags || {};
        return tags['tag:velo_branch'] === branchName &&
               tags['tag:velo_snapshot'] === backupToRestore.snapshotName &&
               !tags['tag:velo_type']; // Exclude WAL-only snapshots
      });

      if (!snapshot) {
        throw new SystemError(`Kopia snapshot not found for backup '${backupToRestore.snapshotName}'`);
      }

      // 3. Restore to temporary directory
      const tempDir = `/tmp/velo-restore-${Date.now()}`;
      await $`mkdir -p ${tempDir}`.quiet();

      console.log(`Restoring data from Kopia snapshot ${snapshot.id}...`);
      await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot restore ${snapshot.id} ${tempDir}`;

      // 4. Create ZFS dataset
      const fullDatasetPath = `${zfsPool}/${zfsDatasetBase}/${targetDatasetName}`;
      const mountPath = `/${fullDatasetPath}`;

      console.log(`Creating ZFS dataset: ${fullDatasetPath}`);
      const createResult = await $`zfs create -o compression=lz4 -o recordsize=8k ${fullDatasetPath}`.nothrow();
      if (createResult.exitCode !== 0) {
        throw new SystemError(`Failed to create ZFS dataset: ${createResult.stderr}`);
      }

      // Note: ZFS automatically mounts the dataset at creation

      // 5. Copy restored data to ZFS mount point
      console.log(`Copying data to ${mountPath}...`);
      // Use rsync for reliable copy with permissions
      const rsyncResult = await $`rsync -av --delete ${tempDir}/ ${mountPath}/`.nothrow();
      if (rsyncResult.exitCode !== 0) {
        throw new SystemError(`Failed to copy data: ${rsyncResult.stderr}`);
      }

      // 6. Set correct ownership (postgres:postgres = 999:999 in Docker)
      const chownResult = await $`sudo chown -R 999:999 ${mountPath}`.nothrow();
      if (chownResult.exitCode !== 0) {
        throw new SystemError(`Failed to set ownership: ${chownResult.stderr}`);
      }

      // 7. Handle PITR if requested
      if (pitr) {
        console.log(`Setting up point-in-time recovery to: ${pitr}`);

        // Find and restore WAL archives
        const walSnapshot = snapshots.find((s: any) => {
          const tags = s.tags || {};
          return tags['tag:velo_branch'] === branchName &&
                 tags['tag:velo_type'] === 'wal';
        });

        if (walSnapshot) {
          const walArchivePath = this.walManager.getArchivePath(targetDatasetName);
          await $`mkdir -p ${walArchivePath}`.quiet();

          console.log(`Restoring WAL archives...`);
          await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot restore ${walSnapshot.id} ${walArchivePath}`;
        }

        // Setup PITR recovery configuration
        await this.walManager.setupPITRecovery(mountPath, pitr);
      }

      // 8. Cleanup temp directory
      await $`rm -rf ${tempDir}`.quiet();

      console.log(`Restore complete: ${fullDatasetPath}`);

      return {
        datasetName: targetDatasetName,
        mountPath,
      };

    } catch (error: any) {
      if (error instanceof UserError) {
        throw error;
      }
      throw new SystemError(`Failed to pull backup: ${error.message}`);
    }
  }

  /**
   * Cleanup old backups from S3
   */
  async cleanupBackups(branchName: string, days: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const backups = await this.listBackups(branchName);
      let deletedCount = 0;

      for (const backup of backups) {
        if (backup.timestamp < cutoffDate) {
          // Delete from Kopia
          await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia snapshot delete ${backup.id} --delete`;
          deletedCount++;
        }
      }

      return deletedCount;
    } catch (error: any) {
      throw new SystemError(`Failed to cleanup backups: ${error.message}`);
    }
  }

  /**
   * Verify repository connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await $`KOPIA_PASSWORD=${this.KOPIA_PASSWORD} KOPIA_CONFIG_PATH=${this.config.kopiaConfigPath} kopia repository status`.quiet();
      return true;
    } catch {
      return false;
    }
  }
}
