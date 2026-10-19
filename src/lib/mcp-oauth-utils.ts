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
import { oauthFetch, validateOAuthUrl } from './oauth-http.js';
import { buildDiscoveryUrls } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';

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
  const issuer = validateOAuthUrl(authorizationServerUrl);
  if (issuer.search) throw new OAuthError('Issuer must not contain a query', 'INVALID_METADATA');
  for (const { url } of buildDiscoveryUrls(issuer)) {
    const response = await oauthFetch(url.toString(), { headers: { Accept: 'application/json' } });
    if ([404, 405].includes(response.status)) continue;
    if (!response.ok)
      throw new OAuthError(
        `Metadata request failed (${response.status})`,
        'METADATA_DISCOVERY_FAILED'
      );
    const parsed = OAuthMetadataSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.issuer !== authorizationServerUrl) {
      throw new OAuthError(
        'Authorization metadata has an invalid or mismatched issuer',
        'INVALID_METADATA'
      );
    }
    const metadata = parsed.data;
    validateOAuthUrl(metadata.issuer);
    validateOAuthUrl(metadata.authorization_endpoint);
    validateOAuthUrl(metadata.token_endpoint);
    if (metadata.registration_endpoint) validateOAuthUrl(metadata.registration_endpoint);
    return metadata;
  }
  throw new OAuthError('No authorization server metadata found', 'METADATA_DISCOVERY_FAILED');
}

export async function discoverProtectedResourceMetadata(
  resourceUrl: string,
  resourceMetadataUrl?: string
): Promise<ProtectedResourceMetadata> {
  const resource = validateOAuthUrl(resourceUrl);
  const candidates = resourceMetadataUrl
    ? [{ url: resourceMetadataUrl, expected: resourceUrl }]
    : [
        ...(resource.pathname !== '/'
          ? [
              {
                url: `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`,
                expected: resourceUrl,
              },
            ]
          : []),
        {
          url: `${resource.origin}/.well-known/oauth-protected-resource`,
          expected: resource.pathname === '/' ? resourceUrl : resource.origin,
        },
      ];
  for (const candidate of candidates) {
    const response = await oauthFetch(candidate.url, { headers: { Accept: 'application/json' } });
    if (!resourceMetadataUrl && [404, 405].includes(response.status)) continue;
    if (!response.ok)
      throw new OAuthError(
        `Resource metadata request failed (${response.status})`,
        'RESOURCE_METADATA_DISCOVERY_FAILED'
      );
    const parsed = OAuthProtectedResourceMetadataSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      parsed.data.resource !== candidate.expected ||
      !parsed.data.authorization_servers?.length
    ) {
      throw new OAuthError(
        'Protected resource metadata has an invalid or mismatched resource',
        'INVALID_RESOURCE_METADATA'
      );
    }
    for (const issuer of parsed.data.authorization_servers) validateOAuthUrl(issuer);
    return parsed.data as ProtectedResourceMetadata;
  }
  throw new OAuthError(
    'No protected resource metadata found',
    'RESOURCE_METADATA_DISCOVERY_FAILED'
  );
}

/**
 * Parse WWW-Authenticate header from 401 responses (RFC 9728 Section 5.1)
 */
export function parseWWWAuthenticateHeader(headerValue: string): WWWAuthenticateHeader {
  const bearer = /(?:^|,)\s*Bearer(?:\s+|$)/i.exec(headerValue);
  const result: WWWAuthenticateHeader = { scheme: bearer ? 'Bearer' : headerValue.split(/\s+/)[0] };
  if (!bearer) return result;
  const parameters = headerValue
    .slice(bearer.index + bearer[0].length)
    .split(/,\s*(?=[A-Za-z][\w-]*\s+(?![=]))/)[0];
  const known = new Set([
    'realm',
    'scope',
    'error',
    'error_description',
    'error_uri',
    'resource_metadata',
  ]);
  for (const match of parameters.matchAll(/([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)) {
    const key = match[1].toLowerCase();
    if (known.has(key))
      (result as unknown as Record<string, string>)[key] = (match[2] ?? match[3]).replace(
        /\\(.)/g,
        '$1'
      );
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

    // Include custom headers in registration requests
    const response = await oauthFetch(registrationEndpoint, {
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

    // Include custom headers in token exchange requests
    const response = await oauthFetch(tokenEndpoint, {
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

    const tokenResponse = OAuthTokensSchema.parse(await response.json());
    if (tokenResponse.token_type.toLowerCase() !== 'bearer')
      throw new OAuthError('Unsupported token type', 'INVALID_TOKEN_RESPONSE');

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

  validateOAuthUrl(authorizationEndpoint);
  const url = new URL(authorizationEndpoint);
  params.forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
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
