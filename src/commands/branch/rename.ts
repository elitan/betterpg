import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

export async function branchRenameCommand(oldName: string, newName: string) {
  console.log();
  console.log(`Renaming branch ${chalk.cyan(oldName)} to ${chalk.cyan(newName)}...`);
  console.log();

  // Parse both namespaces
  const oldNs = parseNamespace(oldName);
  const newNs = parseNamespace(newName);

  // Must be in same project
  if (oldNs.project !== newNs.project) {
    throw new Error(`Cannot rename branch across projects. Both must be in '${oldNs.project}'`);
  }

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(oldName);
  if (!result) {
    throw new Error(`Branch '${oldName}' not found`);
  }

  const { branch, project } = result;

  // Prevent renaming main branch
  if (branch.isPrimary) {
    throw new Error(`Cannot rename main branch`);
  }

  // Check if new name already exists
  const existing = await state.getBranchByNamespace(newName);
  if (existing) {
    throw new Error(`Branch '${newName}' already exists`);
  }

  console.log(chalk.yellow('Warning: Renaming requires stopping the branch, updating the container, and restarting.'));
  console.log(chalk.yellow('This feature is not yet implemented.'));
  console.log();
  console.log(chalk.dim('Workaround: Create a new branch and delete the old one.'));
  console.log();

  throw new Error('Branch rename not yet implemented');
}
