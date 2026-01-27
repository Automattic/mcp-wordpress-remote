/**
 * Fetch API utilities for MCP WordPress Remote
 *
 * Provides fetch polyfill setup for Node.js environments that don't have native fetch
 * and proxy-aware fetch for routing through system proxies (PAC files, env-based SOCKS/HTTP proxies)
 */

import type { RequestInit as NodeFetchRequestInit } from 'node-fetch';
import type { Agent } from 'http';
import { logger } from './utils.js';
import { getConfig } from './config.js';
import { initializeProxy, getAgentForUrl, isProxyConfigured, getProxyType } from './proxy-utils.js';

/**
 * Extended RequestInit that includes the agent property for proxy support
 */
interface ProxyRequestInit extends NodeFetchRequestInit {
  agent?: Agent;
}

/**
 * Setup fetch polyfill for Node.js 18+ compatibility
 *
 * Checks if native fetch is available and loads node-fetch polyfill if needed.
 * This ensures compatibility across different Node.js versions.
 * Also initializes proxy support for system proxies (PAC files, env vars).
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

  // Initialize proxy support if enabled (PAC file on macOS, env vars on all platforms)
  if (getConfig().useSystemProxy) {
    await initializeProxy();
  } else {
    logger.debug('System proxy support disabled (USE_SYSTEM_PROXY=false)', 'PROXY');
  }
}

/**
 * Proxy-aware fetch that routes requests through system proxies when configured
 *
 * On macOS: Evaluates PAC file from system proxy settings to determine proxy per-URL
 * On Linux/other: Uses SOCKS_PROXY, HTTPS_PROXY, etc. environment variables
 * Falls back to direct connection if no proxy is configured or USE_SYSTEM_PROXY=false
 *
 * @param url - The URL to fetch
 * @param init - Optional fetch init options
 * @returns Promise resolving to the Response
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  // Skip proxy lookup if system proxy is disabled
  if (!getConfig().useSystemProxy) {
    return fetch(url, init);
  }

  const agent = await getAgentForUrl(url);

  if (agent) {
    // Use node-fetch with agent for SOCKS/HTTP proxy support
    const nodeFetch = (await import('node-fetch')).default;
    return nodeFetch(url, { ...init, agent } as ProxyRequestInit) as unknown as Response;
  }

  // Direct connection (no proxy configured or PAC returned DIRECT)
  return fetch(url, init);
}

/**
 * Get proxy status information for logging/debugging
 */
export function getProxyInfo() {
  return {
    configured: isProxyConfigured(),
    type: getProxyType(),
  };
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
