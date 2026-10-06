/**
 * Cross-platform proxy utilities for MCP WordPress Remote
 *
 * Supports:
 * - All platforms: Environment variables (SOCKS_PROXY, HTTPS_PROXY, etc.), always
 * - macOS, with USE_SYSTEM_PROXY=true: PAC file from system proxy settings
 * - macOS, with USE_SYSTEM_PROXY=true: System SOCKS proxy ("tunnel all traffic")
 */

import { execSync } from 'child_process';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getConfig } from './config.js';
import { logger } from './utils.js';

// Dynamic imports for PAC resolver (has WASM dependencies)
type PacResolverFn = (url: string) => Promise<string>;

type ProxyAgent = SocksProxyAgent | HttpsProxyAgent<string>;

interface ProxyConfig {
  type: 'pac' | 'env' | 'none';
  pacResolver?: PacResolverFn;
  envProxy?: { url: string; type: 'socks' | 'http' };
}

const DEFAULT_PAC_LOAD_TIMEOUT_MS = 5000;

let proxyConfig: ProxyConfig = { type: 'none' };
let initializationPromise: Promise<void> | null = null;

interface MacOsProxyInfo {
  pacUrl: string | null;
  socks: { host: string; port: string } | null;
}

/**
 * Parse macOS system proxy settings from a single scutil --proxy call.
 * Returns PAC URL and SOCKS proxy info if enabled.
 */
function detectMacOsProxy(): MacOsProxyInfo | null {
  if (process.platform !== 'darwin') return null;

  try {
    const output = execSync('scutil --proxy', { encoding: 'utf-8', timeout: 3000 });

    const pacEnabled = output.match(/ProxyAutoConfigEnable\s*:\s*(\d)/)?.[1] === '1';
    const pacUrl = output.match(/ProxyAutoConfigURLString\s*:\s*(\S+)/)?.[1];

    const socksEnabled = output.match(/SOCKSEnable\s*:\s*(\d)/)?.[1] === '1';
    const socksHost = output.match(/SOCKSProxy\s*:\s*(\S+)/)?.[1];
    const socksPort = output.match(/SOCKSPort\s*:\s*(\d+)/)?.[1];

    return {
      pacUrl: pacEnabled && pacUrl ? pacUrl : null,
      socks: socksEnabled && socksHost && socksPort ? { host: socksHost, port: socksPort } : null,
    };
  } catch {
    // scutil failed or not available
  }
  return null;
}

/**
 * Check if proxy URL is a SOCKS proxy (case-insensitive)
 */
export function isSocksProxy(url: string): boolean {
  return url.toLowerCase().startsWith('socks');
}

/**
 * Redact credentials from proxy URL for safe logging
 */
function sanitizeProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  }
}

/**
 * Check if URL should bypass proxy based on NO_PROXY/no_proxy env var
 *
 * Supports:
 * - Single "*" disables proxying for all destinations
 * - Exact hostname matches (e.g., "example.com")
 * - Domain suffix matches (e.g., ".example.com" or "example.com" matches "api.example.com")
 */
export function shouldBypassProxy(targetUrl: string): boolean {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (!noProxy) return false;

  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  const rules = noProxy
    .split(',')
    .map(r => r.trim().toLowerCase())
    .filter(r => r.length > 0);

  for (const rule of rules) {
    if (rule === '*') return true;
    if (hostname === rule) return true;
    if (
      (rule.startsWith('.') && hostname.endsWith(rule)) ||
      (!rule.startsWith('.') && hostname.endsWith(`.${rule}`))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detect proxy from environment variables (cross-platform)
 */
export function detectEnvProxy(): { url: string; type: 'socks' | 'http' } | null {
  // Check SOCKS proxy first
  const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;
  if (socksProxy) {
    return { url: socksProxy, type: 'socks' };
  }

  // Check standard HTTP proxy variables
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (httpsProxy) {
    return { url: httpsProxy, type: isSocksProxy(httpsProxy) ? 'socks' : 'http' };
  }

  const allProxy = process.env.ALL_PROXY || process.env.all_proxy;
  if (allProxy) {
    return { url: allProxy, type: isSocksProxy(allProxy) ? 'socks' : 'http' };
  }

  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  if (httpProxy) {
    return { url: httpProxy, type: isSocksProxy(httpProxy) ? 'socks' : 'http' };
  }

  return null;
}

/**
 * Detector for macOS system proxy settings. Injectable so the precedence
 * logic in doInitializeProxy() can be tested without shelling out to scutil.
 */
type MacOsProxyDetector = () => MacOsProxyInfo | null;

/**
 * Initialize proxy configuration (call once at startup)
 * Guards against concurrent initialization calls
 *
 * @param detectMacOs - Optional override for macOS proxy detection (testing seam)
 */
export async function initializeProxy(
  detectMacOs: MacOsProxyDetector = detectMacOsProxy
): Promise<void> {
  // Return existing promise if initialization is already in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = doInitializeProxy(detectMacOs).catch(error => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

function getPacLoadTimeoutMs(): number {
  const configured = parseInt(process.env.PROXY_PAC_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PAC_LOAD_TIMEOUT_MS;
}

async function loadPacResolver(pacUrl: string, signal: AbortSignal): Promise<PacResolverFn> {
  // Fetch PAC file directly (not through proxy)
  const response = await fetch(pacUrl, { signal });
  if (!response.ok) {
    throw new Error(`PAC request failed with HTTP ${response.status}`);
  }
  const pacScript = await response.text();

  // Dynamic import for PAC resolver (has WASM dependencies)
  const { getQuickJS } = await import('@tootallnate/quickjs-emscripten');
  const { createPacResolver } = await import('pac-resolver');
  const qjs = await getQuickJS();
  return createPacResolver(qjs, pacScript);
}

/**
 * Load the PAC resolver within PROXY_PAC_TIMEOUT_MS, so an unreachable PAC URL
 * cannot stall startup. On timeout the caller falls back to the next proxy source.
 */
async function loadPacResolverWithTimeout(pacUrl: string): Promise<PacResolverFn> {
  const timeoutMs = getPacLoadTimeoutMs();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`PAC initialization timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([loadPacResolver(pacUrl, controller.signal), timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Internal initialization logic
 */
async function doInitializeProxy(detectMacOs: MacOsProxyDetector): Promise<void> {
  // 1. Explicit environment proxy takes precedence over auto-detected system
  //    proxies. Setting SOCKS_PROXY/HTTPS_PROXY/ALL_PROXY/HTTP_PROXY is a
  //    deliberate operator choice — including the URL scheme. The scheme
  //    matters: socks5:// resolves destination hostnames client-side, while
  //    socks5h:// defers resolution to the proxy. An auto-detected system PAC
  //    would otherwise be consulted first and could synthesize a different
  //    scheme, overriding the operator's explicit choice and changing which
  //    side performs DNS. Honoring the explicit value verbatim, before the
  //    system PAC, follows the precedence convention used by curl, git, and
  //    most HTTP clients.
  const envProxy = detectEnvProxy();
  if (envProxy) {
    proxyConfig = { type: 'env', envProxy };
    logger.info(`Proxy configured from environment: ${sanitizeProxyUrl(envProxy.url)}`, 'PROXY');
    return;
  }

  // 2. Try macOS system proxy (single scutil call for both PAC and SOCKS),
  //    only when the operator opted into system proxy detection.
  if (!getConfig().useSystemProxy) {
    logger.debug('No proxy configured (system proxy detection disabled)', 'PROXY');
    proxyConfig = { type: 'none' };
    return;
  }

  const macProxy = detectMacOs();

  // 2a. PAC file
  if (macProxy?.pacUrl) {
    try {
      const resolver = await loadPacResolverWithTimeout(macProxy.pacUrl);

      proxyConfig = {
        type: 'pac',
        pacResolver: resolver,
      };
      logger.info(`PAC proxy initialized from ${sanitizeProxyUrl(macProxy.pacUrl)}`, 'PROXY');
      return;
    } catch (error) {
      logger.error(`Failed to initialize PAC proxy: ${error}`, 'PROXY');
    }
  }

  // 2b. System SOCKS proxy (manual "tunnel all traffic" configuration)
  if (macProxy?.socks) {
    const { host, port } = macProxy.socks;
    const bracketedHost = host.includes(':') ? `[${host}]` : host;
    const socksUrl = `socks5h://${bracketedHost}:${port}`;
    proxyConfig = { type: 'env', envProxy: { url: socksUrl, type: 'socks' } };
    logger.info(`System SOCKS proxy configured: ${sanitizeProxyUrl(socksUrl)}`, 'PROXY');
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

  // Check NO_PROXY before using proxy
  if (shouldBypassProxy(url)) {
    logger.debug(`Bypassing proxy for ${url} (matches NO_PROXY)`, 'PROXY');
    return undefined;
  }

  // PAC-based proxy (macOS)
  // PAC may return multiple directives separated by semicolons,
  // e.g. "PROXY p1:8080; PROXY p2:8080; DIRECT"
  if (proxyConfig.type === 'pac' && proxyConfig.pacResolver) {
    try {
      const result = await proxyConfig.pacResolver(url);
      const directives = result.split(';');

      for (const rawDirective of directives) {
        const directive = rawDirective.trim();
        if (!directive) continue;

        if (directive.toUpperCase() === 'DIRECT') {
          logger.debug(`PAC returned DIRECT for ${url}`, 'PROXY');
          return undefined;
        }

        // Parse "SOCKS host:port" or "SOCKS5 host:port" (case-insensitive)
        const socksMatch = directive.match(/SOCKS5?\s+(\S+):(\d+)/i);
        if (socksMatch) {
          const proxyUrl = `socks5h://${socksMatch[1]}:${socksMatch[2]}`;
          logger.debug(
            `PAC returned SOCKS proxy for ${url}: ${sanitizeProxyUrl(proxyUrl)}`,
            'PROXY'
          );
          return new SocksProxyAgent(proxyUrl);
        }

        // Parse "PROXY host:port" (case-insensitive)
        const proxyMatch = directive.match(/PROXY\s+(\S+):(\d+)/i);
        if (proxyMatch) {
          const proxyUrl = `http://${proxyMatch[1]}:${proxyMatch[2]}`;
          logger.debug(
            `PAC returned HTTP proxy for ${url}: ${sanitizeProxyUrl(proxyUrl)}`,
            'PROXY'
          );
          return new HttpsProxyAgent(proxyUrl);
        }
      }

      logger.debug(`PAC returned no usable proxy for ${url}: ${result}`, 'PROXY');
    } catch (error) {
      logger.warn(`PAC evaluation failed for ${url}: ${error}`, 'PROXY');
    }
    return undefined;
  }

  // Environment variable proxy (all platforms)
  if (proxyConfig.type === 'env' && proxyConfig.envProxy) {
    const { url: proxyUrl, type } = proxyConfig.envProxy;
    try {
      logger.debug(`Using env proxy ${sanitizeProxyUrl(proxyUrl)} for ${url}`, 'PROXY');
      return type === 'socks' ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    } catch (error) {
      logger.error(`Invalid proxy URL "${proxyUrl}": ${error}`, 'PROXY');
      return undefined;
    }
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
