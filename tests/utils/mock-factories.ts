/**
 * Mock factories for testing OAuth flows and WordPress API responses
 */

import { WPTokens, WPClientInfo } from '../../src/lib/oauth-types.js';
import { WordPressResponse } from '../../src/lib/types.js';

/**
 * Creates a mock OAuth token for testing
 */
export function createMockToken(overrides: Partial<WPTokens> = {}): WPTokens {
  const now = Date.now();
  return {
    access_token: 'mock_access_token_' + Math.random().toString(36).substr(2, 9),
    token_type: 'Bearer',
    expires_in: 3600, // 1 hour
    scope: 'global',
    obtained_at: now,
    refresh_token: 'mock_refresh_token_' + Math.random().toString(36).substr(2, 9),
    ...overrides,
  };
}

/**
 * Creates an expired mock token for testing token refresh flows
 */
export function createExpiredToken(overrides: Partial<WPTokens> = {}): WPTokens {
  const pastTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
  return createMockToken({
    obtained_at: pastTime,
    expires_in: 3600, // 1 hour (so it's expired)
    ...overrides,
  });
}

/**
 * Creates a mock WordPress client configuration
 */
export function createMockClientInfo(overrides: Partial<WPClientInfo> = {}): WPClientInfo {
  return {
    client_id: 'mock_client_id_' + Math.random().toString(36).substr(2, 9),
    client_secret: 'mock_client_secret_' + Math.random().toString(36).substr(2, 9),
    authorization_endpoint: 'https://public-api.wordpress.com/oauth2/authorize',
    token_endpoint: 'https://public-api.wordpress.com/oauth2/token',
    scope: 'global',
    ...overrides,
  };
}

/**
 * Creates a mock WordPress.com API response
 */
export function createMockWordPressResponse<T = any>(
  data: T,
  overrides: Partial<WordPressResponse> = {}
): WordPressResponse {
  return {
    status: 200,
    data,
    headers: {
      'content-type': 'application/json',
    },
    ...overrides,
  };
}

/**
 * Creates a mock WordPress API error response
 */
export function createMockErrorResponse(
  error: string,
  status: number = 400,
  overrides: Partial<WordPressResponse> = {}
): WordPressResponse {
  return {
    status,
    error,
    headers: {
      'content-type': 'application/json',
    },
    ...overrides,
  };
}

/**
 * Creates a mock MCP request
 */
export function createMockMCPRequest(method: string, params: any = {}) {
  return {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 10000),
    method,
    params,
  };
}

/**
 * Creates a mock MCP response
 */
export function createMockMCPResponse(result: any, id: number = 1) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Creates a mock MCP error response
 */
export function createMockMCPError(code: number, message: string, id: number = 1) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}

/**
 * Mock OAuth authorization URL
 */
export function createMockAuthUrl(clientId: string, state?: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'http://localhost:3000/callback',
    scope: 'global',
    ...(state && { state }),
  });
  
  return `https://public-api.wordpress.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Mock OAuth callback response
 */
export function createMockCallbackResponse(code: string, state?: string) {
  return {
    code,
    ...(state && { state }),
  };
}

/**
 * Creates mock WordPress site info
 */
export function createMockSiteInfo(overrides: any = {}) {
  return {
    ID: 123456789,
    name: 'Test WordPress Site',
    description: 'A test site for OAuth testing',
    URL: 'https://test-site.wordpress.com',
    capabilities: {
      edit_posts: true,
      publish_posts: true,
      manage_options: true,
    },
    ...overrides,
  };
}

/**
 * Creates mock WordPress user info
 */
export function createMockUserInfo(overrides: any = {}) {
  return {
    ID: 987654321,
    login: 'testuser',
    email: 'test@example.com',
    display_name: 'Test User',
    primary_blog: 123456789,
    ...overrides,
  };
}

/**
 * Creates mock WordPress posts response
 */
export function createMockPostsResponse(count: number = 3) {
  const posts = Array.from({ length: count }, (_, i) => ({
    ID: 100 + i,
    title: `Test Post ${i + 1}`,
    content: `This is test post content ${i + 1}`,
    status: 'publish',
    date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
    author: {
      ID: 987654321,
      login: 'testuser',
      display_name: 'Test User',
    },
  }));

  return {
    posts,
    found: count,
    meta: {
      links: {
        self: 'https://public-api.wordpress.com/rest/v1.1/sites/123456789/posts',
      },
    },
  };
}

/**
 * Creates mock environment variables for testing
 */
export function createMockEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MCP_WP_CLIENT_ID: 'test_client_id',
    MCP_WP_CLIENT_SECRET: 'test_client_secret',
    MCP_WP_SITE_URL: 'https://test-site.wordpress.com',
    MCP_WP_LOG_LEVEL: 'error',
    NODE_ENV: 'test',
    ...overrides,
  };
}
