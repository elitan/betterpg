export interface State {
  version: string;
  initializedAt: string;
  zfsPool: string;
  zfsDatasetBase: string;
  projects: Project[];
  backups: Backup[];
  snapshots: Snapshot[];
}

export interface Project {
  id: string;
  name: string;
  dockerImage: string;           // Docker image used (e.g., postgres:17-alpine, ankane/pgvector:17)
  postgresVersion?: string;      // Optional, for display purposes only
  createdAt: string;
  credentials: Credentials;
  branches: Branch[];
}

export interface Branch {
  id: string;
  name: string;                              // Namespaced name: <project>/<branch>
  projectName: string;                       // Parent project name
  parentBranchId: string | null;             // null for main branch
  isPrimary: boolean;                        // true for main branch, false for others
  snapshotName: string | null;               // null for main branch
  zfsDataset: string;                        // Full ZFS path: pool/datasetBase/datasetName
  zfsDatasetName: string;                    // Dataset name only: <project>-<branch>
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
  projectId: string;
  type: 'base' | 'incremental';
  timestamp: string;
  location: string;
  sizeBytes: number;
  walPosition: string;
}

export interface Snapshot {
  id: string;
  branchId: string;
  branchName: string;  // Namespaced: <project>/<branch>
  projectName: string;
  zfsSnapshot: string; // Full ZFS snapshot name with @
  createdAt: string;
  label?: string;      // Optional user label
  sizeBytes: number;
}
