import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';
import { ZFSManager } from '../managers/zfs';
import { ConfigManager } from '../managers/config';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatUptime(startedAt: Date | null): string {
  if (!startedAt) return 'N/A';

  const now = Date.now();
  const uptime = now - startedAt.getTime();

  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export async function statusCommand() {
  try {
    console.log('📊 BetterPG Status\n');

    const config = new ConfigManager(CONFIG_PATH);
    await config.load();
    const cfg = config.getConfig();

    const state = new StateManager(STATE_PATH);
    await state.load();

    const docker = new DockerManager();
    const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);

    // Get pool status
    const poolStatus = await zfs.getPoolStatus();
    console.log('🗄️  ZFS Pool:');
    console.log(`   Pool:      ${poolStatus.name}`);
    console.log(`   Health:    ${poolStatus.health}`);
    console.log(`   Size:      ${formatBytes(poolStatus.size)}`);
    console.log(`   Used:      ${formatBytes(poolStatus.allocated)} (${((poolStatus.allocated / poolStatus.size) * 100).toFixed(1)}%)`);
    console.log(`   Free:      ${formatBytes(poolStatus.free)}`);
    console.log();

    // Get all databases
    const databases = await state.listDatabases();

    if (databases.length === 0) {
      console.log('No databases found.');
      return;
    }

    console.log(`📊 Databases (${databases.length}):\n`);

    for (const db of databases) {
      // Get container status
      let containerStatus = null;
      const containerID = await docker.getContainerByName(db.containerName);
      if (containerID) {
        try {
          containerStatus = await docker.getContainerStatus(containerID);
        } catch {
          // Container doesn't exist
        }
      }

      const statusIcon = db.status === 'running' ? '🟢' : db.status === 'stopped' ? '🔴' : '⚪';
      const actualStatus = containerStatus ? containerStatus.state : db.status;

      console.log(`${statusIcon} ${db.name}`);
      console.log(`   Type:      Primary database`);
      console.log(`   Status:    ${actualStatus}`);
      console.log(`   Port:      ${db.port}`);
      console.log(`   Version:   PostgreSQL ${db.postgresVersion}`);
      console.log(`   Size:      ${formatBytes(db.sizeBytes)}`);
      console.log(`   Created:   ${new Date(db.createdAt).toLocaleString()}`);

      if (containerStatus && containerStatus.state === 'running' && containerStatus.startedAt) {
        console.log(`   Uptime:    ${formatUptime(containerStatus.startedAt)}`);
      }

      if (db.branches.length > 0) {
        console.log(`   Branches:  ${db.branches.length}`);

        for (const branch of db.branches) {
          // Get branch container status
          let branchContainerStatus = null;
          const branchContainerID = await docker.getContainerByName(branch.containerName);
          if (branchContainerID) {
            try {
              branchContainerStatus = await docker.getContainerStatus(branchContainerID);
            } catch {
              // Container doesn't exist
            }
          }

          const branchStatusIcon = branch.status === 'running' ? '🟢' : branch.status === 'stopped' ? '🔴' : '⚪';
          const actualBranchStatus = branchContainerStatus ? branchContainerStatus.state : branch.status;

          console.log(`   ${branchStatusIcon} └─ ${branch.name}`);
          console.log(`      Status:    ${actualBranchStatus}`);
          console.log(`      Port:      ${branch.port}`);
          console.log(`      Size:      ${formatBytes(branch.sizeBytes)}`);
          console.log(`      Created:   ${new Date(branch.createdAt).toLocaleString()}`);

          if (branchContainerStatus && branchContainerStatus.state === 'running' && branchContainerStatus.startedAt) {
            console.log(`      Uptime:    ${formatUptime(branchContainerStatus.startedAt)}`);
          }
        }
      }

      console.log();
    }

  } catch (error: any) {
    console.error('❌ Failed to get status:', error.message);
    process.exit(1);
  }
}
