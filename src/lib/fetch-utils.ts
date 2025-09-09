/**
 * Fetch API utilities for MCP WordPress Remote
 * 
 * Provides fetch polyfill setup for Node.js environments that don't have native fetch
 */

import { logger } from './utils.js';

/**
 * Setup fetch polyfill for Node.js 18+ compatibility
 * 
 * Checks if native fetch is available and loads node-fetch polyfill if needed.
 * This ensures compatibility across different Node.js versions.
 */
export async function setupFetchPolyfill(): Promise<void> {
  if (typeof globalThis.fetch !== 'function') {
    logger.info('Native fetch not available, loading node-fetch polyfill...', 'SYSTEM');
    try {
      const { default: nodeFetch } = await import('node-fetch');
      (globalThis as any).fetch = nodeFetch;
      logger.info('Successfully loaded node-fetch polyfill', 'SYSTEM');
    } catch (error) {
      logger.error(
        'Failed to load node-fetch polyfill. Please install node-fetch: npm install node-fetch',
        'SYSTEM'
      );
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`, 'SYSTEM');
      process.exit(1);
    }
  } else {
    logger.info('Using native fetch API', 'SYSTEM');
  }
}

/**
 * Check if fetch is available (either native or polyfilled)
 * 
 * @returns true if fetch is available, false otherwise
 */
export function isFetchAvailable(): boolean {
  return typeof globalThis.fetch === 'function';
}

/**
 * Get information about the current fetch implementation
 * 
 * @returns Object with details about fetch availability and type
 */
export function getFetchInfo() {
  const isAvailable = isFetchAvailable();
  const isNative = isAvailable && globalThis.fetch.toString().includes('[native code]');
  
  return {
    available: isAvailable,
    native: isNative,
    polyfilled: isAvailable && !isNative,
  };
}
