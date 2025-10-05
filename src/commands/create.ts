import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';
import { generateUUID, generatePassword, sanitizeName } from '../utils/helpers';
import { Database } from '../types/state';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

export async function createCommand(name: string) {
  try {
    console.log(`🚀 Creating database: ${name}\n`);

    // Load config and state
    const config = new ConfigManager(CONFIG_PATH);
    await config.load();
    const cfg = config.getConfig();

    const state = new StateManager(STATE_PATH);
    await state.load();

    // Sanitize and validate name
    const sanitizedName = sanitizeName(name);
    if (sanitizedName !== name) {
      console.log(`📝 Sanitized name: ${name} → ${sanitizedName}`);
    }

    // Check if database already exists
    const existing = await state.getDatabaseByName(sanitizedName);
    if (existing) {
      console.log(`❌ Database '${sanitizedName}' already exists`);
      process.exit(1);
    }

    // Initialize managers
    const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
    const docker = new DockerManager();

    // Allocate port
    const port = await state.allocatePort();
    console.log(`📡 Allocated port: ${port}`);

    // Create ZFS dataset
    console.log(`\n📦 Creating ZFS dataset: ${sanitizedName}`);
    await zfs.createDataset(sanitizedName, {
      compression: cfg.zfs.compression,
      recordsize: cfg.zfs.recordsize,
    });
    console.log('✓ Dataset created');

    // Get dataset mountpoint
    const mountpoint = await zfs.getMountpoint(sanitizedName);
    const pgdataPath = `${mountpoint}/pgdata`;

    // Generate credentials
    const password = generatePassword();
    const containerName = `bpg-${sanitizedName}`;

    // Pull PostgreSQL image
    console.log(`\n🐳 Pulling PostgreSQL image: ${cfg.postgres.image}`);
    const imageExists = await docker.imageExists(cfg.postgres.image);
    if (!imageExists) {
      await docker.pullImage(cfg.postgres.image);
      console.log('✓ Image pulled');
    } else {
      console.log('✓ Image already exists');
    }

    // Create WAL archive directory
    const walArchivePath = `/var/lib/betterpg/wal-archive/${sanitizedName}`;
    await Bun.write(walArchivePath + '/.keep', '');

    // Create Docker container
    console.log('\n🐳 Creating PostgreSQL container...');
    const containerID = await docker.createContainer({
      name: containerName,
      version: cfg.postgres.version,
      port,
      dataPath: mountpoint,
      walArchivePath,
      password,
      username: 'postgres',
      database: 'postgres',
      sharedBuffers: cfg.postgres.config.shared_buffers,
      maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
      extraConfig: cfg.postgres.config,
    });
    console.log(`✓ Container created: ${containerID.slice(0, 12)}`);

    // Start container
    console.log('\n▶️  Starting container...');
    await docker.startContainer(containerID);
    console.log('✓ Container started');

    // Wait for PostgreSQL to be ready
    console.log('⏳ Waiting for PostgreSQL to be ready...');
    await docker.waitForHealthy(containerID);
    console.log('✓ PostgreSQL is ready');

    // Get dataset size
    const sizeBytes = await zfs.getUsedSpace(sanitizedName);

    // Create database record
    const database: Database = {
      id: generateUUID(),
      name: sanitizedName,
      type: 'primary',
      zfsDataset: `${cfg.zfs.pool}/${cfg.zfs.datasetBase}/${sanitizedName}`,
      containerName,
      port,
      postgresVersion: cfg.postgres.version,
      createdAt: new Date().toISOString(),
      sizeBytes,
      status: 'running',
      credentials: {
        username: 'postgres',
        password,
        database: 'postgres',
      },
      branches: [],
    };

    await state.addDatabase(database);

    console.log('\n✅ Database created successfully!\n');
    console.log('Connection details:');
    console.log(`  Host:     localhost`);
    console.log(`  Port:     ${port}`);
    console.log(`  Database: postgres`);
    console.log(`  Username: postgres`);
    console.log(`  Password: ${password}`);
    console.log(`\nConnection string:`);
    console.log(`  postgresql://postgres:${password}@localhost:${port}/postgres\n`);

  } catch (error: any) {
    console.error('❌ Failed to create database:', error.message);
    process.exit(1);
  }
}
