/**
 * MCP OAuth 2.1 Utilities
 * Implementation of MCP Authorization specification 2025-06-18
 */

import crypto from 'crypto';
import {
  PKCEData,
  AuthorizationServerMetadata,
  ProtectedResourceMetadata,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  WWWAuthenticateHeader,
  OAuthError,
} from './oauth-types.js';
import { logger } from './utils.js';

/**
 * Generate PKCE code verifier and challenge
 * Required for OAuth 2.1 compliance
 */
export function generatePKCE(): PKCEData {
  // Generate code verifier (43-128 characters, URL-safe)
  const codeVerifier = crypto.randomBytes(64).toString('base64url').substring(0, 128);

  // Generate code challenge using S256 method
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * Generate canonical resource URI for RFC 8707 Resource Indicators
 */
export function generateCanonicalResourceURI(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);

    // Normalize scheme and host to lowercase
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    // Remove fragment if present
    url.hash = '';

    // Remove trailing slash unless it's semantically significant
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch (error) {
    throw new OAuthError(
      `Invalid server URL for resource indicator: ${serverUrl}`,
      'INVALID_RESOURCE_URI'
    );
  }
}

/**
 * Discover OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
export async function discoverAuthorizationServerMetadata(
  authorizationServerUrl: string
): Promise<AuthorizationServerMetadata> {
  try {
    const metadataUrl = new URL('/.well-known/oauth-authorization-server', authorizationServerUrl);

    logger.oauth(`Discovering authorization server metadata: ${metadataUrl}`);

    const response = await fetch(metadataUrl.toString());

    if (!response.ok) {
      throw new OAuthError(
        `Failed to fetch authorization server metadata: ${response.status}`,
        'METADATA_DISCOVERY_FAILED'
      );
    }

    const metadata = (await response.json()) as AuthorizationServerMetadata;

    // Validate required fields
    if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
      throw new OAuthError(
        'Authorization server metadata missing required endpoints',
        'INVALID_METADATA'
      );
    }

    logger.oauth('Authorization server metadata discovered successfully');
    return metadata;
  } catch (error) {
    if (error instanceof OAuthError) {
      throw error;
    }
    throw new OAuthError(
      `Error discovering authorization server metadata: ${error instanceof Error ? error.message : String(error)}`,
      'METADATA_DISCOVERY_ERROR'
    );
  }
}

/**
 * Discover OAuth 2.0 Protected Resource Metadata (RFC 9728)
 */
export async function discoverProtectedResourceMetadata(
  resourceUrl: string
): Promise<ProtectedResourceMetadata> {
  try {
    const url = new URL(resourceUrl);
    const metadataUrl = new URL('/.well-known/oauth-protected-resource', url.origin);

    logger.oauth(`Discovering protected resource metadata: ${metadataUrl}`);

    const response = await fetch(metadataUrl.toString());

    if (!response.ok) {
      throw new OAuthError(
        `Failed to fetch protected resource metadata: ${response.status}`,
        'RESOURCE_METADATA_DISCOVERY_FAILED'
      );
    }

    const metadata = (await response.json()) as ProtectedResourceMetadata;

    // Validate required fields
    if (!metadata.authorization_servers || metadata.authorization_servers.length === 0) {
      throw new OAuthError(
        'Protected resource metadata missing authorization servers',
        'INVALID_RESOURCE_METADATA'
      );
    }

    logger.oauth('Protected resource metadata discovered successfully');
    return metadata;
  } catch (error) {
    if (error instanceof OAuthError) {
      throw error;
    }
    throw new OAuthError(
      `Error discovering protected resource metadata: ${error instanceof Error ? error.message : String(error)}`,
      'RESOURCE_METADATA_DISCOVERY_ERROR'
    );
  }
}

/**
 * Parse WWW-Authenticate header from 401 responses (RFC 9728 Section 5.1)
 */
export function parseWWWAuthenticateHeader(headerValue: string): WWWAuthenticateHeader {
  const parts = headerValue.split(/\s+/);
  const scheme = parts[0];

  const result: WWWAuthenticateHeader = { scheme };

  // Parse parameters
  const paramString = parts.slice(1).join(' ');
  const paramMatches = paramString.matchAll(/(\w+)="([^"]+)"/g);

  for (const match of paramMatches) {
    const [, key, value] = match;
    switch (key) {
      case 'realm':
        result.realm = value;
        break;
      case 'scope':
        result.scope = value;
        break;
      case 'error':
        result.error = value;
        break;
      case 'error_description':
        result.error_description = value;
        break;
      case 'error_uri':
        result.error_uri = value;
        break;
      case 'resource_metadata_url':
        result.resource_metadata_url = value;
        break;
    }
  }

  return result;
}

/**
 * Perform OAuth 2.0 Dynamic Client Registration (RFC 7591)
 */
export async function registerDynamicClient(
  registrationEndpoint: string,
  registrationRequest: ClientRegistrationRequest
): Promise<ClientRegistrationResponse> {
  try {
    logger.oauth(`Attempting dynamic client registration: ${registrationEndpoint}`);

    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthError(
        `Dynamic client registration failed: ${response.status} - ${errorText}`,
        'CLIENT_REGISTRATION_FAILED'
      );
    }

    const registrationResponse = (await response.json()) as ClientRegistrationResponse;

    // Validate response
    if (!registrationResponse.client_id) {
      throw new OAuthError(
        'Dynamic client registration response missing client_id',
        'INVALID_REGISTRATION_RESPONSE'
      );
    }

    logger.oauth('Dynamic client registration successful');
    logger.debug('Client ID obtained', 'OAUTH', {
      client_id: registrationResponse.client_id,
      expires_at: registrationResponse.client_secret_expires_at,
    });

    return registrationResponse;
  } catch (error) {
    if (error instanceof OAuthError) {
      throw error;
    }
    throw new OAuthError(
      `Error during dynamic client registration: ${error instanceof Error ? error.message : String(error)}`,
      'CLIENT_REGISTRATION_ERROR'
    );
  }
}

/**
 * Exchange authorization code for access token (OAuth 2.1)
 */
export async function exchangeAuthorizationCode(
  tokenEndpoint: string,
  code: string,
  redirectUri: string,
  clientId: string,
  codeVerifier: string,
  resource?: string
): Promise<any> {
  try {
    logger.oauth('Exchanging authorization code for access token');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    // Add resource parameter if provided (RFC 8707)
    if (resource) {
      params.set('resource', resource);
    }

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthError(
        `Token exchange failed: ${response.status} - ${errorText}`,
        'TOKEN_EXCHANGE_FAILED'
      );
    }

    const tokenResponse = (await response.json()) as any;

    // Validate token response
    if (!tokenResponse.access_token) {
      throw new OAuthError('Token response missing access_token', 'INVALID_TOKEN_RESPONSE');
    }

    logger.oauth('Authorization code exchange successful');
    return {
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type || 'Bearer',
      expires_in: tokenResponse.expires_in,
      scope: tokenResponse.scope,
      refresh_token: tokenResponse.refresh_token,
      obtained_at: Date.now(),
    };
  } catch (error) {
    if (error instanceof OAuthError) {
      throw error;
    }
    throw new OAuthError(
      `Error exchanging authorization code: ${error instanceof Error ? error.message : String(error)}`,
      'TOKEN_EXCHANGE_ERROR'
    );
  }
}

/**
 * Build OAuth 2.1 authorization URL with all required parameters
 */
export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
  codeChallenge: string,
  resource?: string
): string {
  const params = new URLSearchParams({
    response_type: 'code', // OAuth 2.1 uses authorization code flow
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  // Add resource parameter for RFC 8707 compliance
  if (resource) {
    params.set('resource', resource);
  }

  return `${authorizationEndpoint}?${params.toString()}`;
}

/**
 * Validate access token audience (preventing confused deputy attacks)
 */
export function validateTokenAudience(token: any, expectedResource: string): boolean {
  // This would typically involve JWT parsing and audience claim validation
  // For now, we'll implement basic validation
  if (token.audience && token.audience !== expectedResource) {
    logger.error('Token audience mismatch', 'OAUTH', {
      expected: expectedResource,
      actual: token.audience,
    });
    return false;
  }

  return true;
}

/**
 * Generate secure random state parameter
 */
export function generateSecureState(): string {
  return crypto.randomBytes(32).toString('base64url');
}
