import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import { logger } from './utils.js';
import { CONFIG, MCP_WORDPRESS_REMOTE_VERSION } from './config.js';
import { WPTokens, WPClientInfo, TokenValidationResult, LockfileData } from './oauth-types.js';

// Use version from config for directory naming
const VERSION = MCP_WORDPRESS_REMOTE_VERSION;

/**
 * WordPress MCP Remote Authentication Configuration
 *
 * This module handles the storage and retrieval of authentication-related data for WordPress MCP Remote.
 *
 * Configuration directory structure:
 * - The config directory is determined by WP_MCP_CONFIG_DIR env var or defaults to ~/.mcp-auth
 * - Each file is prefixed with a hash of the server URL to separate configurations for different servers
 *
 * Files stored in the config directory:
 * - {server_hash}_client_info.json: Contains OAuth client registration information
 * - {server_hash}_tokens.json: Contains OAuth access and refresh tokens
 * - {server_hash}_code_verifier.txt: Contains the PKCE code verifier for the current OAuth flow
 * - {server_hash}_lock.json: Contains process coordination lockfile
 *
 * All JSON files are stored with 2-space indentation for readability.
 */

/**
 * Creates a lockfile for the given server
 */
export async function createLockfile(
  serverUrlHash: string,
  pid: number,
  port: number
): Promise<void> {
  const lockData: LockfileData = {
    pid,
    port,
    timestamp: Date.now(),
    hostname: os.hostname(),
  };
  await writeJsonFile(serverUrlHash, 'lock.json', lockData);
  logger.debug(`Created lockfile for server ${serverUrlHash}`, 'AUTH');
}

/**
 * Checks if a lockfile exists for the given server
 */
export async function checkLockfile(serverUrlHash: string): Promise<LockfileData | null> {
  try {
    const lockfile = await readJsonFile<LockfileData>(serverUrlHash, 'lock.json');
    return lockfile || null;
  } catch {
    return null;
  }
}

/**
 * Deletes the lockfile for the given server
 */
export async function deleteLockfile(serverUrlHash: string): Promise<void> {
  await deleteConfigFile(serverUrlHash, 'lock.json');
  logger.debug(`Deleted lockfile for server ${serverUrlHash}`, 'AUTH');
}

/**
 * Gets the configuration directory path
 */
export function getConfigDir(): string {
  const baseConfigDir = CONFIG.WP_MCP_CONFIG_DIR;
  // Add a version subdirectory so we don't need to worry about backwards/forwards compatibility
  return path.join(baseConfigDir, `wordpress-remote-${VERSION}`);
}

/**
 * Ensures the configuration directory exists
 */
export async function ensureConfigDir(): Promise<void> {
  try {
    const configDir = getConfigDir();
    await fs.mkdir(configDir, { recursive: true });

    // Set secure permissions on the config directory
    await fs.chmod(configDir, 0o700);
  } catch (error) {
    logger.error('Error creating config directory', 'AUTH', error);
    throw error;
  }
}

/**
 * Gets the file path for a config file
 */
export function getConfigFilePath(serverUrlHash: string, filename: string): string {
  const configDir = getConfigDir();
  return path.join(configDir, `${serverUrlHash}_${filename}`);
}

/**
 * Deletes a config file if it exists
 */
export async function deleteConfigFile(serverUrlHash: string, filename: string): Promise<void> {
  try {
    const filePath = getConfigFilePath(serverUrlHash, filename);
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error(`Error deleting ${filename}`, 'AUTH', error);
    }
  }
}

/**
 * Reads a JSON file and parses it
 */
export async function readJsonFile<T>(
  serverUrlHash: string,
  filename: string
): Promise<T | undefined> {
  try {
    await ensureConfigDir();

    const filePath = getConfigFilePath(serverUrlHash, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    logger.error(`Error reading ${filename}`, 'AUTH', error);
    return undefined;
  }
}

/**
 * Writes a JSON object to a file with secure permissions
 */
export async function writeJsonFile(
  serverUrlHash: string,
  filename: string,
  data: any
): Promise<void> {
  try {
    await ensureConfigDir();
    const filePath = getConfigFilePath(serverUrlHash, filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    // Set secure permissions (readable/writable only by owner)
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    logger.error(`Error writing ${filename}`, 'AUTH', error);
    throw error;
  }
}

/**
 * Reads a text file
 */
export async function readTextFile(
  serverUrlHash: string,
  filename: string,
  errorMessage?: string
): Promise<string> {
  try {
    await ensureConfigDir();
    const filePath = getConfigFilePath(serverUrlHash, filename);
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(errorMessage || `Error reading ${filename}`);
  }
}

/**
 * Writes a text string to a file with secure permissions
 */
export async function writeTextFile(
  serverUrlHash: string,
  filename: string,
  text: string
): Promise<void> {
  try {
    await ensureConfigDir();
    const filePath = getConfigFilePath(serverUrlHash, filename);
    await fs.writeFile(filePath, text, 'utf-8');

    // Set secure permissions
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    logger.error(`Error writing ${filename}`, 'AUTH', error);
    throw error;
  }
}

/**
 * Generate a hash for the server URL to use as filename
 */
export function generateServerUrlHash(serverUrl: string): string {
  return crypto.createHash('md5').update(serverUrl).digest('hex');
}

/**
 * Read stored tokens for a server
 */
export async function readTokens(serverUrlHash: string): Promise<WPTokens | null> {
  try {
    const tokens = await readJsonFile<WPTokens>(serverUrlHash, 'tokens.json');
    if (tokens) {
      logger.debug(`Loaded tokens for server hash: ${serverUrlHash}`, 'AUTH');
      return tokens;
    }
    return null;
  } catch (error) {
    logger.error(`Error reading tokens for ${serverUrlHash}`, 'AUTH', error);
    return null;
  }
}

/**
 * Write tokens to storage
 */
export async function writeTokens(serverUrlHash: string, tokens: WPTokens): Promise<void> {
  try {
    const tokensWithTimestamp = {
      ...tokens,
      obtained_at: Date.now(),
    };
    await writeJsonFile(serverUrlHash, 'tokens.json', tokensWithTimestamp);
    logger.info(`Stored tokens for server hash: ${serverUrlHash}`, 'AUTH');
  } catch (error) {
    logger.error(`Error writing tokens for ${serverUrlHash}`, 'AUTH', error);
    throw error;
  }
}

/**
 * Delete stored tokens
 */
export async function deleteTokens(serverUrlHash: string): Promise<void> {
  try {
    await deleteConfigFile(serverUrlHash, 'tokens.json');
    logger.info(`Deleted tokens for server hash: ${serverUrlHash}`, 'AUTH');
  } catch (error) {
    logger.error(`Error deleting tokens for ${serverUrlHash}`, 'AUTH', error);
  }
}

/**
 * Read stored client info for a server
 */
export async function readClientInfo(serverUrlHash: string): Promise<WPClientInfo | null> {
  try {
    const clientInfo = await readJsonFile<WPClientInfo>(serverUrlHash, 'client_info.json');
    if (clientInfo) {
      logger.debug(`Loaded client info for server hash: ${serverUrlHash}`, 'AUTH');
      return clientInfo;
    }
    return null;
  } catch (error) {
    logger.error(`Error reading client info for ${serverUrlHash}`, 'AUTH', error);
    return null;
  }
}

/**
 * Write client info to storage
 */
export async function writeClientInfo(
  serverUrlHash: string,
  clientInfo: WPClientInfo
): Promise<void> {
  try {
    await writeJsonFile(serverUrlHash, 'client_info.json', clientInfo);
    logger.info(`Stored client info for server hash: ${serverUrlHash}`, 'AUTH');
  } catch (error) {
    logger.error(`Error writing client info for ${serverUrlHash}`, 'AUTH', error);
    throw error;
  }
}

/**
 * Check if tokens are valid (not expired) - optimized for performance
 */
export function isTokenValid(tokens: WPTokens): TokenValidationResult {
  // Quick validation - check basic requirements first
  if (!tokens?.access_token) {
    return { isValid: false, error: 'No access token' };
  }

  // If no expiration info, assume valid (avoid unnecessary calculations)
  if (!tokens.expires_in || !tokens.obtained_at) {
    return { isValid: true };
  }

  // Optimized expiration check - avoid Math.floor until needed
  const now = Date.now();
  const expiryTime = tokens.obtained_at + (tokens.expires_in * 1000);
  
  // Quick check with 60-second buffer for token refresh
  const isExpiringSoon = now >= (expiryTime - 60000);
  
  if (isExpiringSoon) {
    const expiresIn = Math.max(0, Math.floor((expiryTime - now) / 1000));
    return {
      isValid: false,
      expiresIn,
      error: 'Token expired',
    };
  }

  // Token is valid with plenty of time left
  const expiresIn = Math.floor((expiryTime - now) / 1000);
  return { 
    isValid: true,
    expiresIn: Math.max(0, expiresIn)
  };
}

/**
 * Get valid tokens for a server, or null if not available/expired
 */
export async function getValidTokens(serverUrlHash: string): Promise<WPTokens | null> {
  const tokens = await readTokens(serverUrlHash);
  if (!tokens) {
    return null;
  }

  const validation = isTokenValid(tokens);
  if (!validation.isValid) {
    logger.warn(`Tokens for ${serverUrlHash} are invalid: ${validation.error}`, 'AUTH');
    // Don't auto-delete expired tokens - let OAuth flow handle refresh
    return null;
  }

  return tokens;
}

/**
 * Clean up expired tokens (optional - mainly for maintenance)
 */
export async function cleanupExpiredTokens(): Promise<void> {
  try {
    const configDir = getConfigDir();
    if (!fsSync.existsSync(configDir)) {
      return;
    }

    const files = await fs.readdir(configDir);
    const tokenFiles = files.filter(file => file.endsWith('_tokens.json'));

    let cleaned = 0;
    for (const file of tokenFiles) {
      const serverHash = file.replace('_tokens.json', '');
      const tokens = await readTokens(serverHash);
      if (tokens && !isTokenValid(tokens).isValid) {
        await deleteTokens(serverHash);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired token files`, 'AUTH');
    }
  } catch (error) {
    logger.error('Error during token cleanup', 'AUTH', error);
  }
}
