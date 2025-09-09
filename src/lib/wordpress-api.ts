/**
 * External dependencies
 */
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { WordPressRequestParams, WordPressResponse } from './types.js';
import { logger, LogLevel } from './utils.js';
import { CONFIG, validateConfig, getDefaultOAuthScopes } from './config.js';
import { WPTokens, AuthError, APIError } from './oauth-types.js';
import {
  getValidTokens,
  generateServerUrlHash,
  cleanupExpiredTokens,
} from './persistent-auth-config.js';
import { PersistentWPOAuthClientProvider } from './persistent-oauth-client-provider.js';
import { MCPOAuthProvider } from './mcp-oauth-provider.js';
import { createLazyWPAuthCoordinator } from './coordination.js';

/**
 * WordPress API request function with OAuth, JWT, and Basic Auth support
 *
 * @param {Object} params - Query parameters for the request
 * @return {Promise<any>} API response as JSON
 */

// Global OAuth provider for WordPress API access
let legacyOAuthProvider: PersistentWPOAuthClientProvider | null = null;
let mcpOAuthProvider: MCPOAuthProvider | null = null;
let authCoordinator: any = null;
let globalEvents: EventEmitter | null = null;

// Global session ID received from WordPress server
let globalSessionId: string | null = null;

function validateEnvironment() {
  const validation = validateConfig();
  if (!validation.isValid) {
    throw new AuthError(
      `Configuration validation failed: ${validation.errors.join(', ')}`,
      'CONFIG_VALIDATION'
    );
  }
}

function removeTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Determines if a URL has a custom path (beyond just domain) and constructs the final API URL
 * - If URL has no path (e.g., http://example.com or http://example.com/), use default REST route format
 * - If URL has a path (e.g., http://example.com/api/mcp), use the URL exactly as provided
 */
function constructApiUrl(baseUrl: string, defaultEndpoint: string): string {
  const cleanUrl = removeTrailingSlash(baseUrl);
  
  try {
    const urlObj = new URL(cleanUrl);
    const hasCustomPath = urlObj.pathname && urlObj.pathname !== '/' && urlObj.pathname.length > 0;
    const hasCustomQuery = urlObj.search && urlObj.search.length > 0;
    
    if (hasCustomPath || hasCustomQuery) {
      // URL has a custom path or query strings - use it exactly as provided
      return cleanUrl;
    } else {
      // Standard WordPress installation - use REST route format with default endpoint
      return new URL(`/?rest_route=${defaultEndpoint}`, cleanUrl).toString();
    }
  } catch (error) {
    // Fallback to original behavior if URL parsing fails
    return new URL(`/?rest_route=${defaultEndpoint}`, cleanUrl).toString();
  }
}

/**
 * Get OAuth tokens for WordPress API access using MCP-compliant OAuth 2.1
 */
async function getOAuthTokens(): Promise<WPTokens | null> {
  try {
    // Check if OAuth is enabled
    if (!CONFIG.OAUTH_ENABLED) {
      logger.debug('OAuth is disabled via configuration', 'AUTH');
      return null;
    }

    logger.auth('Attempting to get OAuth tokens for WordPress API (MCP-compliant)...');

    const serverUrl = CONFIG.WP_API_URL;
    const serverUrlHash = generateServerUrlHash(serverUrl);

    // Try to get existing valid tokens first
    const existingTokens = await getValidTokens(serverUrlHash);
    if (existingTokens) {
      logger.auth('Using existing valid tokens from persistent storage');
      return existingTokens;
    }

    logger.auth('No existing valid tokens found in persistent storage');
    logger.auth('Starting MCP-compliant OAuth 2.1 authentication flow');
    logger.auth('Your browser should open automatically for authentication');

    // Use MCP OAuth 2.1 provider for all sites
    if (CONFIG.OAUTH_FLOW_TYPE === 'authorization_code' && CONFIG.OAUTH_USE_PKCE) {
      // Use MCP-compliant OAuth 2.1 provider
      if (!mcpOAuthProvider) {
        mcpOAuthProvider = new MCPOAuthProvider({
          serverUrl,
          clientId: CONFIG.WP_OAUTH_CLIENT_ID,
          scopes: getDefaultOAuthScopes(),
        });
      }

      logger.auth('Using MCP-compliant OAuth 2.1 authorization code flow with PKCE');
      await mcpOAuthProvider.authorize();
      const tokens = await mcpOAuthProvider.tokens();

      if (tokens) {
        logger.auth('MCP OAuth 2.1 tokens obtained for WordPress API access');
        return tokens;
      } else {
        logger.warn('No tokens available after MCP OAuth 2.1 authentication', 'AUTH');
        return null;
      }
    } else {
      // Use legacy OAuth provider
      logger.warn(
        'Using legacy OAuth provider. Consider enabling PKCE for MCP compliance',
        'AUTH'
      );

      // Initialize coordinator for legacy flow
      if (!authCoordinator) {
        if (!globalEvents) {
          globalEvents = new EventEmitter();
        }

        authCoordinator = createLazyWPAuthCoordinator(
          serverUrlHash,
          serverUrl,
          CONFIG.OAUTH_CALLBACK_PORT || 7665,
          globalEvents
        );
      }

      logger.auth('Starting legacy authentication via coordinator...');
      try {
        const tokens = await authCoordinator.waitForAuth();
        if (tokens) {
          logger.auth('Legacy tokens obtained for WordPress API access');
          return tokens;
        } else {
          logger.warn('No tokens available after legacy authentication', 'AUTH');
          return null;
        }
      } catch (authError) {
        logger.error('Legacy authentication via coordinator failed', 'AUTH', authError);
        throw authError;
      }
    }
  } catch (error) {
    logger.error('Error getting OAuth tokens', 'AUTH', error);
    return null;
  }
}

/**
 * Get the current session ID
 */
export function getSessionId(): string | null {
  return globalSessionId;
}

export async function wpRequest(
  requestData: any,
  useJsonRpc: boolean = true
): Promise<WordPressResponse> {
  // Validate environment variables first
  validateEnvironment();

  const endpoint = '/wp/v2/wpmcp'; // WordPress MCP endpoint
  const method = 'POST';

  // Log the request parameters for debugging
  if (useJsonRpc) {
    logger.api(`Request method: ${requestData.method || 'unknown'} (JSON-RPC)`);
    logger.debug(`JSON-RPC message: ${JSON.stringify(requestData)}`, 'API');
  } else {
    logger.api(`Request method: ${requestData.method || 'unknown'} (Simple)`);
    logger.debug(`Simple request: ${JSON.stringify(requestData)}`, 'API');
  }

  // Prepare authorization header - try authentication methods in order of priority
  let authHeader: string = '';

  // 1. JWT Token (highest priority)
  if (CONFIG.JWT_TOKEN) {
    authHeader = `Bearer ${CONFIG.JWT_TOKEN}`;
    logger.auth('Using JWT token authentication');
    logger.debug(`Token length: ${CONFIG.JWT_TOKEN.length}`, 'AUTH');
  }
  // 2. OAuth (if enabled and no JWT)
  else if (CONFIG.OAUTH_ENABLED) {
    logger.auth('OAuth is the primary authentication method - attempting to get tokens...');
    const oauthTokens = await getOAuthTokens();
    if (oauthTokens) {
      authHeader = `Bearer ${oauthTokens.access_token}`;
      logger.auth('Using OAuth token authentication for WordPress API');
      logger.debug(`Token length: ${oauthTokens.access_token.length}`, 'AUTH');
    } else {
      // OAuth failed but it's the primary method, try fallback to Basic Auth
      logger.warn('OAuth authentication failed, trying Basic Auth fallback', 'AUTH');
    }
  }

  // 3. Basic Auth (fallback or when OAuth is disabled)
  if (!authHeader && CONFIG.WP_API_USERNAME && CONFIG.WP_API_PASSWORD) {
    // Determine which credentials to use based on the method and params
    let username: string;
    let password: string;

    // Determine method and tool name based on transport type
    const method = useJsonRpc ? requestData.method : requestData.method;
    const toolName = useJsonRpc 
      ? (requestData.params?.name || requestData.params?.tool)
      : (requestData.name || requestData.tool || requestData.args?.tool);

    if (
      method === 'tools/call' &&
      toolName &&
      toolName.startsWith('wc_reports_')
    ) {
      // Use WooCommerce credentials for WooCommerce report tools
      username = CONFIG.WOO_CUSTOMER_KEY!;
      password = CONFIG.WOO_CUSTOMER_SECRET!;

      logger.auth(`Using WooCommerce credentials for tool: ${toolName}`);

      // Validate WooCommerce credentials
      if (!username || !password) {
        throw new AuthError(
          'Missing WooCommerce credentials. Please set WOO_CUSTOMER_KEY and WOO_CUSTOMER_SECRET environment variables.',
          'WOOCOMMERCE_CREDENTIALS'
        );
      }
    } else {
      // Use standard WordPress credentials for other methods
      username = CONFIG.WP_API_USERNAME!;
      password = CONFIG.WP_API_PASSWORD!;

      logger.auth(`Using WordPress Basic Auth for method: ${method || 'unknown'}`);
    }

    // Log credential information (without exposing the actual values)
    logger.debug(`Username length: ${username ? username.length : 0}`, 'AUTH');
    logger.debug(`Password length: ${password ? password.length : 0}`, 'AUTH');

    // Prepare Basic auth header
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    authHeader = `Basic ${auth}`;
    logger.debug(`Auth header length: ${auth.length}`, 'AUTH');
  }

  // Ensure we have an authorization header
  if (!authHeader) {
    throw new AuthError(
      'No authentication method available. Please configure JWT_TOKEN, OAuth, or Basic Auth (WP_API_USERNAME+WP_API_PASSWORD).',
      'NO_AUTH_METHOD'
    );
  }

  logger.debug(`Environment: ${CONFIG.NODE_ENV}`, 'API');
  logger.debug(`Base API URL: ${CONFIG.WP_API_URL}`, 'API');

  // Construct the final API URL based on whether the base URL has a custom path
  const url = constructApiUrl(CONFIG.WP_API_URL, endpoint);
  logger.debug(`Final requesting URL: ${url}`, 'API');

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18', // MCP protocol version
  };

  // Add session ID header if available (for MCP compliance)
  // Session ID will be set after we receive it from WordPress initialize response
  if (globalSessionId) {
    headers['Mcp-Session-Id'] = globalSessionId;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    body: JSON.stringify(requestData),
  };

  try {
    logger.api('Sending request to WordPress API...');
    logger.debug(`Request URL: ${url}`, 'API');
    logger.debug(`Request method: ${method}`, 'API');
    const response = await fetch(url, fetchOptions);
    logger.debug(`Response status: ${response.status}`, 'API');

    // Handle error responses
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`API error response: ${errorText}`, 'API');
      throw new APIError(
        `WordPress API error (${response.status}): ${errorText}`,
        response.status,
        url,
        errorText
      );
    }

    const responseData = await response.json();
    
    // Extract session ID from response headers (for initialize requests)
    const sessionIdHeader = response.headers.get('Mcp-Session-Id');
    if (sessionIdHeader && !globalSessionId) {
      globalSessionId = sessionIdHeader;
      logger.info(`Session ID received from WordPress: ${globalSessionId}`, 'SESSION');
    }
    
    logger.api('Response received successfully');
    logger.debug(`Response data: ${JSON.stringify(responseData)}`, 'API');
    
    // Handle response format based on transport type
    if (useJsonRpc && responseData && typeof responseData === 'object') {
      const jsonrpcResponse = responseData as any; // Type assertion for JSON-RPC response
      // Check if this is a JSON-RPC response
      if (jsonrpcResponse.jsonrpc === '2.0') {
        if (jsonrpcResponse.error) {
          // Handle JSON-RPC error response
          logger.error(`JSON-RPC error response: ${JSON.stringify(jsonrpcResponse.error)}`, 'API');
          throw new APIError(
            `WordPress JSON-RPC error: ${jsonrpcResponse.error.message}`,
            jsonrpcResponse.error.code || 500,
            url,
            JSON.stringify(jsonrpcResponse.error)
          );
        } else if (jsonrpcResponse.result !== undefined) {
          // Extract result from JSON-RPC response
          return jsonrpcResponse.result as WordPressResponse;
        }
      }
    }
    
    // For simple transport or non-JSON-RPC responses, return response as-is
    return responseData as WordPressResponse;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error in wpRequest: ${errorMessage}`, 'API');
    throw new APIError(errorMessage, 0, url);
  }
}
