export interface Config {
  version: number;
  zfs: ZFSConfig;
  postgres: PostgresConfig;
  backups: BackupConfig;
  system: SystemConfig;
}

export interface ZFSConfig {
  pool: string;
  datasetBase: string;
  compression: string;
  recordsize: string;
}

export interface PostgresConfig {
  version: string;
  basePort: number;
  image: string;
  config: Record<string, string>;
}

export interface BackupConfig {
  enabled: boolean;
  provider: 'local' | 's3' | 'b2';
  retentionDays: number;
  local?: LocalConfig;
  s3?: S3Config;
  b2?: B2Config;
}

export interface LocalConfig {
  path: string;
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

export interface B2Config {
  bucket: string;
  keyId: string;
  applicationKey: string;
}

export interface SystemConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFile: string;
}
