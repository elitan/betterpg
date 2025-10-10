import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { CLI_NAME } from '../config/constants';

export interface CertPaths {
  certDir: string;
  serverKey: string;
  serverCert: string;
}

export class CertManager {
  private baseDir: string;

  constructor(baseDir: string = join(process.env.HOME || '/root', `.${CLI_NAME}/certs`)) {
    this.baseDir = baseDir;
  }

  /**
   * Get certificate paths for a project
   */
  getCertPaths(projectName: string): CertPaths {
    const certDir = join(this.baseDir, projectName);
    return {
      certDir,
      serverKey: join(certDir, 'server.key'),
      serverCert: join(certDir, 'server.crt'),
    };
  }

  /**
   * Generate self-signed SSL certificates for a project
   */
  async generateCerts(projectName: string): Promise<CertPaths> {
    const paths = this.getCertPaths(projectName);

    // Create certificate directory
    await mkdir(paths.certDir, { recursive: true, mode: 0o755 });

    // Generate private key (2048-bit RSA)
    await $`openssl genrsa -out ${paths.serverKey} 2048`.quiet();

    // Generate self-signed certificate (valid for 10 years)
    await $`openssl req -new -x509 -days 3650 \
      -key ${paths.serverKey} \
      -out ${paths.serverCert} \
      -subj "/CN=pgd-postgres/O=pgd/C=US"`.quiet();

    // Set proper permissions BEFORE changing ownership
    // (PostgreSQL requires 0600 for private key)
    await $`chmod 600 ${paths.serverKey}`.quiet();
    await $`chmod 644 ${paths.serverCert}`.quiet();

    // Set ownership to match PostgreSQL user in container
    // PostgreSQL alpine image runs as user 'postgres' with UID 70
    await $`sudo chown 70:70 ${paths.serverKey} ${paths.serverCert}`.quiet();

    return paths;
  }

  /**
   * Validate that certificates exist and are readable
   */
  async validateCerts(projectName: string): Promise<boolean> {
    const paths = this.getCertPaths(projectName);

    // Check if both files exist
    if (!existsSync(paths.serverKey) || !existsSync(paths.serverCert)) {
      return false;
    }

    // Try to verify the certificate is valid
    try {
      await $`openssl x509 -in ${paths.serverCert} -noout -text`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove certificates for a project
   */
  async deleteCerts(projectName: string): Promise<void> {
    const paths = this.getCertPaths(projectName);

    if (existsSync(paths.certDir)) {
      await $`rm -rf ${paths.certDir}`.quiet();
    }
  }
}
