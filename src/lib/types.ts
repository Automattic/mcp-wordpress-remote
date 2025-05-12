/**
 * WordPress API request parameters
 */
export interface WordPressRequestParams {
  method: string;
  args?: {
    tool?: string;
    [key: string]: any;
  };
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

/**
 * OAuth configuration
 */
export interface OAuthConfig {
  serverUrl: string;
  callbackPort: number;
  callbackPath?: string;
  clientName?: string;
  clientUri?: string;
  softwareId?: string;
  softwareVersion?: string;
}

/**
 * OAuth tokens
 */
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * OAuth client information
 */
export interface OAuthClientInformation {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  client_name: string;
  client_uri: string;
  software_id: string;
  software_version: string;
}

/**
 * Full OAuth client information including registration response
 */
export interface OAuthClientInformationFull extends OAuthClientInformation {
  registration_access_token: string;
  registration_client_uri: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
}
