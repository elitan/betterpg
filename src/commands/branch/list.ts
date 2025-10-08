import Table from 'cli-table3';
import chalk from 'chalk';
import { StateManager } from '../../managers/state';
import { PATHS } from '../../utils/paths';
import { formatBytes } from '../../utils/helpers';

export async function branchListCommand(projectName?: string) {
  const state = new StateManager(PATHS.STATE);
  await state.load();

  const projects = await state.listProjects();

  // Filter by project if specified
  const filtered = projectName
    ? projects.filter(proj => proj.name === projectName)
    : projects;

  if (filtered.length === 0) {
    if (projectName) {
      throw new Error(`Project '${projectName}' not found`);
    } else {
      console.log();
      console.log(chalk.dim('No projects found. Create one with: pgd project create <name>'));
      console.log();
      return;
    }
  }

  console.log();
  if (projectName) {
    console.log(`Branches for ${chalk.cyan(projectName)}:`);
  } else {
    console.log('All branches:');
  }
  console.log();

  // Calculate total branches
  let totalBranches = 0;
  const projectCount = filtered.length;

  // Helper function to build tree structure
  interface BranchNode {
    branch: any;
    children: BranchNode[];
  }

  // Helper function to render tree recursively
  function renderBranch(node: BranchNode, prefix: string, isLast: boolean, isRoot: boolean) {
    totalBranches++;
    const branch = node.branch;
    const branchName = branch.name;
    const status = branch.status === 'running' ? 'running' : 'stopped';
    const port = branch.status === 'running' ? branch.port.toString().padEnd(7) : '-'.padEnd(7);
    const size = formatBytes(branch.sizeBytes).padEnd(10);
    const tag = branch.isPrimary ? chalk.dim('(main)') : '';

    // Tree characters
    const connector = isRoot ? '  ' : (isLast ? '└─ ' : '├─ ');
    const nameWithConnector = isRoot ? branchName : connector + branchName;

    // Adjust padding based on tree depth
    const basePadding = 25;
    const actualPadding = basePadding - (isRoot ? 0 : 3);

    console.log(`  ${prefix}${chalk.cyan(nameWithConnector.padEnd(actualPadding))} ${status.padEnd(10)} ${port} ${size} ${tag}`);

    // Render children
    node.children.forEach((child, index) => {
      const childIsLast = index === node.children.length - 1;
      const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
      renderBranch(child, childPrefix, childIsLast, false);
    });
  }

  for (const proj of filtered) {
    // Build tree structure
    const branchMap = new Map<string, BranchNode>();
    const roots: BranchNode[] = [];

    // Create nodes for all branches
    for (const branch of proj.branches) {
      branchMap.set(branch.id, { branch, children: [] });
    }

    // Build parent-child relationships
    for (const branch of proj.branches) {
      const node = branchMap.get(branch.id)!;
      if (branch.parentBranchId) {
        const parent = branchMap.get(branch.parentBranchId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // Render tree
    roots.forEach(root => renderBranch(root, '', true, true));
  }

  console.log();
  if (projectName) {
    console.log(`${totalBranches} ${totalBranches === 1 ? 'branch' : 'branches'}`);
  } else {
    console.log(`${totalBranches} ${totalBranches === 1 ? 'branch' : 'branches'} across ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`);
  }
  console.log();
}
