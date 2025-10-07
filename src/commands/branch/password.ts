import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

export async function branchPasswordCommand(name: string) {
  const namespace = parseNamespace(name);

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = result;

  console.log();
  console.log(chalk.bold('Connection details for ') + chalk.cyan(name));
  console.log();
  console.log(chalk.dim('  Host:    '), 'localhost');
  console.log(chalk.dim('  Port:    '), branch.port);
  console.log(chalk.dim('  Database:'), project.credentials.database);
  console.log(chalk.dim('  Username:'), project.credentials.username);
  console.log(chalk.dim('  Password:'), chalk.yellow(project.credentials.password));
  console.log();
  console.log(chalk.bold('Connection string:'));
  console.log(chalk.cyan(`postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${branch.port}/${project.credentials.database}`));
  console.log();
}
