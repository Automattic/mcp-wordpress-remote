import net from 'net';
import crypto from 'crypto';
import { readJsonFile } from './persistent-auth-config';
import { z } from 'zod';

/**
 * OAuth client information schema for reading existing client data
 */
const OAuthClientInfoSchema = z.object({
  redirect_uris: z.array(z.string()),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

type OAuthClientInfo = z.infer<typeof OAuthClientInfoSchema>;

/**
 * Finds an available port on the local machine
 * @param preferredPort Optional preferred port to try first
 * @returns A promise that resolves to an available port number
 */
export async function findAvailablePort(preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // If preferred port is in use, get a random port
        server.listen(0);
      } else {
        reject(err);
      }
    });

    server.on('listening', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });

    // Try preferred port first, or get a random port
    server.listen(preferredPort || 0);
  });
}

/**
 * Calculate a consistent default port based on server URL hash
 * @param serverUrlHash The hashed server URL
 * @returns A port number in the range 3335-49151
 */
export function calculateDefaultPort(serverUrlHash: string): number {
  // Convert the first 4 bytes of the serverUrlHash into a port offset
  const offset = parseInt(serverUrlHash.substring(0, 4), 16);
  // Pick a consistent but random-seeming port from 3335 to 49151
  return 3335 + (offset % 45816);
}

/**
 * Find the port from existing OAuth client information
 * @param serverUrlHash The hashed server URL
 * @returns The existing callback port or undefined if not found
 */
export async function findExistingClientPort(serverUrlHash: string): Promise<number | undefined> {
  const clientInfo = await readJsonFile<OAuthClientInfo>(
    serverUrlHash, 
    'client_info.json'
  );
  
  if (!clientInfo) {
    return undefined;
  }

  const localhostRedirectUri = clientInfo.redirect_uris
    .map((uri) => {
      try {
        return new URL(uri);
      } catch {
        return null;
      }
    })
    .filter((url): url is URL => url !== null)
    .find(({ hostname }) => hostname === 'localhost' || hostname === '127.0.0.1');
    
  if (!localhostRedirectUri) {
    return undefined;
  }

  const port = parseInt(localhostRedirectUri.port);
  return isNaN(port) ? undefined : port;
}

/**
 * Generate a hash for the server URL to use in filenames
 * @param serverUrl The server URL to hash
 * @returns The hashed server URL
 */
export function getServerUrlHash(serverUrl: string): string {
  return crypto.createHash('md5').update(serverUrl).digest('hex');
}

/**
 * Smart callback port selection logic for self-hosted WordPress sites
 * @param serverUrl The WordPress site URL
 * @param specifiedPort Optional port specified by user
 * @param _unused Legacy parameter for backward compatibility (ignored)
 * @returns The selected callback port
 */
export async function selectCallbackPort(
  serverUrl: string, 
  specifiedPort?: number,
  _unused?: boolean
): Promise<number> {
  const serverUrlHash = getServerUrlHash(serverUrl);
  
  // If port is specified, use it
  if (specifiedPort) {
    return specifiedPort;
  }
  
  // Try to find existing client port or calculate a default
  const defaultPort = calculateDefaultPort(serverUrlHash);
  const [existingClientPort, availablePort] = await Promise.all([
    findExistingClientPort(serverUrlHash),
    findAvailablePort(defaultPort)
  ]);
  
  // Prefer existing client port for consistency
  if (existingClientPort) {
    return existingClientPort;
  }
  
  // Use automatically selected port
  return availablePort;
}
