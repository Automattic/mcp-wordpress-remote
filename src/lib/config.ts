import * as os from 'os';
import * as path from 'path';
import { selectCallbackPort } from './port-utils.js';
import { logger } from './utils.js';

// Version constant - update this manually when releasing new versions
export const MCP_WORDPRESS_REMOTE_VERSION = '0.2.19';

/**
 * Centralized configuration for MCP WordPress Remote
 * All default values are defined here and can be overridden via environment variables
 */
export const CONFIG = {
  // API Configuration
  WP_API_URL: process.env.WP_API_URL || 'https://example.com',

  // OAuth Configuration (MCP Authorization specification 2025-06-18 compliant)
  OAUTH_ENABLED: process.env.OAUTH_ENABLED === 'true', // Disabled by default, enable with 'true'
  OAUTH_CALLBACK_PORT: process.env.OAUTH_CALLBACK_PORT
    ? parseInt(process.env.OAUTH_CALLBACK_PORT)
    : undefined,
  OAUTH_HOST: process.env.OAUTH_HOST || '127.0.0.1',
  WP_OAUTH_CLIENT_ID: process.env.WP_OAUTH_CLIENT_ID || '', // No default - site-specific

  // OAuth flow type - authorization_code (recommended) or implicit (legacy)
  OAUTH_FLOW_TYPE: (process.env.OAUTH_FLOW_TYPE || 'authorization_code') as
    | 'authorization_code'
    | 'implicit',
  OAUTH_USE_PKCE: process.env.OAUTH_USE_PKCE !== 'false', // PKCE required for OAuth 2.1
  OAUTH_DYNAMIC_REGISTRATION: process.env.OAUTH_DYNAMIC_REGISTRATION !== 'false', // Dynamic client registration

  // Explicit OAuth Endpoints (required for custom configurations)
  OAUTH_AUTHORIZE_ENDPOINT: process.env.OAUTH_AUTHORIZE_ENDPOINT || '', // Custom OAuth authorization endpoint
  OAUTH_TOKEN_ENDPOINT: process.env.OAUTH_TOKEN_ENDPOINT || '', // Custom OAuth token endpoint
  OAUTH_AUTHENTICATE_ENDPOINT: process.env.OAUTH_AUTHENTICATE_ENDPOINT || '', // Custom OAuth authenticate endpoint

  // Resource Indicators (RFC 8707)
  OAUTH_RESOURCE_INDICATOR: process.env.OAUTH_RESOURCE_INDICATOR !== 'false', // Resource parameter support

  // OAuth Scopes Configuration
  // OAUTH_SCOPES: Comma-separated list of OAuth scopes (e.g., "read,write")
  // If empty, uses defaults: "read,write"
  OAUTH_SCOPES: process.env.OAUTH_SCOPES || '',

  // Timeout Configuration (in milliseconds)
  OAUTH_TIMEOUT: 30000, // 30 seconds
  LOCK_TIMEOUT: 300000, // 5 minutes

  // Directory Configuration
  WP_MCP_CONFIG_DIR: process.env.WP_MCP_CONFIG_DIR || path.join(os.homedir(), '.mcp-auth'),

  // Logging Configuration
  LOG_FILE: process.env.LOG_FILE || null,

  // Authentication Configuration (legacy support)
  WP_API_USERNAME: process.env.WP_API_USERNAME,
  WP_API_PASSWORD: process.env.WP_API_PASSWORD,
  JWT_TOKEN: process.env.JWT_TOKEN,
  WOO_CUSTOMER_KEY: process.env.WOO_CUSTOMER_KEY,
  WOO_CUSTOMER_SECRET: process.env.WOO_CUSTOMER_SECRET,

  // Custom Headers Configuration
  CUSTOM_HEADERS: process.env.CUSTOM_HEADERS || '', // JSON string or comma-separated header:value pairs

  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Proxy Configuration
  USE_SYSTEM_PROXY: process.env.USE_SYSTEM_PROXY === 'true', // Enable system proxy detection (PAC files, env vars)
} as const;

/**
 * Type-safe configuration access with JSDoc descriptions
 */
export const getConfig = () => ({
  /** WordPress site API endpoint */
  wpApiUrl: CONFIG.WP_API_URL,

  /** Whether OAuth authentication is enabled */
  oauthEnabled: CONFIG.OAUTH_ENABLED,

  /** Port for OAuth callback server (undefined for auto-detection on self-hosted sites) */
  oauthCallbackPort: CONFIG.OAUTH_CALLBACK_PORT,

  /** Hostname for OAuth callback */
  oauthHost: CONFIG.OAUTH_HOST,

  /** WordPress OAuth client ID */
  wpOAuthClientId: CONFIG.WP_OAUTH_CLIENT_ID,

  /** OAuth flow type (authorization_code recommended, implicit for legacy) */
  oauthFlowType: CONFIG.OAUTH_FLOW_TYPE,

  /** Whether to use PKCE (required for OAuth 2.1) */
  oauthUsePKCE: CONFIG.OAUTH_USE_PKCE,

  /** Whether to support dynamic client registration */
  oauthDynamicRegistration: CONFIG.OAUTH_DYNAMIC_REGISTRATION,

  /** Whether to use resource indicators (RFC 8707) */
  oauthResourceIndicator: CONFIG.OAUTH_RESOURCE_INDICATOR,

  /** Custom OAuth scopes (comma-separated) */
  oauthScopes: CONFIG.OAUTH_SCOPES,

  /** OAuth operation timeout in milliseconds */
  oauthTimeout: CONFIG.OAUTH_TIMEOUT,

  /** Lock operation timeout in milliseconds */
  lockTimeout: CONFIG.LOCK_TIMEOUT,

  /** Configuration directory path */
  configDir: CONFIG.WP_MCP_CONFIG_DIR,

  /** Log file path (null if not set) */
  logFile: CONFIG.LOG_FILE,

  /** WordPress API username (legacy) */
  wpApiUsername: CONFIG.WP_API_USERNAME,

  /** WordPress API password (legacy) */
  wpApiPassword: CONFIG.WP_API_PASSWORD,

  /** JWT token for authentication */
  jwtToken: CONFIG.JWT_TOKEN,

  /** WooCommerce customer key */
  wooCustomerKey: CONFIG.WOO_CUSTOMER_KEY,

  /** WooCommerce customer secret */
  wooCustomerSecret: CONFIG.WOO_CUSTOMER_SECRET,

  /** Custom headers for API requests */
  customHeaders: CONFIG.CUSTOM_HEADERS,

  /** Current environment */
  nodeEnv: CONFIG.NODE_ENV,

  /** Whether to use system proxy (PAC files on macOS, env vars on all platforms) */
  useSystemProxy: CONFIG.USE_SYSTEM_PROXY,
});

/**
 * Parse OAuth scopes from environment variable or return default scopes
 */
export function parseOAuthScopes(envScopes: string, defaultScopes: string[]): string[] {
  if (!envScopes || envScopes.trim() === '') {
    return defaultScopes;
  }

  return envScopes
    .split(',')
    .map(scope => scope.trim())
    .filter(scope => scope.length > 0);
}

/**
 * Get default OAuth scopes
 */
export function getDefaultOAuthScopes(): string[] {
  const defaultScopes = ['read', 'write'];
  return parseOAuthScopes(CONFIG.OAUTH_SCOPES, defaultScopes);
}

/**
 * Parse custom headers from environment variable
 * Supports both JSON format and comma-separated format
 * 
 * JSON format: {"X-MCP-API-Key": "value", "X-Custom-Header": "value"}
 * Comma format: X-MCP-API-Key:value,X-Custom-Header:value
 */
export function parseCustomHeaders(customHeadersString: string): Record<string, string> {
  if (!customHeadersString || customHeadersString.trim() === '') {
    return {};
  }

  try {
    // Try parsing as JSON first
    if (customHeadersString.trim().startsWith('{')) {
      return JSON.parse(customHeadersString);
    }

    // Parse comma-separated format
    const headers: Record<string, string> = {};
    const pairs = customHeadersString.split(',');

    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':');
      if (colonIndex > 0) {
        const key = pair.substring(0, colonIndex).trim();
        const value = pair.substring(colonIndex + 1).trim();
        if (key && value) {
          headers[key] = value;
        }
      }
    }

    return headers;
  } catch (error) {
    logger.error('Error parsing custom headers', 'CONFIG', error);
    return {};
  }
}

/**
 * Get parsed custom headers
 */
export function getCustomHeaders(): Record<string, string> {
  // Read directly from process.env to handle dynamic environment variable changes
  const customHeadersEnv = process.env.CUSTOM_HEADERS || '';
  return parseCustomHeaders(customHeadersEnv);
}

/**
 * Validation function for required configuration
 */
export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Read current values from environment (to handle dynamic changes)
  const currentApiUrl = process.env.WP_API_URL || CONFIG.WP_API_URL;
  const currentCustomHeaders = process.env.CUSTOM_HEADERS || CONFIG.CUSTOM_HEADERS;
  const currentJwtToken = process.env.JWT_TOKEN || CONFIG.JWT_TOKEN;
  const currentUsername = process.env.WP_API_USERNAME || CONFIG.WP_API_USERNAME;
  const currentPassword = process.env.WP_API_PASSWORD || CONFIG.WP_API_PASSWORD;
  const currentOAuthEnabled = (process.env.OAUTH_ENABLED === 'true') || CONFIG.OAUTH_ENABLED;

  // Check if we have at least one authentication method
  const hasJWT = !!currentJwtToken;
  const hasBasicAuth = !!(currentUsername && currentPassword);
  const hasOAuth = currentOAuthEnabled;
  const hasCustomHeaders = !!currentCustomHeaders && currentCustomHeaders.trim() !== '';

  if (!hasJWT && !hasBasicAuth && !hasOAuth && !hasCustomHeaders) {
    errors.push(
      'No authentication method configured. Please set one of: JWT_TOKEN, WP_API_USERNAME+WP_API_PASSWORD, enable OAuth, or set CUSTOM_HEADERS'
    );
  }

  // Check API URL
  if (!currentApiUrl || currentApiUrl === 'https://example.com') {
    errors.push('WP_API_URL must be set to your WordPress site URL');
  }

  // Validate OAuth configuration if OAuth is enabled
  if (CONFIG.OAUTH_ENABLED) {
    // Validate port if specified
    if (
      CONFIG.OAUTH_CALLBACK_PORT !== undefined &&
      (isNaN(CONFIG.OAUTH_CALLBACK_PORT) ||
        CONFIG.OAUTH_CALLBACK_PORT < 1 ||
        CONFIG.OAUTH_CALLBACK_PORT > 65535)
    ) {
      errors.push('OAUTH_CALLBACK_PORT must be a valid port number (1-65535) if specified');
    }

    // PKCE is required for OAuth 2.1 authorization_code flow
    if (CONFIG.OAUTH_FLOW_TYPE === 'authorization_code' && !CONFIG.OAUTH_USE_PKCE) {
      errors.push(
        'PKCE is required for OAuth 2.1 authorization_code flow (MCP Authorization specification 2025-06-18)'
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors.map(formatConfigError),
  };
}

/**
 * Get the OAuth callback port with smart selection
 * Uses configured port or auto-detects available port
 */
export async function getOAuthCallbackPort(): Promise<number> {
  return selectCallbackPort(
    CONFIG.WP_API_URL,
    CONFIG.OAUTH_CALLBACK_PORT,
    false // Always treat as self-hosted for port selection
  );
}

/**
 * Enhance error messages with helpful debugging information
 */
function formatConfigError(error: string): string {
  // Add helpful context to common configuration errors
  if (error.includes('WP_API_URL must be set')) {
    return `${error}. Example: WP_API_URL=https://yoursite.com`;
  }

  if (error.includes('No authentication method configured')) {
    return `${error}. Configure one of these options:
    • JWT_TOKEN=your_jwt_token (preferred for APIs)
    • WP_API_USERNAME=username and WP_API_PASSWORD=app_password (for application passwords)
    • Set OAUTH_ENABLED=true and WP_OAUTH_CLIENT_ID=your_client_id (for OAuth 2.1)
    • CUSTOM_HEADERS='{"X-API-Key": "your_api_key"}' (for custom header authentication)`;
  }

  if (error.includes('OAUTH_CALLBACK_PORT')) {
    return `${error}. The port must be available for the OAuth callback server. Try a different port like 7777, 7890, or other ports in the safe 7000-7999 range.`;
  }

  if (error.includes('PKCE is required')) {
    return `${error}. Set OAUTH_USE_PKCE=true (this is required for secure OAuth 2.1 authentication).`;
  }

  if (error.includes('WP_OAUTH_CLIENT_ID')) {
    return `${error}. You need to register your application with WordPress first. Check if the WordPress MCP plugin is installed and activated.`;
  }

  return error;
}

/**
 * Simple health check for configuration performance
 */
export function getConfigHealthStatus(): {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  timestamp: string;
} {
  const validation = validateConfig();

  return {
    status: validation.isValid ? 'healthy' : 'unhealthy',
    uptime: process.uptime(),
    version: MCP_WORDPRESS_REMOTE_VERSION,
    timestamp: new Date().toISOString(),
  };
}
