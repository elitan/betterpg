import { DockerManager } from '../managers/docker';
import { StateManager } from '../managers/state';

const STATE_PATH = '/var/lib/betterpg/state.json';

export async function startCommand(name: string) {
  try {
    console.log(`▶️  Starting: ${name}\n`);

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
      // Starting a database
      if (database.status === 'running') {
        console.log(`✓ Database '${name}' is already running`);
        return;
      }

      const containerID = await docker.getContainerByName(database.containerName);
      if (!containerID) {
        console.error(`❌ Container '${database.containerName}' not found`);
        process.exit(1);
      }

      console.log('🐳 Starting container...');
      await docker.startContainer(containerID);
      console.log('✓ Container started');

      console.log('⏳ Waiting for PostgreSQL to be ready...');
      await docker.waitForHealthy(containerID);
      console.log('✓ PostgreSQL is ready');

      // Update state
      database.status = 'running';
      await state.updateDatabase(database);

      console.log(`\n✅ Database '${name}' started successfully!`);
      console.log(`   Port: ${database.port}`);
    } else if (branchResult) {
      // Starting a branch
      const { branch, database: parentDb } = branchResult;

      if (branch.status === 'running') {
        console.log(`✓ Branch '${name}' is already running`);
        return;
      }

      const containerID = await docker.getContainerByName(branch.containerName);
      if (!containerID) {
        console.error(`❌ Container '${branch.containerName}' not found`);
        process.exit(1);
      }

      console.log('🐳 Starting container...');
      await docker.startContainer(containerID);
      console.log('✓ Container started');

      console.log('⏳ Waiting for PostgreSQL to be ready...');
      await docker.waitForHealthy(containerID);
      console.log('✓ PostgreSQL is ready');

      // Update state
      branch.status = 'running';
      await state.updateBranch(parentDb.id, branch);

      console.log(`\n✅ Branch '${name}' started successfully!`);
      console.log(`   Port: ${branch.port}`);
    }

  } catch (error: any) {
    console.error('❌ Failed to start:', error.message);
    process.exit(1);
  }
}
