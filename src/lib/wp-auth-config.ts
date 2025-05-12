import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { log } from './utils';

/**
 * WordPress MCP Authentication Configuration
 *
 * This module handles the storage and retrieval of authentication-related data for WordPress MCP.
 *
 * Configuration directory structure:
 * - The config directory is determined by WP_MCP_CONFIG_DIR env var or defaults to ~/.wp-mcp-auth
 * - Each file is prefixed with a hash of the server URL to separate configurations for different servers
 *
 * Files stored in the config directory:
 * - {server_hash}_client_info.json: Contains OAuth client registration information
 * - {server_hash}_tokens.json: Contains OAuth access and refresh tokens
 * - {server_hash}_code_verifier.txt: Contains the PKCE code verifier for the current OAuth flow
 */

/**
 * Gets the configuration directory path
 * @returns The path to the configuration directory
 */
export function getConfigDir(): string {
  const baseConfigDir = process.env.WP_MCP_CONFIG_DIR || path.join(os.homedir(), '.wp-mcp-auth');
  return path.join(baseConfigDir, 'wp-mcp');
}

/**
 * Ensures the configuration directory exists
 */
export async function ensureConfigDir(): Promise<void> {
  try {
    const configDir = getConfigDir();
    await fs.mkdir(configDir, { recursive: true });
  } catch (error) {
    log('Error creating config directory:', error);
    throw error;
  }
}

/**
 * Gets the file path for a config file
 * @param serverUrlHash The hash of the server URL
 * @param filename The name of the file
 * @returns The absolute file path
 */
export function getConfigFilePath(serverUrlHash: string, filename: string): string {
  const configDir = getConfigDir();
  return path.join(configDir, `${serverUrlHash}_${filename}`);
}

/**
 * Deletes a config file if it exists
 * @param serverUrlHash The hash of the server URL
 * @param filename The name of the file to delete
 */
export async function deleteConfigFile(serverUrlHash: string, filename: string): Promise<void> {
  try {
    const filePath = getConfigFilePath(serverUrlHash, filename);
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`Error deleting ${filename}:`, error);
    }
  }
}

/**
 * Reads a JSON file and parses it
 * @param serverUrlHash The hash of the server URL
 * @param filename The name of the file to read
 * @returns The parsed file content or undefined if the file doesn't exist
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
    log(`Error reading ${filename}:`, error);
    return undefined;
  }
}

/**
 * Writes a JSON object to a file
 * @param serverUrlHash The hash of the server URL
 * @param filename The name of the file to write
 * @param data The data to write
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
  } catch (error) {
    log(`Error writing ${filename}:`, error);
    throw error;
  }
}

/**
 * Reads a text file
 * @param serverUrlHash The hash of the server URL
 * @param filename The name of the file to read
 * @param errorMessage Optional custom error message
 * @returns The file content as a string
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
 * Writes a text string to a file
 * @param serverUrlHash The hash of the server URL
 * @param filename The name of the file to write
 * @param text The text to write
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
  } catch (error) {
    log(`Error writing ${filename}:`, error);
    throw error;
  }
}

/**
 * Lockfile data structure
 */
export interface LockfileData {
  pid: number;
  port: number;
  timestamp: number;
}

/**
 * Checks if a lockfile exists for the given server
 * @param serverUrlHash The hash of the server URL
 * @returns The lockfile data or null if it doesn't exist
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
 * Creates a lockfile for the given server
 * @param serverUrlHash The hash of the server URL
 * @param pid The process ID
 * @param port The port the server is running on
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
  };
  await writeJsonFile(serverUrlHash, 'lock.json', lockData);
}

/**
 * Deletes the lockfile for the given server
 * @param serverUrlHash The hash of the server URL
 */
export async function deleteLockfile(serverUrlHash: string): Promise<void> {
  await deleteConfigFile(serverUrlHash, 'lock.json');
}
