import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { sanitizeName } from '../../utils/helpers';
import { buildNamespace } from '../../utils/namespace';

export async function dbRenameCommand(oldName: string, newName: string) {
  console.log();
  console.log(chalk.bold(`✏️  Renaming database: ${chalk.cyan(oldName)} → ${chalk.cyan(newName)}`));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const database = await state.getDatabaseByName(oldName);
  if (!database) {
    throw new Error(`Database '${oldName}' not found`);
  }

  // Sanitize new name
  const sanitizedNewName = sanitizeName(newName);
  if (sanitizedNewName !== newName) {
    console.log(chalk.yellow(`📝 Sanitized name: ${newName} → ${sanitizedNewName}`));
  }

  // Check if new name already exists
  const existing = await state.getDatabaseByName(sanitizedNewName);
  if (existing) {
    throw new Error(`Database '${sanitizedNewName}' already exists`);
  }

  console.log(chalk.yellow('⚠️  Warning: Renaming requires stopping all branches, updating containers, and restarting.'));
  console.log(chalk.yellow('This feature is not yet implemented.'));
  console.log();
  console.log(chalk.dim('Workaround: Create a new database and migrate data manually.'));
  console.log();

  throw new Error('Database rename not yet implemented');
}
