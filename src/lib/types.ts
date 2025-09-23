/**
 * WordPress API request parameters
 */
export interface WordPressRequestParams {
  method: string;
  [key: string]: any;
}

/**
 * WordPress API response
 */
export interface WordPressResponse {
  [key: string]: any;
}

/**
 * WordPress API configuration
 */
export interface WordPressConfig {
  apiUrl: string;
  username: string;
  password: string;
}

/**
 * WordPress API initialization result
 * Based on MCP 2025-06-18 InitializeResult schema
 */
export interface InitializeResult {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
    title?: string;
  };
  capabilities: Record<string, any>;
  instructions?: string;
}
