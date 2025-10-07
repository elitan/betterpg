export interface State {
  version: string;
  initializedAt: string;
  zfsPool: string;
  zfsDatasetBase: string;
  nextPort: number;
  databases: Database[];
  backups: Backup[];
  snapshots: Snapshot[];
}

export interface Database {
  id: string;
  name: string;
  postgresVersion: string;
  createdAt: string;
  credentials: Credentials;
  branches: Branch[];
}

export interface Branch {
  id: string;
  name: string;                              // Namespaced name: <database>/<branch>
  databaseName: string;                      // Parent database name
  parentBranchId: string | null;             // null for main branch
  isPrimary: boolean;                        // true for main branch, false for others
  snapshotName: string | null;               // null for main branch
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

export interface Snapshot {
  id: string;
  branchId: string;
  branchName: string;  // Namespaced: <database>/<branch>
  databaseName: string;
  zfsSnapshot: string; // Full ZFS snapshot name with @
  createdAt: string;
  label?: string;      // Optional user label
  sizeBytes: number;
}
