import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

export async function resetCommand(name: string) {
  try {
    console.log(`🔄 Resetting branch: ${name}\n`);

    const config = new ConfigManager(CONFIG_PATH);
    await config.load();
    const cfg = config.getConfig();

    const state = new StateManager(STATE_PATH);
    await state.load();

    // Check if it's a branch
    const branchResult = await state.getBranch(name);

    if (!branchResult) {
      console.error(`❌ Branch '${name}' not found. Only branches can be reset.`);
      process.exit(1);
    }

    const { branch, database: parentDb } = branchResult;

    const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
    const docker = new DockerManager();

    // Stop the container
    console.log('🐳 Stopping container...');
    const containerID = await docker.getContainerByName(branch.containerName);
    if (!containerID) {
      console.error(`❌ Container '${branch.containerName}' not found`);
      process.exit(1);
    }

    await docker.stopContainer(containerID);
    console.log('✓ Container stopped');

    // Remove the container
    console.log('🗑️  Removing container...');
    await docker.removeContainer(containerID);
    console.log('✓ Container removed');

    // Destroy the ZFS clone
    console.log('🗑️  Destroying ZFS dataset...');
    await zfs.destroyDataset(branch.name);
    console.log('✓ Dataset destroyed');

    // Re-clone from the original snapshot
    console.log(`📦 Re-cloning from snapshot: ${branch.snapshotName}`);
    await zfs.cloneSnapshot(branch.snapshotName, branch.name);
    console.log('✓ Clone created');

    const mountpoint = await zfs.getMountpoint(branch.name);

    // Create WAL archive directory
    const walArchivePath = `/var/lib/betterpg/wal-archive/${branch.name}`;
    await Bun.write(walArchivePath + '/.keep', '');

    // Recreate container
    console.log('🐳 Recreating container...');
    const newContainerID = await docker.createContainer({
      name: branch.containerName,
      version: cfg.postgres.version,
      port: branch.port,
      dataPath: mountpoint,
      walArchivePath,
      password: parentDb.credentials.password,
      username: parentDb.credentials.username,
      database: parentDb.credentials.database,
      sharedBuffers: cfg.postgres.config.shared_buffers,
      maxConnections: parseInt(cfg.postgres.config.max_connections, 10),
    });

    await docker.startContainer(newContainerID);
    console.log('✓ Container started');

    console.log('⏳ Waiting for PostgreSQL to be ready...');
    await docker.waitForHealthy(newContainerID);
    console.log('✓ PostgreSQL is ready');

    // Update state
    const sizeBytes = await zfs.getUsedSpace(branch.name);
    branch.sizeBytes = sizeBytes;
    branch.status = 'running';
    await state.updateBranch(parentDb.id, branch);

    console.log(`\n✅ Branch '${name}' has been reset to parent snapshot!`);
    console.log(`   Port: ${branch.port}`);

  } catch (error: any) {
    console.error('❌ Failed to reset branch:', error.message);
    process.exit(1);
  }
}
