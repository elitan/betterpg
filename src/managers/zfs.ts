import { $ } from 'bun';

export interface Dataset {
  name: string;
  type: 'filesystem' | 'snapshot';
  used: number;
  available: number;
  referenced: number;
  mountpoint: string;
  created: Date;
}

export interface Snapshot {
  name: string;
  dataset: string;
  created: Date;
  used: number;
}

export interface PoolStatus {
  name: string;
  health: string;
  size: number;
  allocated: number;
  free: number;
}

export class ZFSManager {
  constructor(
    private pool: string,
    private datasetBase: string
  ) {}

  // Pool operations
  async poolExists(): Promise<boolean> {
    try {
      await $`zpool list -H ${this.pool}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  async createPool(devices: string[]): Promise<void> {
    await $`zpool create ${this.pool} ${devices}`;
  }

  async getPoolStatus(): Promise<PoolStatus> {
    const output = await $`zpool list -H -p ${this.pool}`.text();
    const [name, size, allocated, free, , , , health] = output.trim().split('\t');

    return {
      name,
      health,
      size: parseInt(size, 10),
      allocated: parseInt(allocated, 10),
      free: parseInt(free, 10),
    };
  }

  // Dataset operations
  async createDataset(name: string, options?: Record<string, string>): Promise<void> {
    const fullName = `${this.pool}/${this.datasetBase}/${name}`;

    if (options) {
      const opts = Object.entries(options).flatMap(([key, value]) => ['-o', `${key}=${value}`]);
      await $`zfs create ${opts} ${fullName}`;
    } else {
      await $`zfs create ${fullName}`;
    }
  }

  async destroyDataset(name: string, recursive = false): Promise<void> {
    const fullName = `${this.pool}/${this.datasetBase}/${name}`;
    if (recursive) {
      await $`zfs destroy -r ${fullName}`;
    } else {
      await $`zfs destroy ${fullName}`;
    }
  }

  async datasetExists(name: string): Promise<boolean> {
    try {
      const fullName = `${this.pool}/${this.datasetBase}/${name}`;
      await $`zfs list -H ${fullName}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  async getDataset(name: string): Promise<Dataset> {
    const fullName = `${this.pool}/${this.datasetBase}/${name}`;
    const output = await $`zfs list -H -p -o name,used,avail,refer,mountpoint,creation ${fullName}`.text();

    const [dsName, used, available, referenced, mountpoint, creation] =
      output.trim().split('\t');

    return {
      name: dsName,
      type: 'filesystem',
      used: parseInt(used, 10),
      available: parseInt(available, 10),
      referenced: parseInt(referenced, 10),
      mountpoint,
      created: new Date(parseInt(creation, 10) * 1000),
    };
  }

  async listDatasets(): Promise<Dataset[]> {
    try {
      const basePath = `${this.pool}/${this.datasetBase}`;
      const output = await $`zfs list -H -p -r -o name,used,avail,refer,type,mountpoint,creation ${basePath}`.text();

      return output
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          const [name, used, available, referenced, type, mountpoint, creation] =
            line.split('\t');

          return {
            name,
            type: type as 'filesystem' | 'snapshot',
            used: parseInt(used, 10),
            available: parseInt(available, 10),
            referenced: parseInt(referenced, 10),
            mountpoint,
            created: new Date(parseInt(creation, 10) * 1000),
          };
        });
    } catch {
      return [];
    }
  }

  async setProperty(dataset: string, key: string, value: string): Promise<void> {
    const fullName = `${this.pool}/${this.datasetBase}/${dataset}`;
    await $`zfs set ${key}=${value} ${fullName}`;
  }

  async getProperty(dataset: string, key: string): Promise<string> {
    const fullName = `${this.pool}/${this.datasetBase}/${dataset}`;
    const output = await $`zfs get -H -p -o value ${key} ${fullName}`.text();
    return output.trim();
  }

  // Snapshot operations
  async createSnapshot(dataset: string, snapName: string): Promise<void> {
    const fullDataset = `${this.pool}/${this.datasetBase}/${dataset}`;
    await $`zfs snapshot ${fullDataset}@${snapName}`;
  }

  async destroySnapshot(snapshot: string): Promise<void> {
    await $`zfs destroy ${snapshot}`;
  }

  async listSnapshots(dataset?: string): Promise<Snapshot[]> {
    try {
      const basePath = dataset
        ? `${this.pool}/${this.datasetBase}/${dataset}`
        : `${this.pool}/${this.datasetBase}`;

      const output = await $`zfs list -H -p -t snapshot -o name,used,creation -r ${basePath}`.text();

      return output
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          const [name, used, creation] = line.split('\t');
          const [datasetName] = name.split('@');

          return {
            name,
            dataset: datasetName,
            used: parseInt(used, 10),
            created: new Date(parseInt(creation, 10) * 1000),
          };
        });
    } catch {
      return [];
    }
  }

  async snapshotExists(snapshot: string): Promise<boolean> {
    try {
      await $`zfs list -H ${snapshot}`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  // Clone operations
  async cloneSnapshot(snapshot: string, target: string): Promise<void> {
    const fullTarget = `${this.pool}/${this.datasetBase}/${target}`;
    await $`zfs clone ${snapshot} ${fullTarget}`;
  }

  async promoteClone(clone: string): Promise<void> {
    const fullClone = `${this.pool}/${this.datasetBase}/${clone}`;
    await $`zfs promote ${fullClone}`;
  }

  // Utility functions
  async getUsedSpace(dataset: string): Promise<number> {
    const fullName = `${this.pool}/${this.datasetBase}/${dataset}`;
    const output = await $`zfs list -H -p -o used ${fullName}`.text();
    return parseInt(output.trim(), 10);
  }

  async getSharedSpace(clone: string): Promise<number> {
    const fullClone = `${this.pool}/${this.datasetBase}/${clone}`;
    const output = await $`zfs list -H -p -o referenced ${fullClone}`.text();
    return parseInt(output.trim(), 10);
  }

  async getMountpoint(dataset: string): Promise<string> {
    const fullName = `${this.pool}/${this.datasetBase}/${dataset}`;
    const output = await $`zfs get -H -p -o value mountpoint ${fullName}`.text();
    return output.trim();
  }
}
