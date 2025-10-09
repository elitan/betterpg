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

  // Create table
  const table = new Table({
    head: ['', 'Branch', 'Status', 'Port', 'Size', 'Created'],
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  });

  // Helper to build tree and render branches
  interface BranchNode {
    branch: any;
    children: BranchNode[];
  }

  function renderBranch(node: BranchNode, depth: number = 0) {
    const branch = node.branch;
    const statusIcon = branch.status === 'running' ? chalk.green('●') : chalk.red('●');
    const statusText = branch.status === 'running' ? chalk.green('running') : chalk.red('stopped');
    const port = branch.status === 'running' ? `Port ${branch.port}` : '-';

    // Build name with tree structure
    const indent = depth > 0 ? '  ↳ ' : '';
    const name = indent + branch.name;
    const type = branch.isPrimary ? chalk.dim(' (main)') : '';

    table.push([
      statusIcon,
      name + type,
      statusText,
      port,
      formatBytes(branch.sizeBytes),
      new Date(branch.createdAt).toLocaleString()
    ]);

    // Render children
    node.children.forEach(child => renderBranch(child, depth + 1));
  }

  // Process each project
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
    roots.forEach(root => renderBranch(root, 0));
  }

  console.log();
  console.log(table.toString());
  console.log();
}
