/**
 * Fetch API utilities for MCP WordPress Remote
 *
 * Provides fetch polyfill setup for Node.js environments that don't have native fetch
 * and proxy-aware fetch for routing through system proxies (PAC files, env-based SOCKS/HTTP proxies)
 */

import type { RequestInit as NodeFetchRequestInit } from 'node-fetch';
import type { Agent } from 'http';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { logger } from './utils.js';
import { getConfig } from './config.js';
import { initializeProxy, getAgentForUrl, isProxyConfigured, getProxyType } from './proxy-utils.js';

/**
 * Extended RequestInit that includes the agent property for proxy support
 */
type ProxyRequestInit = NodeFetchRequestInit;

/** A network failure from a fetch that actually selected a proxy agent. */
export class ProxyFetchError extends Error {
  public readonly cause: unknown;
  public readonly code?: string;
  public readonly redirected: boolean;

  constructor(cause: unknown, code?: string, redirected: boolean = false) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ProxyFetchError';
    this.cause = cause;
    this.code = code;
    this.redirected = redirected;
    Object.setPrototypeOf(this, ProxyFetchError.prototype);
  }
}

export function isProxyFetchError(error: unknown): error is ProxyFetchError {
  return error instanceof ProxyFetchError;
}

type NodeFetchImplementation = (url: string, init: ProxyRequestInit) => Promise<unknown>;

/**
 * Execute a request after a proxy agent has been selected, preserving that
 * attribution if the network attempt fails.
 *
 * @internal Exported for focused unit coverage; not part of the package barrel.
 */
export async function fetchWithProxyAgent(
  nodeFetch: NodeFetchImplementation,
  url: string,
  init: RequestInit | undefined,
  agent: Agent
): Promise<Response> {
  // node-fetch invokes the agent selector for each hop, including redirects
  // back to the same URL. A later refusal cannot prove the first hop was safe.
  let hops = 0;
  const selectAgent = () => {
    hops++;
    return agent;
  };
  try {
    return (await nodeFetch(url, { ...init, agent: selectAgent } as ProxyRequestInit)) as Response;
  } catch (error) {
    // socks converts socket errors to message-only SocksClientErrors, so
    // node-fetch cannot retain their code.
    const failure = error as { type?: string; code?: string; message?: string };
    const proxyHost = agent instanceof SocksProxyAgent ? agent.proxy.host : undefined;
    const refused =
      agent instanceof SocksProxyAgent &&
      proxyHost !== undefined &&
      failure?.type === 'system' &&
      failure.code === undefined &&
      failure.message ===
        `request to ${new URL(url).href} failed, reason: connect ECONNREFUSED ${proxyHost}:${agent.proxy.port}`;
    throw new ProxyFetchError(error, refused ? 'ECONNREFUSED' : undefined, hops > 1);
  }
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
    return fetchWithProxyAgent(nodeFetch, url, init, agent);
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
