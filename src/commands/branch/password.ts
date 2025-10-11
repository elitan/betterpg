import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { UserError } from '../../errors';

export async function branchPasswordCommand(name: string) {
  const namespace = parseNamespace(name);

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new UserError(
      `Branch '${name}' not found`,
      "Run 'pgd branch list' to see available branches"
    );
  }

  const { branch, project } = result;

  console.log();
  console.log(chalk.bold(`Connection details for ${name}`));
  console.log();
  console.log(chalk.dim('  Host:    '), 'localhost');
  console.log(chalk.dim('  Port:    '), branch.port);
  console.log(chalk.dim('  Database:'), project.credentials.database);
  console.log(chalk.dim('  Username:'), project.credentials.username);
  console.log(chalk.dim('  Password:'), project.credentials.password);
  console.log();
  console.log(chalk.bold('Connection string:'));
  console.log(`  postgresql://${project.credentials.username}:${project.credentials.password}@localhost:${branch.port}/${project.credentials.database}`);
  console.log();
}
