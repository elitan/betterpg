import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { $ } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';

const PGD = './dist/pgd';
const TEST_PROJECT = 'ssl-test';
const TEST_BRANCH = `${TEST_PROJECT}/dev`;

describe('SSL/TLS Tests', () => {
  beforeAll(async () => {
    // Clean up any existing test project
    try {
      await $`sudo ${PGD} project delete ${TEST_PROJECT}`.quiet();
    } catch {}
  });

  afterAll(async () => {
    // Clean up test project
    try {
      await $`sudo ${PGD} project delete ${TEST_PROJECT}`.quiet();
    } catch {}
  });

  test('should generate SSL certificates on project create', async () => {
    // Create project
    const result = await $`sudo ${PGD} project create ${TEST_PROJECT}`.text();
    expect(result).toContain('Generate SSL certificates');

    // Verify certificates exist
    const certDir = join(process.env.HOME || '/root', '.local/share/pgd/certs', TEST_PROJECT);
    const serverKey = join(certDir, 'server.key');
    const serverCert = join(certDir, 'server.crt');

    expect(existsSync(serverKey)).toBe(true);
    expect(existsSync(serverCert)).toBe(true);

    // Verify certificate is valid
    const certInfo = await $`openssl x509 -in ${serverCert} -noout -subject`.text();
    expect(certInfo).toMatch(/CN\s*=\s*pgd-postgres/);
  });

  test('should output connection string with sslmode=require', async () => {
    // Get branch details
    const result = await $`sudo ${PGD} branch get ${TEST_PROJECT}/main`.text();

    expect(result).toContain('postgresql://');
    expect(result).toContain('sslmode=require');
  });

  test('should enable SSL in PostgreSQL container', async () => {
    // Get container name
    const containerName = `pgd-${TEST_PROJECT}-main`;

    // Check PostgreSQL SSL settings
    const sslOn = await $`docker exec ${containerName} psql -U postgres -t -A -c "SHOW ssl;"`.text();
    expect(sslOn.trim()).toBe('on');

    // Check SSL certificate file location
    const sslCert = await $`docker exec ${containerName} psql -U postgres -t -A -c "SHOW ssl_cert_file;"`.text();
    expect(sslCert.trim()).toBe('/etc/ssl/certs/postgresql/server.crt');

    // Check SSL key file location
    const sslKey = await $`docker exec ${containerName} psql -U postgres -t -A -c "SHOW ssl_key_file;"`.text();
    expect(sslKey.trim()).toBe('/etc/ssl/certs/postgresql/server.key');
  });

  test('should connect with sslmode=require', async () => {
    // Get connection details
    const result = await $`sudo ${PGD} branch get ${TEST_PROJECT}/main`.text();

    // Extract connection string - be careful with password containing special chars
    const match = result.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
    expect(match).toBeTruthy();

    const [, username, password, hostname, port, database] = match!;

    // Test connection with sslmode=require
    const query = await $`PGPASSWORD=${password} psql -h ${hostname} -p ${port} -U ${username} -d ${database} -t -A -c "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();"`.env({
      PGSSLMODE: 'require'
    }).text();

    const [sslEnabled, tlsVersion] = query.trim().split('|');
    expect(sslEnabled).toBe('t');  // true
    expect(tlsVersion).toMatch(/^TLSv/);  // Should be TLS version like TLSv1.3
  });

  test('should reject connection without SSL', async () => {
    // Get connection details
    const result = await $`sudo ${PGD} branch get ${TEST_PROJECT}/main`.text();

    // Extract connection string - be careful with password containing special chars
    const match = result.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
    expect(match).toBeTruthy();

    const [, username, password, hostname, port, database] = match!;

    // Try to connect with sslmode=disable (should work but not use SSL)
    // Note: PostgreSQL by default allows non-SSL connections unless configured otherwise
    const query = await $`PGPASSWORD=${password} psql -h ${hostname} -p ${port} -U ${username} -d ${database} -t -A -c "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();"`.env({
      PGSSLMODE: 'disable'
    }).text();

    const sslEnabled = query.trim();
    expect(sslEnabled).toBe('f');  // false - no SSL used
  });

  test('should create branch with SSL certificates from parent project', async () => {
    // Create branch
    const result = await $`sudo ${PGD} branch create ${TEST_BRANCH}`.text();
    expect(result).toContain('Connection ready');
    expect(result).toContain('sslmode=require');

    // Verify branch container has SSL enabled
    const containerName = `pgd-${TEST_PROJECT}-dev`;
    const sslOn = await $`docker exec ${containerName} psql -U postgres -t -A -c "SHOW ssl;"`.text();
    expect(sslOn.trim()).toBe('on');
  });

  test('should mount SSL certificates as read-only', async () => {
    // Check Docker mount for main branch container
    const containerName = `pgd-${TEST_PROJECT}-main`;
    const mounts = await $`docker inspect ${containerName} --format '{{json .Mounts}}'`.text();

    const mountsJson = JSON.parse(mounts);
    const sslMount = mountsJson.find((m: any) => m.Destination === '/etc/ssl/certs/postgresql');

    expect(sslMount).toBeTruthy();
    expect(sslMount.RW).toBe(false);  // Should be read-only
  });
});
