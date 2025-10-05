import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import { Config } from '../types/config';

export const DEFAULT_CONFIG: Config = {
  version: 1,
  zfs: {
    pool: 'tank',
    datasetBase: 'betterpg/databases',
    compression: 'lz4',
    recordsize: '8k',
  },
  postgres: {
    version: '16',
    basePort: 5432,
    image: 'postgres:16-alpine',
    config: {
      shared_buffers: '256MB',
      max_connections: '100',
      wal_level: 'replica',
      archive_mode: 'on',
      archive_timeout: '300',
      max_wal_size: '1GB',
    },
  },
  backups: {
    enabled: true,
    provider: 'local',
    retentionDays: 30,
    local: {
      path: '/var/lib/betterpg/backups',
    },
  },
  system: {
    logLevel: 'info',
    logFile: '/var/log/betterpg.log',
  },
};

export class ConfigManager {
  private config: Config | null = null;

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.config = yaml.parse(content);
      this.validate();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Config file not found at ${this.filePath}`);
      }
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  async save(config: Config): Promise<void> {
    this.config = config;
    this.validate();
    const content = yaml.stringify(config);
    await fs.writeFile(this.filePath, content, 'utf-8');
  }

  async createDefault(): Promise<void> {
    await this.save(DEFAULT_CONFIG);
  }

  getConfig(): Config {
    if (!this.config) {
      throw new Error('Config not loaded');
    }
    return this.config;
  }

  private validate(): void {
    if (!this.config) {
      throw new Error('Config is null');
    }

    if (!this.config.zfs?.pool || !this.config.zfs?.datasetBase) {
      throw new Error('Invalid ZFS configuration');
    }

    if (!this.config.postgres?.version || !this.config.postgres?.basePort) {
      throw new Error('Invalid PostgreSQL configuration');
    }

    if (this.config.postgres.basePort < 1024 || this.config.postgres.basePort > 65535) {
      throw new Error('PostgreSQL base port must be between 1024 and 65535');
    }
  }
}
