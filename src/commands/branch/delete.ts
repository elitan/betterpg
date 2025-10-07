import ora from 'ora';
import chalk from 'chalk';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { ConfigManager } from '../../managers/config';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';

export async function branchDeleteCommand(name: string) {
  const namespace = parseNamespace(name);

  console.log();
  console.log(chalk.bold(`🗑️  Deleting branch: ${chalk.cyan(name)}`));
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new Error(`Branch '${name}' not found`);
  }

  const { branch, project } = result;

  // Prevent deleting main branch
  if (branch.isPrimary) {
    throw new Error(`Cannot delete main branch. Use 'bpg project delete ${project.name}' to delete the entire project.`);
  }

  const config = new ConfigManager(PATHS.CONFIG);
  await config.load();
  const cfg = config.getConfig();

  const docker = new DockerManager();
  const zfs = new ZFSManager(cfg.zfs.pool, cfg.zfs.datasetBase);

  // Stop and remove container
  const spinner = ora('Stopping container').start();
  const containerID = await docker.getContainerByName(branch.containerName);
  if (containerID) {
    await docker.stopContainer(containerID);
    await docker.removeContainer(containerID);
  }
  spinner.succeed('Container removed');

  // Destroy ZFS dataset
  const datasetSpinner = ora('Destroying ZFS dataset').start();
  const datasetName = `${namespace.project}-${namespace.branch}`; // Consistent <project>-<branch> naming
  await zfs.destroyDataset(datasetName, true);
  datasetSpinner.succeed('ZFS dataset destroyed');

  // Remove from state
  await state.deleteBranch(project.id, branch.id);

  console.log();
  console.log(chalk.green.bold(`✓ Branch '${name}' deleted successfully!`));
  console.log();
}
