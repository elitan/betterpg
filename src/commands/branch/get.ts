import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';
import { parseNamespace } from '../../utils/namespace';

export async function branchGetCommand(name: string) {
  const namespace = parseNamespace(name);

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = result;

  console.log();
  console.log(`Branch: ${chalk.cyan(name)}`);
  console.log();
  console.log(chalk.dim('  Status       '), branch.status === 'running' ? 'running' : 'stopped');
  console.log(chalk.dim('  Port         '), branch.port.toString());
  console.log(chalk.dim('  Size         '), formatBytes(branch.sizeBytes));
  console.log(chalk.dim('  Created      '), new Date(branch.createdAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'));
  if (branch.parentBranchId) {
    const parentBranch = project.branches.find(b => b.id === branch.parentBranchId);
    if (parentBranch) {
      console.log(chalk.dim('  Parent       '), parentBranch.name);
    }
  }
  if (branch.snapshotName) {
    const snapshotShortName = branch.snapshotName.split('@')[1];
    console.log(chalk.dim('  Snapshot     '), snapshotShortName);
  }
  console.log();
  console.log('Connection:');
  console.log(`  postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${branch.port}/${project.credentials.database}`);
  console.log();
}
