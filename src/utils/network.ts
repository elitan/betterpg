import { $ } from 'bun';

/**
 * Get the public IP address of the machine
 * Returns null if unable to detect (e.g., offline, firewall blocking)
 */
export async function getPublicIP(): Promise<string | null> {
  // Skip network lookup in test environments for faster tests
  if (process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test') {
    return null;
  }

  try {
    // Try multiple services for reliability
    const services = [
      'https://api.ipify.org',
      'https://ifconfig.me/ip',
      'https://icanhazip.com',
    ];

    for (const service of services) {
      try {
        const response = await fetch(service, {
          signal: AbortSignal.timeout(3000) // 3 second timeout
        });
        if (response.ok) {
          const ip = (await response.text()).trim();
          // Basic validation: check if it looks like an IP address
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
            return ip;
          }
        }
      } catch {
        // Try next service
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Format connection string with both local and remote (if available)
 */
export function formatConnectionString(
  username: string,
  password: string,
  port: number,
  database: string,
  publicIP: string | null
): string {
  const baseParams = `sslmode=require`;
  const localUrl = `postgresql://${username}:${password}@localhost:${port}/${database}?${baseParams}`;

  if (publicIP) {
    const remoteUrl = `postgresql://${username}:${password}@${publicIP}:${port}/${database}?${baseParams}`;
    return `  Local:  ${localUrl}\n  Remote: ${remoteUrl}`;
  }

  return `  ${localUrl}`;
}
