import * as os from 'os';
import * as path from 'path';

/**
 * Centralized configuration for MCP WordPress Remote
 * All default values are defined here and can be overridden via environment variables
 */
export const CONFIG = {
  // API Configuration
  WP_API_URL: process.env.WP_API_URL || 'https://example.com',

  // OAuth Configuration (MCP Authorization specification 2025-06-18 compliant)
  OAUTH_ENABLED: process.env.OAUTH_ENABLED === 'true', // Disabled by default, enable with 'true'
  OAUTH_CALLBACK_PORT: parseInt(process.env.OAUTH_CALLBACK_PORT || '3000'),
  OAUTH_HOST: process.env.OAUTH_HOST || '127.0.0.1',
  WP_OAUTH_CLIENT_ID: process.env.WP_OAUTH_CLIENT_ID || '', // No default - site-specific

  // MCP OAuth 2.1 specific settings
  OAUTH_FLOW_TYPE: (process.env.OAUTH_FLOW_TYPE || 'authorization_code') as
    | 'authorization_code'
    | 'implicit',
  OAUTH_USE_PKCE: process.env.OAUTH_USE_PKCE !== 'false', // PKCE required for OAuth 2.1
  OAUTH_DYNAMIC_REGISTRATION: process.env.OAUTH_DYNAMIC_REGISTRATION !== 'false', // Dynamic client registration

  // Resource Indicators (RFC 8707)
  OAUTH_RESOURCE_INDICATOR: process.env.OAUTH_RESOURCE_INDICATOR !== 'false', // Resource parameter support

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

  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
} as const;

/**
 * Type-safe configuration access with JSDoc descriptions
 */
export const getConfig = () => ({
  /** WordPress site API endpoint */
  wpApiUrl: CONFIG.WP_API_URL,

  /** Whether OAuth authentication is enabled */
  oauthEnabled: CONFIG.OAUTH_ENABLED,

  /** Port for OAuth callback server */
  oauthCallbackPort: CONFIG.OAUTH_CALLBACK_PORT,

  /** Hostname for OAuth callback */
  oauthHost: CONFIG.OAUTH_HOST,

  /** WordPress OAuth client ID */
  wpOAuthClientId: CONFIG.WP_OAUTH_CLIENT_ID,

  /** OAuth flow type (authorization_code for OAuth 2.1 compliance) */
  oauthFlowType: CONFIG.OAUTH_FLOW_TYPE,

  /** Whether to use PKCE (required for OAuth 2.1) */
  oauthUsePKCE: CONFIG.OAUTH_USE_PKCE,

  /** Whether to support dynamic client registration */
  oauthDynamicRegistration: CONFIG.OAUTH_DYNAMIC_REGISTRATION,

  /** Whether to use resource indicators (RFC 8707) */
  oauthResourceIndicator: CONFIG.OAUTH_RESOURCE_INDICATOR,

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

  /** Current environment */
  nodeEnv: CONFIG.NODE_ENV,
});

/**
 * Check if the site is a WordPress.com hosted site
 */
export function isWordPressComSite(url: string): boolean {
  try {
    const siteUrl = new URL(url);
    const hostname = siteUrl.hostname.toLowerCase();

    // WordPress.com hosted sites
    return (
      hostname.endsWith('.wordpress.com') ||
      hostname === 'wordpress.com' ||
      // Jetpack sites often use WordPress.com OAuth
      hostname.endsWith('.wpcomstaging.com') ||
      hostname.endsWith('.wpcomstaging.net')
    );
  } catch {
    return false;
  }
}

/**
 * Get recommended OAuth configuration based on site type
 */
export function getRecommendedOAuthConfig(siteUrl: string) {
  if (isWordPressComSite(siteUrl)) {
    return {
      flowType: 'implicit' as const,
      usePKCE: false,
      useResourceIndicator: false,
      authorizationEndpoint: 'https://public-api.wordpress.com/oauth2/authorize',
      tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token',
      description: 'WordPress.com OAuth2 (compatible mode)',
    };
  } else {
    return {
      flowType: 'authorization_code' as const,
      usePKCE: true,
      useResourceIndicator: true,
      authorizationEndpoint: undefined, // Will be discovered
      tokenEndpoint: undefined, // Will be discovered
      description: 'MCP-compliant OAuth 2.1',
    };
  }
}

/**
 * Validation function for required configuration
 */
export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if we have at least one authentication method
  const hasJWT = !!CONFIG.JWT_TOKEN;
  const hasBasicAuth = !!(CONFIG.WP_API_USERNAME && CONFIG.WP_API_PASSWORD);
  const hasOAuth = CONFIG.OAUTH_ENABLED;

  if (!hasJWT && !hasBasicAuth && !hasOAuth) {
    errors.push(
      'No authentication method configured. Please set one of: JWT_TOKEN, WP_API_USERNAME+WP_API_PASSWORD, or enable OAuth'
    );
  }

  // Check API URL
  if (!CONFIG.WP_API_URL || CONFIG.WP_API_URL === 'https://example.com') {
    errors.push('WP_API_URL must be set to your WordPress site URL');
  }

  // Validate OAuth configuration if OAuth is enabled
  if (CONFIG.OAUTH_ENABLED) {
    if (
      isNaN(CONFIG.OAUTH_CALLBACK_PORT) ||
      CONFIG.OAUTH_CALLBACK_PORT < 1 ||
      CONFIG.OAUTH_CALLBACK_PORT > 65535
    ) {
      errors.push('OAUTH_CALLBACK_PORT must be a valid port number (1-65535)');
    }

    // MCP Authorization specification compliance checks
    if (CONFIG.OAUTH_FLOW_TYPE === 'implicit') {
      errors.push(
        'OAUTH_FLOW_TYPE=implicit is deprecated. MCP Authorization specification 2025-06-18 requires OAuth 2.1 with authorization_code flow'
      );
    }

    if (CONFIG.OAUTH_FLOW_TYPE === 'authorization_code' && !CONFIG.OAUTH_USE_PKCE) {
      errors.push(
        'PKCE is required for OAuth 2.1 authorization_code flow (MCP Authorization specification 2025-06-18)'
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
