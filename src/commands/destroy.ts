import { ZFSManager } from '../managers/zfs';
import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ConfigManager } from '../managers/config';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

export async function destroyCommand(name: string, options: { force?: boolean } = {}) {
  try {
    const config = new ConfigManager(CONFIG_PATH);
    await config.load();
    const cfg = config.getConfig();

    const state = new StateManager(STATE_PATH);
    await state.load();

    const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);
    const docker = new DockerManager();

    // Check if it's a database
    const database = await state.getDatabase(name);
    if (database) {
      // Check if it has branches
      if (database.branches.length > 0 && !options.force) {
        console.log(`❌ Database '${name}' has ${database.branches.length} branch(es)`);
        console.log('   Delete branches first, or use --force to destroy everything');
        console.log('\n   Branches:');
        database.branches.forEach(b => console.log(`     - ${b.name}`));
        process.exit(1);
      }

      console.log(`🗑️  Destroying database: ${name}\n`);

      // Destroy all branches first if force is used
      if (database.branches.length > 0 && options.force) {
        console.log(`⚠️  Force destroying ${database.branches.length} branch(es)...`);
        for (const branch of database.branches) {
          await destroyBranch(branch.containerName, branch.name, zfs, docker);
          await state.deleteBranch(database.id, branch.id);
        }
      }

      // Stop and remove container
      console.log('🐳 Removing container...');
      const containerID = await docker.getContainerByName(database.containerName);
      if (containerID) {
        await docker.stopContainer(containerID);
        await docker.removeContainer(containerID);
        console.log('✓ Container removed');
      }

      // Destroy ZFS dataset
      console.log('📦 Destroying ZFS dataset...');
      await zfs.destroyDataset(database.name, true);
      console.log('✓ Dataset destroyed');

      // Remove from state
      await state.deleteDatabase(database.id);

      console.log(`\n✅ Database '${name}' destroyed successfully`);
      return;
    }

    // Check if it's a branch
    const branchResult = await state.getBranch(name);
    if (branchResult) {
      console.log(`🗑️  Destroying branch: ${name}\n`);

      await destroyBranch(branchResult.branch.containerName, branchResult.branch.name, zfs, docker);
      await state.deleteBranch(branchResult.database.id, branchResult.branch.id);

      console.log(`\n✅ Branch '${name}' destroyed successfully`);
      return;
    }

    console.log(`❌ Database or branch '${name}' not found`);
    process.exit(1);

  } catch (error: any) {
    console.error('❌ Failed to destroy:', error.message);
    process.exit(1);
  }
}

async function destroyBranch(
  containerName: string,
  datasetName: string,
  zfs: ZFSManager,
  docker: DockerManager
) {
  // Stop and remove container
  const containerID = await docker.getContainerByName(containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }

  // Destroy ZFS clone
  await zfs.destroyDataset(datasetName, true);
}
