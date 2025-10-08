/**
 * Utility functions for parsing and working with namespaced names
 * Format: <project>/<branch>
 */

export interface ParsedNamespace {
  project: string;
  branch: string;
  full: string;
}

// Validation regex for project/branch names (alphanumeric, hyphens, underscores)
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a name (project or branch)
 * @param name - The name to validate
 * @param type - Type of name ('project' or 'branch')
 * @throws Error if name is invalid
 */
export function validateName(name: string, type: 'project' | 'branch' = 'project'): void {
  if (!name || name.trim() === '') {
    throw new Error(`${type} name cannot be empty`);
  }

  if (!VALID_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid ${type} name: '${name}'. Only alphanumeric characters, hyphens, and underscores are allowed`
    );
  }
}

/**
 * Parse a namespaced name into project and branch components
 * @param name - The namespaced name (e.g., "api/dev")
 * @returns Parsed components
 * @throws Error if name is not properly namespaced
 */
export function parseNamespace(name: string): ParsedNamespace {
  const parts = name.split('/');

  if (parts.length !== 2) {
    throw new Error(
      `Invalid namespace format: '${name}'. Expected format: <project>/<branch>`
    );
  }

  const [project, branch] = parts;

  if (!project || !branch) {
    throw new Error(
      `Invalid namespace format: '${name}'. Project and branch names cannot be empty`
    );
  }

  // Validate names (alphanumeric, hyphens, underscores)
  validateName(project, 'project');
  validateName(branch, 'branch');

  return {
    project,
    branch,
    full: name,
  };
}

/**
 * Build a namespaced name from project and branch
 * @param project - Project name
 * @param branch - Branch name
 * @returns Namespaced name
 */
export function buildNamespace(project: string, branch: string): string {
  return `${project}/${branch}`;
}

/**
 * Check if a name is properly namespaced
 * @param name - The name to check
 * @returns True if properly namespaced
 */
export function isNamespaced(name: string): boolean {
  try {
    parseNamespace(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the main branch name for a project
 * @param project - Project name
 * @returns Namespaced main branch name
 */
export function getMainBranch(project: string): string {
  return buildNamespace(project, 'main');
}
