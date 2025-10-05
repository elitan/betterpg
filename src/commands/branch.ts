import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';
import { generateUUID, sanitizeName, formatTimestamp } from '../utils/helpers';
import { Branch } from '../types/state';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

export async function branchCommand(source: string, target: string) {
  try {
    console.log(`🌿 Creating branch: ${source} → ${target}\n`);

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

    // Create snapshot
    const snapshotName = formatTimestamp(new Date());
    const fullSnapshotName = `${sourceDb.zfsDataset}@${snapshotName}`;

    console.log(`📸 Creating snapshot: ${snapshotName}`);
    await zfs.createSnapshot(sourceDb.name, snapshotName);
    console.log('✓ Snapshot created');

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
