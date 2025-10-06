import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';

export async function dbListCommand() {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const databases = await state.listDatabases();

  if (databases.length === 0) {
    console.log(chalk.dim('No databases found. Create one with:'), chalk.cyan('bpg db create <name>'));
    return;
  }

  const table = new Table({
    head: ['Name', 'Branches', 'Running', 'Version', 'Created'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });

  for (const db of databases) {
    const totalBranches = db.branches.length;
    const runningBranches = db.branches.filter(b => b.status === 'running').length;

    table.push([
      chalk.bold(db.name),
      totalBranches.toString(),
      `${runningBranches}/${totalBranches}`,
      chalk.dim(`PG ${db.postgresVersion}`),
      new Date(db.createdAt).toLocaleString()
    ]);
  }

  console.log();
  console.log(table.toString());
  console.log();
}
