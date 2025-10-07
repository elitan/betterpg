import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { sanitizeName } from '../../utils/helpers';
import { buildNamespace } from '../../utils/namespace';

export async function projectRenameCommand(oldName: string, newName: string) {
  console.log();
  console.log(chalk.bold(`✏️  Renaming project: ${chalk.cyan(oldName)} → ${chalk.cyan(newName)}`));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const project = await state.getProjectByName(oldName);
  if (!project) {
    throw new Error(`Project '${oldName}' not found`);
  }

  // Sanitize new name
  const sanitizedNewName = sanitizeName(newName);
  if (sanitizedNewName !== newName) {
    console.log(chalk.yellow(`📝 Sanitized name: ${newName} → ${sanitizedNewName}`));
  }

  // Check if new name already exists
  const existing = await state.getProjectByName(sanitizedNewName);
  if (existing) {
    throw new Error(`Project '${sanitizedNewName}' already exists`);
  }

  console.log(chalk.yellow('⚠️  Warning: Renaming requires stopping all branches, updating containers, and restarting.'));
  console.log(chalk.yellow('This feature is not yet implemented.'));
  console.log();
  console.log(chalk.dim('Workaround: Create a new project and migrate data manually.'));
  console.log();

  throw new Error('Project rename not yet implemented');
}
