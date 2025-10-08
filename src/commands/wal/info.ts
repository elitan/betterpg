import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { WALManager } from '../../managers/wal';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { formatRelativeTime } from '../../utils/time';

export async function walInfoCommand(branchName?: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const wal = new WALManager();

  console.log();
  console.log(chalk.bold('📦 WAL Archive Status'));
  console.log();

  if (branchName) {
    // Show info for specific branch
    const target = parseNamespace(branchName);
    const proj = await state.getProjectByName(target.project);
    if (!proj) {
      throw new Error(`Project '${target.project}' not found`);
    }

    const branch = proj.branches.find(b => b.name === target.full);
    if (!branch) {
      throw new Error(`Branch '${target.full}' not found`);
    }

    const datasetName = branch.zfsDataset.split('/').pop() || '';
    const info = await wal.getArchiveInfo(datasetName);

    console.log(chalk.bold(`Branch: ${chalk.cyan(target.full)}`));
    console.log();
    console.log(chalk.dim('Archive path:  '), info.path);
    console.log(chalk.dim('File count:    '), info.fileCount);
    console.log(chalk.dim('Total size:    '), formatSize(info.sizeBytes));

    if (info.oldestWAL && info.oldestTimestamp) {
      console.log(chalk.dim('Oldest WAL:    '), info.oldestWAL);
      console.log(chalk.dim('               '), formatRelativeTime(info.oldestTimestamp));
    }

    if (info.newestWAL && info.newestTimestamp) {
      console.log(chalk.dim('Newest WAL:    '), info.newestWAL);
      console.log(chalk.dim('               '), formatRelativeTime(info.newestTimestamp));
    }

    console.log();

    // Check integrity
    const integrity = await wal.verifyArchiveIntegrity(datasetName);
    if (integrity.valid) {
      console.log(chalk.green('✓ No gaps detected in WAL archive'));
    } else {
      console.log(chalk.yellow('⚠ Gaps detected in WAL archive:'));
      for (const gap of integrity.gaps) {
        console.log(chalk.dim('  -'), chalk.yellow(gap));
      }
    }
    console.log();
  } else {
    // Show info for all projects
    const projects = state.getState().projects || [];

    if (projects.length === 0) {
      console.log(chalk.dim('No projects found'));
      console.log();
      return;
    }

    for (const proj of projects) {
      console.log(chalk.bold(chalk.cyan(proj.name)));

      for (const branch of proj.branches) {
        const datasetName = branch.zfsDataset.split('/').pop() || '';
        const info = await wal.getArchiveInfo(datasetName);

        console.log(chalk.dim(`  ${branch.name}`));
        console.log(chalk.dim(`    Files: ${info.fileCount} | Size: ${formatSize(info.sizeBytes)}`));

        if (info.oldestTimestamp && info.newestTimestamp) {
          const coverage = formatRelativeTime(info.oldestTimestamp) + ' to ' + formatRelativeTime(info.newestTimestamp);
          console.log(chalk.dim(`    Coverage: ${coverage}`));
        }
      }

      console.log();
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  return `${size.toFixed(2)} ${units[i]}`;
}
