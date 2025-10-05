import { StateManager } from '../managers/state';
import { formatBytes } from '../utils/helpers';

const STATE_PATH = '/var/lib/betterpg/state.json';

export async function listCommand() {
  try {
    const state = new StateManager(STATE_PATH);
    await state.load();

    const databases = await state.listDatabases();

    if (databases.length === 0) {
      console.log('No databases found. Create one with: bpg create <name>');
      return;
    }

    console.log('\n📊 Databases and Branches\n');

    for (const db of databases) {
      const statusIcon = db.status === 'running' ? '🟢' : '🔴';

      console.log(`${statusIcon} ${db.name} (primary)`);
      console.log(`   Port:    ${db.port}`);
      console.log(`   Size:    ${formatBytes(db.sizeBytes)}`);
      console.log(`   Status:  ${db.status}`);
      console.log(`   Created: ${new Date(db.createdAt).toLocaleString()}`);

      if (db.branches.length > 0) {
        console.log(`   Branches:`);
        for (const branch of db.branches) {
          const branchIcon = branch.status === 'running' ? '  🟢' : '  🔴';
          console.log(`${branchIcon} ${branch.name}`);
          console.log(`      Port:    ${branch.port}`);
          console.log(`      Size:    ${formatBytes(branch.sizeBytes)}`);
          console.log(`      Created: ${new Date(branch.createdAt).toLocaleString()}`);
        }
      }

      console.log('');
    }
  } catch (error: any) {
    console.error('❌ Failed to list databases:', error.message);
    process.exit(1);
  }
}
