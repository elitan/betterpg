/**
 * Utility functions for parsing and working with namespaced names
 * Format: <database>/<branch>
 */

export interface ParsedNamespace {
  database: string;
  branch: string;
  full: string;
}

/**
 * Parse a namespaced name into database and branch components
 * @param name - The namespaced name (e.g., "api/dev")
 * @returns Parsed components
 * @throws Error if name is not properly namespaced
 */
export function parseNamespace(name: string): ParsedNamespace {
  const parts = name.split('/');

  if (parts.length !== 2) {
    throw new Error(
      `Invalid namespace format: '${name}'. Expected format: <database>/<branch>`
    );
  }

  const [database, branch] = parts;

  if (!database || !branch) {
    throw new Error(
      `Invalid namespace format: '${name}'. Database and branch names cannot be empty`
    );
  }

  // Validate names (alphanumeric, hyphens, underscores)
  const validNameRegex = /^[a-zA-Z0-9_-]+$/;

  if (!validNameRegex.test(database)) {
    throw new Error(
      `Invalid database name: '${database}'. Only alphanumeric characters, hyphens, and underscores are allowed`
    );
  }

  if (!validNameRegex.test(branch)) {
    throw new Error(
      `Invalid branch name: '${branch}'. Only alphanumeric characters, hyphens, and underscores are allowed`
    );
  }

  return {
    database,
    branch,
    full: name,
  };
}

/**
 * Build a namespaced name from database and branch
 * @param database - Database name
 * @param branch - Branch name
 * @returns Namespaced name
 */
export function buildNamespace(database: string, branch: string): string {
  return `${database}/${branch}`;
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
 * Get the main branch name for a database
 * @param database - Database name
 * @returns Namespaced main branch name
 */
export function getMainBranch(database: string): string {
  return buildNamespace(database, 'main');
}
