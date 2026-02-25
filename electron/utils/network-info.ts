/**
 * Network utilities for discovering local network addresses.
 * Used to display LAN access URL for remote device connections.
 */

import * as os from 'os';

/**
 * Get the local network IPv4 address (LAN IP).
 *
 * Iterates through all network interfaces and returns the first non-internal IPv4 address.
 * This is typically the machine's LAN IP (e.g., 192.168.1.x, 10.0.0.x).
 *
 * @returns IPv4 address string, or null if no network address found
 */
export function getLocalNetworkAddress(): string | null {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const networkInterface = interfaces[name];
    if (!networkInterface) continue;

    for (const details of networkInterface) {
      // Skip internal (loopback) addresses and IPv6
      if (details.family === 'IPv4' && !details.internal) {
        return details.address;
      }
    }
  }

  return null;
}
