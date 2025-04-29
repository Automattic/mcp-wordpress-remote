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
 */
export interface InitializeResult {
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: Record<string, any>;
}
