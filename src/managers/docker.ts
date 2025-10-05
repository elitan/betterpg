import Dockerode from 'dockerode';

export interface PostgresConfig {
  name: string;
  version: string;
  port: number;
  dataPath: string;
  walArchivePath: string;
  password: string;
  username: string;
  database: string;
  sharedBuffers: string;
  maxConnections: number;
  extraConfig?: Record<string, string>;
}

export interface ContainerStatus {
  id: string;
  name: string;
  state: 'running' | 'exited' | 'created' | 'paused';
  uptime: number;
  startedAt: Date | null;
}

export class DockerManager {
  private docker: Dockerode;

  constructor() {
    this.docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
  }

  // Container lifecycle
  async createContainer(config: PostgresConfig): Promise<string> {
    const container = await this.docker.createContainer({
      Image: `postgres:${config.version}-alpine`,
      name: config.name,
      Env: [
        `POSTGRES_PASSWORD=${config.password}`,
        `POSTGRES_USER=${config.username}`,
        `POSTGRES_DB=${config.database}`,
        'PGDATA=/var/lib/postgresql/data/pgdata',
      ],
      ExposedPorts: {
        '5432/tcp': {},
      },
      HostConfig: {
        PortBindings: {
          '5432/tcp': [{ HostPort: config.port.toString() }],
        },
        Binds: [
          `${config.dataPath}:/var/lib/postgresql/data`,
          `${config.walArchivePath}:/wal-archive`,
        ],
        RestartPolicy: {
          Name: 'unless-stopped',
        },
      },
      Healthcheck: {
        Test: ['CMD-SHELL', 'pg_isready -U postgres'],
        Interval: 5000000000,
        Timeout: 3000000000,
        Retries: 3,
      },
    });

    return container.id;
  }

  async startContainer(containerID: string): Promise<void> {
    const container = this.docker.getContainer(containerID);
    await container.start();
  }

  async stopContainer(containerID: string, timeout = 10): Promise<void> {
    const container = this.docker.getContainer(containerID);
    await container.stop({ t: timeout });
  }

  async removeContainer(containerID: string): Promise<void> {
    const container = this.docker.getContainer(containerID);
    await container.remove({ force: true });
  }

  async restartContainer(containerID: string): Promise<void> {
    const container = this.docker.getContainer(containerID);
    await container.restart();
  }

  // Container inspection
  async getContainerStatus(containerID: string): Promise<ContainerStatus> {
    const container = this.docker.getContainer(containerID);
    const info = await container.inspect();

    return {
      id: info.Id,
      name: info.Name.replace('/', ''),
      state: info.State.Status as ContainerStatus['state'],
      uptime: info.State.StartedAt
        ? Date.now() - new Date(info.State.StartedAt).getTime()
        : 0,
      startedAt: info.State.StartedAt ? new Date(info.State.StartedAt) : null,
    };
  }

  async containerExists(name: string): Promise<boolean> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      return containers.some(c => c.Names.includes(`/${name}`));
    } catch {
      return false;
    }
  }

  async getContainerByName(name: string): Promise<string | null> {
    const containers = await this.docker.listContainers({ all: true });
    const container = containers.find(c => c.Names.includes(`/${name}`));
    return container ? container.Id : null;
  }

  async waitForHealthy(containerID: string, timeout = 60000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const container = this.docker.getContainer(containerID);
      const info = await container.inspect();

      if (info.State.Health?.Status === 'healthy' || info.State.Status === 'running') {
        if (!info.State.Health) {
          await Bun.sleep(2000);
          return;
        }
        if (info.State.Health.Status === 'healthy') {
          return;
        }
      }

      await Bun.sleep(1000);
    }

    throw new Error(`Container ${containerID} failed to become healthy within ${timeout}ms`);
  }

  // Image management
  async pullImage(image: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);

        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  async imageExists(image: string): Promise<boolean> {
    try {
      const images = await this.docker.listImages();
      return images.some(img =>
        img.RepoTags?.some(tag => tag === image || tag.startsWith(image + ':'))
      );
    } catch {
      return false;
    }
  }

  // Utility
  async listContainers(filter?: Record<string, string>): Promise<ContainerStatus[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: filter ? JSON.stringify(filter) : undefined,
    });

    return containers.map(c => ({
      id: c.Id,
      name: c.Names[0]?.replace('/', '') || '',
      state: c.State as ContainerStatus['state'],
      uptime: Date.now() - (c.Created * 1000),
      startedAt: new Date(c.Created * 1000),
    }));
  }

  async execInContainer(containerID: string, cmd: string[]): Promise<string> {
    const container = this.docker.getContainer(containerID);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise((resolve, reject) => {
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      stream.on('end', () => resolve(output));
      stream.on('error', reject);
    });
  }
}
