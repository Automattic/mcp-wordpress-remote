/**
 * WordPress OAuth types and error definitions
 * Updated for MCP Authorization specification 2025-06-18 compliance
 */

/**
 * WordPress OAuth tokens structure
 */
export interface WPTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  obtained_at: number;
  refresh_token?: string;
}

/**
 * WordPress OAuth client information
 */
export interface WPClientInfo {
  client_id: string;
  client_secret?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  scope?: string;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  isValid: boolean;
  expiresIn?: number;
  error?: string;
}

/**
 * Lockfile data structure
 */
export interface LockfileData {
  pid: number;
  port: number;
  timestamp: number;
  hostname?: string;
}

/**
 * OAuth callback server options
 */
export interface OAuthCallbackServerOptions {
  port: number;
  host: string;
  serverUrlHash: string;
  timeout?: number;
}

/**
 * OAuth provider options for WordPress (MCP-compliant)
 */
export interface WPOAuthOptions {
  serverUrl: string;
  callbackPort: number;
  host: string;
  timeout?: number;
  clientId?: string;
  scopes?: string[];
  authorizeEndpoint?: string;
  tokenEndpoint?: string;
  // MCP-specific options
  resource?: string; // RFC 8707 Resource Indicators
  responseType?: 'code' | 'token'; // OAuth 2.1 prefers 'code'
  usePKCE?: boolean; // PKCE is required for OAuth 2.1
}

/**
 * Custom OAuth error class
 */
export class OAuthError extends Error {
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, code: string = 'OAUTH_ERROR', details?: any) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
    this.details = details;

    // Ensure proper prototype chain
    Object.setPrototypeOf(this, OAuthError.prototype);
  }
}

/**
 * Custom configuration error class
 */
export class ConfigError extends Error {
  public readonly field: string;
  public readonly value?: any;

  constructor(message: string, field: string, value?: any) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
    this.value = value;

    // Ensure proper prototype chain
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

/**
 * Custom authentication error class
 */
export class AuthError extends Error {
  public readonly method: string;
  public readonly statusCode?: number;

  constructor(message: string, method: string, statusCode?: number) {
    super(message);
    this.name = 'AuthError';
    this.method = method;
    this.statusCode = statusCode;

    // Ensure proper prototype chain
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
 * Custom API error class
 */
export class APIError extends Error {
  public readonly statusCode: number;
  public readonly endpoint: string;
  public readonly response?: any;
  /** Underlying network/TLS error code (e.g. "UNABLE_TO_VERIFY_LEAF_SIGNATURE"), when the failure was below the HTTP layer. */
  public readonly code?: string;

  constructor(message: string, statusCode: number, endpoint: string, response?: any, code?: string) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.response = response;
    this.code = code;

    // Ensure proper prototype chain
    Object.setPrototypeOf(this, APIError.prototype);
  }
}

/**
 * Auth coordinator interface
 */
export interface AuthCoordinator {
  start(): Promise<void>;
  stop(): Promise<void>;
  waitForAuth(): Promise<WPTokens>;
}

/**
 * OAuth flow state
 */
export interface OAuthState {
  state: string;
  codeVerifier?: string;
  timestamp: number;
}

/**
 * Error type guards
 */
export function isOAuthError(error: any): error is OAuthError {
  return error instanceof OAuthError;
}

export function isConfigError(error: any): error is ConfigError {
  return error instanceof ConfigError;
}

export function isAuthError(error: any): error is AuthError {
  return error instanceof AuthError;
}

export function isAPIError(error: any): error is APIError {
  return error instanceof APIError;
}

/**
 * MCP Authorization Specification Interfaces
 * Based on MCP Authorization specification 2025-06-18
 */

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  // Additional fields as needed
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  jwks_uri?: string;
  bearer_methods_supported?: string[];
  resource_documentation?: string;
}

/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591)
 */
export interface ClientRegistrationRequest {
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  scope?: string;
}

export interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  scope?: string;
}

/**
 * PKCE (Proof Key for Code Exchange) data
 */
export interface PKCEData {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
}

/**
 * OAuth 2.1 Authorization Code Exchange
 */
export interface AuthorizationCodeExchange {
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string; // PKCE verifier
  grant_type: 'authorization_code';
}

/**
 * Resource Indicators (RFC 8707) request parameters
 */
export interface ResourceIndicatorParams {
  resource: string; // Target resource URI
}

/**
 * MCP-compliant OAuth configuration
 */
export interface MCPOAuthConfig {
  // Server identification
  serverUrl: string;
  resource: string; // Canonical URI for resource indicators

  // OAuth 2.1 flow configuration
  responseType: 'code'; // OAuth 2.1 uses authorization code flow
  usePKCE: true; // PKCE is required

  // Client configuration
  clientId?: string;
  redirectUri: string;
  scopes: string[];

  // Endpoints (discovered via metadata)
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;

  // Network configuration
  callbackPort: number;
  host: string;
  timeout: number;
}

/**
 * WWW-Authenticate header parser result
 */
export interface WWWAuthenticateHeader {
  scheme: string;
  realm?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
  resource_metadata_url?: string;
}
