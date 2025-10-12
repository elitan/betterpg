import chalk from 'chalk';
import { DockerManager } from '../../managers/docker';
import { StateManager } from '../../managers/state';
import { ZFSManager } from '../../managers/zfs';
import { WALManager } from '../../managers/wal';
import { PATHS } from '../../utils/paths';
import { parseNamespace } from '../../utils/namespace';
import { getContainerName, getDatasetName } from '../../utils/naming';
import { UserError } from '../../errors';
import { withProgress } from '../../utils/progress';
import { CLI_NAME } from '../../config/constants';

// Helper function to collect all descendant branches recursively (depth-first, post-order)
function collectDescendants(branch: any, allBranches: any[]): any[] {
  const children = allBranches.filter(b => b.parentBranchId === branch.id);
  const descendants: any[] = [];

  for (const child of children) {
    // Recursively collect descendants of this child first
    descendants.push(...collectDescendants(child, allBranches));
    // Then add the child itself
    descendants.push(child);
  }

  return descendants;
}

export async function branchDeleteCommand(name: string, options: { force?: boolean } = {}) {
  const namespace = parseNamespace(name);

  console.log();
  console.log(`Deleting ${chalk.bold(name)}...`);
  console.log();

  const state = new StateManager(PATHS.STATE);
  await state.load();

  const result = await state.getBranchByNamespace(name);
  if (!result) {
    throw new UserError(
      `Branch '${name}' not found`,
      `Run '${CLI_NAME} branch list' to see available branches`
    );
  }

  const { branch, project } = result;

  // Prevent deleting main branch
  if (branch.isPrimary) {
    throw new UserError(
      `Cannot delete main branch. Use '${CLI_NAME} project delete ${project.name}' to delete the entire project.`,
      `Main branches can only be deleted by deleting the entire project`
    );
  }

  // Check for child branches
  const descendants = collectDescendants(branch, project.branches);
  if (descendants.length > 0 && !options.force) {
    // Build tree structure for display
    interface BranchNode {
      branch: any;
      children: BranchNode[];
    }

    const branchMap = new Map<string, BranchNode>();

    // Create nodes for target branch and all descendants
    branchMap.set(branch.id, { branch, children: [] });
    for (const desc of descendants) {
      branchMap.set(desc.id, { branch: desc, children: [] });
    }

    // Build parent-child relationships
    for (const desc of descendants) {
      const node = branchMap.get(desc.id)!;
      if (desc.parentBranchId) {
        const parent = branchMap.get(desc.parentBranchId);
        if (parent) {
          parent.children.push(node);
        }
      }
    }

    // Render tree
    function renderBranch(node: BranchNode, depth: number = 0): string[] {
      const lines: string[] = [];
      if (depth > 0) {
        const indent = '  '.repeat(depth - 1) + '↳ ';
        lines.push(chalk.dim(`${indent}${node.branch.name}`));
      }
      for (const child of node.children) {
        lines.push(...renderBranch(child, depth + 1));
      }
      return lines;
    }

    const rootNode = branchMap.get(branch.id)!;
    const treeLines = renderBranch(rootNode, 0);

    let errorMessage = `Cannot delete branch '${name}' because it has child branches:\n\n`;
    for (const line of treeLines) {
      errorMessage += line + '\n';
    }
    errorMessage += `\nTo delete this branch and all its children, use:\n  ${CLI_NAME} branch delete ${name} --force`;

    throw new UserError(errorMessage);
  }

  // Get ZFS config from state
  const stateData = state.getState();

  const docker = new DockerManager();
  const zfs = new ZFSManager(stateData.zfsPool, stateData.zfsDatasetBase);
  const wal = new WALManager();

  // Collect all branches to delete (target + descendants in correct order)
  const branchesToDelete = [...descendants, branch];

  // Delete all branches (descendants first, then target)
  for (const branchToDelete of branchesToDelete) {
    const branchNamespace = parseNamespace(branchToDelete.name);
    const containerName = getContainerName(branchNamespace.project, branchNamespace.branch);
    const datasetName = getDatasetName(branchNamespace.project, branchNamespace.branch);

    // Stop and remove container
    await withProgress(`Stop container: ${branchToDelete.name}`, async () => {
      const containerID = await docker.getContainerByName(containerName);
      if (containerID) {
        await docker.stopContainer(containerID);
        await docker.removeContainer(containerID);
      }
    });

    // Clean up WAL archive
    await withProgress(`Clean up WAL archive: ${branchToDelete.name}`, async () => {
      await wal.deleteArchiveDir(datasetName);
    });

    // Clean up snapshots from state
    await withProgress(`Clean up snapshots: ${branchToDelete.name}`, async () => {
      await state.deleteSnapshotsForBranch(branchToDelete.name);
    });

    // Destroy ZFS dataset
    await withProgress(`Destroy dataset: ${branchToDelete.name}`, async () => {
      // Only destroy dataset if it exists - this handles cases where previous deletion attempts
      // were interrupted or failed partway through, leaving state entries without actual ZFS datasets
      if (await zfs.datasetExists(datasetName)) {
        await zfs.unmountDataset(datasetName);
        await zfs.destroyDataset(datasetName, true);
      }
    });

    // Remove from state
    await state.deleteBranch(project.id, branchToDelete.id);
  }

  console.log();
  console.log(chalk.bold('Branch deleted'));
  console.log();
}
