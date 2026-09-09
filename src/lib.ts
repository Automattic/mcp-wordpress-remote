/**
 * MCP WordPress Remote - Library Exports
 *
 * This file exports logger, configuration, types, and utilities for external packages.
 * Import via: @automattic/mcp-wordpress-remote/lib
 */

// Export logger and logging utilities
export { logger, log, LogLevel } from './lib/utils.js';

// Export configuration utilities
export {
  CONFIG,
  getConfig,
  validateConfig,
  getDefaultOAuthScopes,
  parseCustomHeaders,
  getCustomHeaders,
} from './lib/config.js';

// Export WordPress API utilities
export { wpRequest } from './lib/wordpress-api.js';

// Export common types
export type { WPTokens, WPClientInfo, TokenValidationResult } from './lib/oauth-types.js';
export type { WordPressRequestParams, WordPressResponse } from './lib/types.js';

// Export error types
export {
  OAuthError,
  AuthError,
  APIError,
  ConfigError,
  isOAuthError,
  isAuthError,
  isAPIError,
  isConfigError,
} from './lib/oauth-types.js';

// Export version
export { MCP_WORDPRESS_REMOTE_VERSION } from './lib/utils.js';

// Export fetch utilities (including proxy support)
export {
  setupFetchPolyfill,
  proxyFetch,
  ProxyFetchError,
  isProxyFetchError,
  getProxyInfo,
  isFetchAvailable,
  getFetchInfo,
} from './lib/fetch-utils.js';

// Export proxy utilities
export {
  initializeProxy,
  refreshProxy,
  isProxyConfigured,
  getProxyType,
  getAgentForUrl,
} from './lib/proxy-utils.js';

// Export tool-call hooks (embedding packages can piggyback on the live session)
export { registerToolCallHook } from './lib/tool-call-hooks.js';
export type { ToolCallHook, ToolCallContext } from './lib/tool-call-hooks.js';

// Export opt-in request recovery hooks for embedding packages.
export { registerRequestRecoveryHook } from './lib/request-recovery-hooks.js';
export type { RequestRecoveryHook, RequestRecoveryContext } from './lib/request-recovery-hooks.js';
