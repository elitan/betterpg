export interface State {
  version: string;
  initializedAt: string;
  zfsPool: string;
  zfsDatasetBase: string;
  nextPort: number;
  databases: Database[];
  backups: Backup[];
}

export interface Database {
  id: string;
  name: string;
  type: 'primary';
  zfsDataset: string;
  containerName: string;
  port: number;
  postgresVersion: string;
  createdAt: string;
  sizeBytes: number;
  status: 'running' | 'stopped' | 'created';
  credentials: Credentials;
  branches: Branch[];
}

export interface Branch {
  id: string;
  name: string;
  parentId: string;
  snapshotName: string;
  zfsDataset: string;
  containerName: string;
  port: number;
  createdAt: string;
  sizeBytes: number;
  status: 'running' | 'stopped' | 'created';
}

export interface Credentials {
  username: string;
  password: string;
  database: string;
}

export interface Backup {
  id: string;
  databaseId: string;
  type: 'base' | 'incremental';
  timestamp: string;
  location: string;
  sizeBytes: number;
  walPosition: string;
}
