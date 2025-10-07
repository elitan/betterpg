/**
 * Hardcoded defaults for pgd
 * These are sensible defaults that work for most use cases
 */

export const DEFAULTS = {
  zfs: {
    compression: 'lz4',        // Fast compression, good for databases
    recordsize: '8k',          // PostgreSQL page size
    datasetBase: 'pgd/databases',
  },
  postgres: {
    defaultVersion: '17',
    defaultImage: 'postgres:17-alpine',
  },
} as const;
