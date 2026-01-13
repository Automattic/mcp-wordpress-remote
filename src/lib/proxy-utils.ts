/**
 * Cross-platform proxy utilities for MCP WordPress Remote
 *
 * Supports:
 * - macOS: Automatic PAC file detection from system proxy settings
 * - All platforms: Environment variables (SOCKS_PROXY, HTTPS_PROXY, etc.)
 */

import { execSync } from 'child_process';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from './utils.js';

// Dynamic imports for PAC resolver (has WASM dependencies)
type PacResolverFn = (url: string) => Promise<string>;

type ProxyAgent = SocksProxyAgent | HttpsProxyAgent<string>;

interface ProxyConfig {
  type: 'pac' | 'env' | 'none';
  pacResolver?: PacResolverFn;
  envProxy?: { url: string; type: 'socks' | 'http' };
}

let proxyConfig: ProxyConfig = { type: 'none' };

/**
 * Detect PAC URL from macOS system proxy settings
 */
function detectMacOsPac(): string | null {
  if (process.platform !== 'darwin') return null;

  try {
    const output = execSync('scutil --proxy', { encoding: 'utf-8' });
    const pacEnabled = output.match(/ProxyAutoConfigEnable\s*:\s*(\d)/)?.[1] === '1';
    const pacUrl = output.match(/ProxyAutoConfigURLString\s*:\s*(\S+)/)?.[1];

    if (pacEnabled && pacUrl) {
      return pacUrl;
    }
  } catch {
    // scutil failed or not available
  }
  return null;
}

/**
 * Detect proxy from environment variables (cross-platform)
 */
function detectEnvProxy(): { url: string; type: 'socks' | 'http' } | null {
  // Check SOCKS proxy first
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;
  if (socksProxy) {
    return { url: socksProxy, type: 'socks' };
  }

  // Check standard HTTP proxy variables
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpsProxy) {
    return { url: httpsProxy, type: httpsProxy.startsWith('socks') ? 'socks' : 'http' };
  }

  const allProxy = process.env.ALL_PROXY || process.env.all_proxy;
  if (allProxy) {
    return { url: allProxy, type: allProxy.startsWith('socks') ? 'socks' : 'http' };
  }

  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  if (httpProxy) {
    return { url: httpProxy, type: httpProxy.startsWith('socks') ? 'socks' : 'http' };
  }

  return null;
}

/**
 * Initialize proxy configuration (call once at startup)
 */
export async function initializeProxy(): Promise<void> {
  // 1. Try macOS PAC file first
  const pacUrl = detectMacOsPac();
  if (pacUrl) {
    try {
      // Fetch PAC file directly (not through proxy)
      const response = await fetch(pacUrl);
      const pacScript = await response.text();

      // Dynamic import for PAC resolver (has WASM dependencies)
      const { getQuickJS } = await import('@tootallnate/quickjs-emscripten');
      const { createPacResolver } = await import('pac-resolver');

      // Initialize QuickJS for PAC evaluation
      const qjs = await getQuickJS();
      const resolver = createPacResolver(qjs, pacScript);

      proxyConfig = {
        type: 'pac',
        pacResolver: resolver,
      };
      logger.info(`PAC proxy initialized from ${pacUrl}`, 'PROXY');
      return;
    } catch (error) {
      logger.warn(`Failed to initialize PAC proxy: ${error}`, 'PROXY');
    }
  }

  // 2. Try environment variables (all platforms)
  const envProxy = detectEnvProxy();
  if (envProxy) {
    proxyConfig = { type: 'env', envProxy };
    logger.info(`Proxy configured from environment: ${envProxy.url}`, 'PROXY');
    return;
  }

  // 3. No proxy configured
  logger.debug('No proxy configured', 'PROXY');
  proxyConfig = { type: 'none' };
}

/**
 * Get appropriate agent for a URL based on proxy configuration
 */
export async function getAgentForUrl(url: string): Promise<ProxyAgent | undefined> {
  if (proxyConfig.type === 'none') {
    return undefined;
  }

  // PAC-based proxy (macOS)
  if (proxyConfig.type === 'pac' && proxyConfig.pacResolver) {
    try {
      const result = await proxyConfig.pacResolver(url);

      if (result === 'DIRECT') {
        logger.debug(`PAC returned DIRECT for ${url}`, 'PROXY');
        return undefined;
      }

      // Parse "SOCKS host:port" or "SOCKS5 host:port"
      const socksMatch = result.match(/SOCKS5?\s+(\S+):(\d+)/);
      if (socksMatch) {
        const proxyUrl = `socks5://${socksMatch[1]}:${socksMatch[2]}`;
        logger.debug(`PAC returned SOCKS proxy for ${url}: ${proxyUrl}`, 'PROXY');
        return new SocksProxyAgent(proxyUrl);
      }

      // Parse "PROXY host:port"
      const proxyMatch = result.match(/PROXY\s+(\S+):(\d+)/);
      if (proxyMatch) {
        const proxyUrl = `http://${proxyMatch[1]}:${proxyMatch[2]}`;
        logger.debug(`PAC returned HTTP proxy for ${url}: ${proxyUrl}`, 'PROXY');
        return new HttpsProxyAgent(proxyUrl);
      }

      logger.debug(`PAC returned unknown result for ${url}: ${result}`, 'PROXY');
    } catch (error) {
      logger.warn(`PAC evaluation failed for ${url}: ${error}`, 'PROXY');
    }
    return undefined;
  }

  // Environment variable proxy (all platforms)
  if (proxyConfig.type === 'env' && proxyConfig.envProxy) {
    const { url: proxyUrl, type } = proxyConfig.envProxy;
    logger.debug(`Using env proxy ${proxyUrl} for ${url}`, 'PROXY');
    return type === 'socks'
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl);
  }

  return undefined;
}

/**
 * Check if proxy is configured
 */
export function isProxyConfigured(): boolean {
  return proxyConfig.type !== 'none';
}

/**
 * Get proxy configuration type for logging
 */
export function getProxyType(): 'pac' | 'env' | 'none' {
  return proxyConfig.type;
}
