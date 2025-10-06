import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';
import { generateUUID, sanitizeName, formatTimestamp } from '../utils/helpers';
import { Branch } from '../types/state';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

export interface BranchOptions {
  fast?: boolean;
}

export async function branchCommand(source: string, target: string, options: BranchOptions = {}) {
  try {
    const snapshotType = options.fast ? 'crash-consistent (fast)' : 'application-consistent';
    console.log(`🌿 Creating ${snapshotType} branch: ${source} → ${target}\n`);

    const config = new ConfigManager(CONFIG_PATH);
    await config.load();
    const cfg = config.getConfig();

    const state = new StateManager(STATE_PATH);
    await state.load();

    // Sanitize target name
    const sanitizedTarget = sanitizeName(target);
    if (sanitizedTarget !== target) {
      console.log(`📝 Sanitized name: ${target} → ${sanitizedTarget}`);
    }

    // Find source database
    const sourceDb = await state.getDatabase(source);
    if (!sourceDb) {
      console.log(`❌ Source database '${source}' not found`);
      process.exit(1);
    }

    // Check if target already exists
    const existingDb = await state.getDatabaseByName(sanitizedTarget);
    const existingBranch = await state.getBranch(sanitizedTarget);
    if (existingDb || existingBranch) {
      console.log(`❌ Database or branch '${sanitizedTarget}' already exists`);
      process.exit(1);
    }

    const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
    const docker = new DockerManager();

    // Create snapshot with appropriate consistency level
    const snapshotName = formatTimestamp(new Date());
    const fullSnapshotName = `${sourceDb.zfsDataset}@${snapshotName}`;

    let backupLSN: string | null = null;

    if (!options.fast && sourceDb.status === 'running') {
      // Application-consistent snapshot using pg_backup_start
      console.log(`📸 Starting PostgreSQL backup mode...`);
      const containerID = await docker.getContainerByName(sourceDb.containerName);
      if (!containerID) {
        throw new Error(`Container ${sourceDb.containerName} not found`);
      }

      try {
        // Execute backup start/snapshot/stop workflow
        // Note: pg_backup_start/stop must be in same psql session
        const combinedSQL = "SELECT pg_backup_start('betterpg-snapshot', false); SELECT lsn FROM pg_backup_stop();";

        // Start backup mode
        const startOutput = await docker.execSQL(
          containerID,
          "SELECT pg_backup_start('betterpg-snapshot', false);",
          sourceDb.credentials.username
        );
        console.log(`✓ Backup mode started (LSN: ${startOutput.trim()})`);

        // Create ZFS snapshot while in backup mode
        console.log(`📸 Creating snapshot: ${snapshotName}`);
        await zfs.createSnapshot(sourceDb.name, snapshotName);
        console.log('✓ Snapshot created');

        // Stop backup mode (must be in same session, so start+stop together)
        const fullOutput = await docker.execSQL(containerID, combinedSQL, sourceDb.credentials.username);
        const lines = fullOutput.split('\n').filter(l => l.trim());
        const stopLSN = lines[lines.length - 1];  // Last line is stop LSN
        console.log(`✓ Backup mode stopped (LSN: ${stopLSN})`);
      } catch (error: any) {
        // Try to clean up backup mode
        try {
          const cleanupSQL = "SELECT pg_backup_start('cleanup', false); SELECT pg_backup_stop();";
          await docker.execSQL(containerID, cleanupSQL, sourceDb.credentials.username).catch(() => {});
        } catch {}
        throw error;
      }
    } else {
      // Crash-consistent snapshot (fast mode or database is stopped)
      if (options.fast && sourceDb.status === 'running') {
        console.log(`⚡ Using crash-consistent snapshot (--fast mode)`);
        console.log(`⚠️  Note: Branch will require WAL replay on startup`);
      }
      console.log(`📸 Creating snapshot: ${snapshotName}`);
      await zfs.createSnapshot(sourceDb.name, snapshotName);
      console.log('✓ Snapshot created');
    }

    // Clone snapshot
    console.log(`\n📦 Cloning snapshot to: ${sanitizedTarget}`);
    await zfs.cloneSnapshot(fullSnapshotName, sanitizedTarget);
    console.log('✓ Clone created');

    const mountpoint = await zfs.getMountpoint(sanitizedTarget);
    const port = await state.allocatePort();

    // Pull image
    const imageExists = await docker.imageExists(cfg.postgres.image);
    if (!imageExists) {
      console.log(`\n🐳 Pulling image: ${cfg.postgres.image}`);
      await docker.pullImage(cfg.postgres.image);
    }

    // Create WAL archive directory
    const walArchivePath = `/var/lib/betterpg/wal-archive/${sanitizedTarget}`;
    await Bun.write(walArchivePath + '/.keep', '');

    // Create container
    const containerName = `bpg-${sanitizedTarget}`;
    console.log(`\n🐳 Creating container: ${containerName}`);
    const containerID = await docker.createContainer({
      name: containerName,
      version: cfg.postgres.version,
      port,
      dataPath: mountpoint,
      walArchivePath,
      password: sourceDb.credentials.password,
      username: sourceDb.credentials.username,
      database: sourceDb.credentials.database,
      sharedBuffers: cfg.postgres.config.shared_buffers,
      maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
    });

    await docker.startContainer(containerID);
    console.log('✓ Container started');

    await docker.waitForHealthy(containerID);
    console.log('✓ PostgreSQL ready');

    const sizeBytes = await zfs.getUsedSpace(sanitizedTarget);

    const branch: Branch = {
      id: generateUUID(),
      name: sanitizedTarget,
      parentId: sourceDb.id,
      snapshotName: fullSnapshotName,
      zfsDataset: `${cfg.zfs.pool}/${cfg.zfs.datasetBase}/${sanitizedTarget}`,
      containerName,
      port,
      createdAt: new Date().toISOString(),
      sizeBytes,
      status: 'running',
    };

    await state.addBranch(sourceDb.id, branch);

    console.log('\n✅ Branch created successfully!\n');
    console.log('Connection details:');
    console.log(`  Host:     localhost`);
    console.log(`  Port:     ${port}`);
    console.log(`  Database: ${sourceDb.credentials.database}`);
    console.log(`  Username: ${sourceDb.credentials.username}`);
    console.log(`  Password: ${sourceDb.credentials.password}\n`);

  } catch (error: any) {
    console.error('❌ Failed to create branch:', error.message);
    process.exit(1);
  }
}
