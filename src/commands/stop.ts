import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';

const STATE_PATH = '/var/lib/betterpg/state.json';

export async function stopCommand(name: string) {
  try {
    console.log(`⏸️  Stopping: ${name}\n`);

    // Load state
    const state = new StateManager(STATE_PATH);
    await state.load();

    // Initialize managers
    const docker = new DockerManager();

    // Check if it's a database or branch
    const database = await state.getDatabase(name);
    const branchResult = await state.getBranch(name);

    if (!database && !branchResult) {
      console.error(`❌ Database or branch '${name}' not found`);
      process.exit(1);
    }

    if (database) {
      // Stopping a database
      if (database.status === 'stopped') {
        console.log(`✓ Database '${name}' is already stopped`);
        return;
      }

      const containerID = await docker.getContainerByName(database.containerName);
      if (!containerID) {
        console.error(`❌ Container '${database.containerName}' not found`);
        process.exit(1);
      }

      console.log('🐳 Stopping container...');
      await docker.stopContainer(containerID);
      console.log('✓ Container stopped');

      // Update state
      database.status = 'stopped';
      await state.updateDatabase(database);

      console.log(`\n✅ Database '${name}' stopped successfully!`);
    } else if (branchResult) {
      // Stopping a branch
      const { branch, database: parentDb } = branchResult;

      if (branch.status === 'stopped') {
        console.log(`✓ Branch '${name}' is already stopped`);
        return;
      }

      const containerID = await docker.getContainerByName(branch.containerName);
      if (!containerID) {
        console.error(`❌ Container '${branch.containerName}' not found`);
        process.exit(1);
      }

      console.log('🐳 Stopping container...');
      await docker.stopContainer(containerID);
      console.log('✓ Container stopped');

      // Update state
      branch.status = 'stopped';
      await state.updateBranch(parentDb.id, branch);

      console.log(`\n✅ Branch '${name}' stopped successfully!`);
    }

  } catch (error: any) {
    console.error('❌ Failed to stop:', error.message);
    process.exit(1);
  }
}
