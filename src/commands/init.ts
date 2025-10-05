import { $ } from 'bun';
import { ZFSManager } from '../managers/zfs';
import { StateManager } from '../managers/state';
import { ConfigManager, DEFAULT_CONFIG } from '../managers/config';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_PATH = '/etc/betterpg/config.yaml';
const STATE_PATH = '/var/lib/betterpg/state.json';

export async function initCommand(options: { pool?: string; datasetBase?: string } = {}) {
  try {
    console.log('🚀 Initializing betterpg...\n');

    // Check if already initialized
    try {
      await fs.access(STATE_PATH);
      console.log('❌ betterpg is already initialized');
      console.log(`   State file exists at: ${STATE_PATH}`);
      process.exit(1);
    } catch {
      // Not initialized, continue
    }

    // Use provided options or defaults
    const pool = options.pool || DEFAULT_CONFIG.zfs.pool;
    const datasetBase = options.datasetBase || DEFAULT_CONFIG.zfs.datasetBase;

    // Initialize ZFS
    console.log(`📦 Checking ZFS pool: ${pool}`);
    const zfs = new ZFSManager(pool, datasetBase);

    const poolExists = await zfs.poolExists();
    if (!poolExists) {
      console.log(`❌ ZFS pool '${pool}' not found`);
      console.log(`   Please create the pool first with: zpool create ${pool} <device>`);
      process.exit(1);
    }

    console.log('✓ ZFS pool found');

    // Create base dataset
    console.log(`\n📁 Creating base dataset: ${pool}/${datasetBase}`);

    try {
      await $`zfs list ${pool}/${datasetBase}`.quiet();
      console.log('✓ Base dataset already exists');
    } catch {
      await $`zfs create -o compression=${DEFAULT_CONFIG.zfs.compression} -o recordsize=${DEFAULT_CONFIG.zfs.recordsize} ${pool}/${datasetBase}`;
      console.log('✓ Base dataset created');
    }

    // Create config directory and file
    console.log('\n⚙️  Creating configuration...');
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });

    const config = new ConfigManager(CONFIG_PATH);
    await config.createDefault();
    console.log(`✓ Config created at: ${CONFIG_PATH}`);

    // Create state directory and file
    console.log('\n💾 Initializing state...');
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });

    const state = new StateManager(STATE_PATH);
    await state.initialize(pool, datasetBase, DEFAULT_CONFIG.postgres.basePort);
    console.log(`✓ State initialized at: ${STATE_PATH}`);

    // Create WAL archive directory
    const walArchiveDir = '/var/lib/betterpg/wal-archive';
    await fs.mkdir(walArchiveDir, { recursive: true });
    console.log(`✓ WAL archive directory: ${walArchiveDir}`);

    console.log('\n✅ betterpg initialized successfully!\n');
    console.log('Next steps:');
    console.log('  1. Create a database: bpg create myapp-prod');
    console.log('  2. Create a branch:   bpg branch myapp-prod myapp-dev\n');

  } catch (error: any) {
    console.error('❌ Initialization failed:', error.message);
    process.exit(1);
  }
}
