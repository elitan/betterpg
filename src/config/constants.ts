import packageJson from '../../package.json';

/**
 * CLI name - used for technical identifiers (paths, containers, datasets)
 * Derived from package.json "name" field
 */
export const CLI_NAME = packageJson.name;

/**
 * Tool display name - used for user-facing messages and branding
 * Derived from package.json "displayName" field, fallback to CLI_NAME
 */
export const TOOL_NAME = (packageJson as any).displayName || CLI_NAME;

/**
 * Container prefix for Docker containers
 * Format: {CONTAINER_PREFIX}-{database}-{branch}
 */
export const CONTAINER_PREFIX = CLI_NAME;

/**
 * Backup label prefix for PostgreSQL backup mode
 */
export const BACKUP_LABEL_PREFIX = CLI_NAME;
