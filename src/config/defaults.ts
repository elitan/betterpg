/**
 * Hardcoded defaults for velo
 * These are sensible defaults that work for most use cases
 */

export const DEFAULTS = {
  zfs: {
    compression: 'lz4',        // Fast compression, good for databases
    recordsize: '8k',          // PostgreSQL page size
    atime: 'off',              // Disable access time tracking for performance
    datasetBase: 'velo/databases',
  },
  postgres: {
    defaultVersion: '17',
    defaultImage: 'postgres:17-alpine',
  },
} as const;
