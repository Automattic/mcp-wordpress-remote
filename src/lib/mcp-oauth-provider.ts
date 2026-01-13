/**
 * MCP-Compliant OAuth 2.1 Provider
 * Implementation of MCP Authorization specification 2025-06-18
 */

import open from 'open';
import { EventEmitter } from 'node:events';
import {
  WPTokens,
  WPClientInfo,
  OAuthError,
  MCPOAuthConfig,
  AuthorizationServerMetadata,
  ProtectedResourceMetadata,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  PKCEData,
  WWWAuthenticateHeader,
} from './oauth-types.js';
import {
  generateServerUrlHash,
  readTokens,
  writeTokens,
  readClientInfo,
  writeClientInfo,
  writeTextFile,
  readTextFile,
  deleteConfigFile,
  isTokenValid,
} from './persistent-auth-config.js';
import {
  generatePKCE,
  generateCanonicalResourceURI,
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  parseWWWAuthenticateHeader,
  registerDynamicClient,
  exchangeAuthorizationCode,
  buildAuthorizationUrl,
  generateSecureState,
} from './mcp-oauth-utils.js';
import { setupWPOAuthCallbackServer } from './oauth-callback-server.js';
import { logger } from './utils.js';
import { CONFIG, getDefaultOAuthScopes, getOAuthCallbackPort, getCustomHeaders } from './config.js';
import { proxyFetch } from './fetch-utils.js';

/**
 * MCP-compliant OAuth 2.1 Provider for WordPress
 * Implements OAuth 2.1 with PKCE, Resource Indicators, and Dynamic Client Registration
 */
export class MCPOAuthProvider {
  private config: MCPOAuthConfig;
  private serverUrlHash: string;
  private events: EventEmitter;
  private authPromise: Promise<WPTokens> | null = null;

  // OAuth 2.1 flow state
  private currentState: string | null = null;
  private currentPKCE: PKCEData | null = null;

  // Discovered metadata
  private authServerMetadata: AuthorizationServerMetadata | null = null;
  private resourceMetadata: ProtectedResourceMetadata | null = null;

  constructor(options: Partial<MCPOAuthConfig>) {
    const serverUrl = options.serverUrl || CONFIG.WP_API_URL;
    const defaultScopes = getDefaultOAuthScopes();

    // Build MCP-compliant configuration
    this.config = {
      serverUrl,
      resource: generateCanonicalResourceURI(serverUrl),
      responseType: 'code', // OAuth 2.1 uses authorization code flow
      usePKCE: true, // PKCE is required for OAuth 2.1
      redirectUri: `http://${CONFIG.OAUTH_HOST}:${CONFIG.OAUTH_CALLBACK_PORT || 0}/oauth/callback`,
      scopes: options.scopes || defaultScopes,
      clientId: options.clientId || CONFIG.WP_OAUTH_CLIENT_ID,
      callbackPort: CONFIG.OAUTH_CALLBACK_PORT || 0, // 0 = auto-select
      host: CONFIG.OAUTH_HOST,
      timeout: CONFIG.OAUTH_TIMEOUT,
      ...options,
    };

    this.serverUrlHash = generateServerUrlHash(this.config.serverUrl);
    this.events = new EventEmitter();
    this.events.setMaxListeners(10);

    logger.oauth('Initialized MCP-compliant OAuth 2.1 provider');
    logger.debug('OAuth configuration', 'OAUTH', {
      serverUrl: this.config.serverUrl,
      resource: this.config.resource,
      serverHash: this.serverUrlHash,
      flowType: this.config.responseType,
      usePKCE: this.config.usePKCE,
      callbackPort: this.config.callbackPort,
    });
  }

  /**
   * Get current tokens if available and valid from persistent storage
   */
  async tokens(): Promise<WPTokens | null> {
    try {
      const tokens = await readTokens(this.serverUrlHash);
      if (tokens) {
        const validation = isTokenValid(tokens);
        if (validation.isValid) {
          logger.oauth('Found valid tokens in persistent storage');
          if (validation.expiresIn) {
            logger.debug(`Tokens expire in ${validation.expiresIn} seconds`, 'OAUTH');
          }
          return tokens;
        } else {
          logger.warn(`Tokens in persistent storage are invalid: ${validation.error}`, 'OAUTH');
          return null;
        }
      }

      logger.debug('No tokens found in persistent storage', 'OAUTH');
      return null;
    } catch (error) {
      logger.error('Error retrieving tokens from persistent storage', 'OAUTH', error);
      return null;
    }
  }

  /**
   * Discover OAuth 2.1 server endpoints using MCP-compliant discovery
   */
  private async discoverOAuthEndpoints(): Promise<void> {
    try {
      logger.oauth('Starting MCP-compliant OAuth endpoint discovery');

      // Step 1: Try to discover protected resource metadata (RFC 9728)
      try {
        this.resourceMetadata = await discoverProtectedResourceMetadata(this.config.resource);
        logger.oauth('Protected resource metadata discovered');
      } catch (error) {
        logger.warn(
          'Protected resource metadata discovery failed, trying 401 response method',
          'OAUTH'
        );

        // Step 2: Try making a request to get WWW-Authenticate header
        await this.discoverVia401Response();
      }

      // Step 3: Discover authorization server metadata (RFC 8414)
      const authServerUrl = this.getAuthorizationServerUrl();
      if (authServerUrl) {
        this.authServerMetadata = await discoverAuthorizationServerMetadata(authServerUrl);
        logger.oauth('Authorization server metadata discovered');

        // Update config with discovered endpoints
        this.config.authorizationEndpoint = this.authServerMetadata.authorization_endpoint;
        this.config.tokenEndpoint = this.authServerMetadata.token_endpoint;
        this.config.registrationEndpoint = this.authServerMetadata.registration_endpoint;
      } else {
        throw new OAuthError('Could not determine authorization server URL', 'DISCOVERY_FAILED');
      }
    } catch (error) {
      logger.error('OAuth endpoint discovery failed', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Discover endpoints via 401 Unauthorized response (RFC 9728 Section 5.1)
   */
  private async discoverVia401Response(): Promise<void> {
    try {
      logger.oauth('Attempting discovery via 401 response method');

      // Make an unauthenticated request to trigger 401 with WWW-Authenticate header
      const customHeaders = getCustomHeaders();
      const response = await proxyFetch(this.config.serverUrl, {
        headers: {
          Accept: 'application/json',
          ...customHeaders,
        },
      });

      if (response.status === 401) {
        const wwwAuthHeader = response.headers.get('WWW-Authenticate');
        if (wwwAuthHeader) {
          const authInfo = parseWWWAuthenticateHeader(wwwAuthHeader);
          logger.oauth('WWW-Authenticate header parsed successfully');

          if (authInfo.resource_metadata_url) {
            // Fetch protected resource metadata from the indicated URL
            const metadataResponse = await proxyFetch(authInfo.resource_metadata_url, {
              headers: {
                'Accept': 'application/json',
                ...customHeaders,
              },
            });
            if (metadataResponse.ok) {
              this.resourceMetadata = (await metadataResponse.json()) as ProtectedResourceMetadata;
              logger.oauth('Protected resource metadata obtained via 401 response');
            }
          }
        }
      }
    } catch (error) {
      logger.warn('401 response discovery method failed', 'OAUTH', error);
      // This is expected to fail sometimes, continue with fallback methods
    }
  }

  /**
   * Get authorization server URL from discovered metadata
   */
  private getAuthorizationServerUrl(): string | null {
    if (this.resourceMetadata?.authorization_servers?.length) {
      // Use first authorization server from metadata
      return this.resourceMetadata.authorization_servers[0];
    }

    // Fallback: construct authorization server URL from resource URL
    try {
      const url = new URL(this.config.serverUrl);
      return url.origin;
    } catch {
      return null;
    }
  }

  /**
   * Perform dynamic client registration if needed and supported
   */
  private async ensureClientRegistration(): Promise<void> {
    if (this.config.clientId) {
      logger.oauth('Using provided client ID, skipping dynamic registration');
      return;
    }

    if (!CONFIG.OAUTH_DYNAMIC_REGISTRATION) {
      throw new OAuthError(
        'No client ID provided and dynamic registration is disabled',
        'NO_CLIENT_ID'
      );
    }

    if (!this.authServerMetadata?.registration_endpoint) {
      throw new OAuthError(
        'Dynamic client registration not supported by authorization server',
        'NO_DYNAMIC_REGISTRATION'
      );
    }

    try {
      logger.oauth('Performing dynamic client registration');

      const registrationRequest: ClientRegistrationRequest = {
        redirect_uris: [this.config.redirectUri],
        token_endpoint_auth_method: 'none', // Public client
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_name: 'WordPress MCP Remote',
        scope: this.config.scopes.join(' '),
      };

      const registrationResponse = await registerDynamicClient(
        this.authServerMetadata.registration_endpoint,
        registrationRequest
      );

      // Store client information
      const clientInfo: WPClientInfo = {
        client_id: registrationResponse.client_id,
        client_secret: registrationResponse.client_secret,
      };

      await writeClientInfo(this.serverUrlHash, clientInfo);
      this.config.clientId = registrationResponse.client_id;

      logger.oauth('Dynamic client registration completed successfully');
    } catch (error) {
      logger.error('Dynamic client registration failed', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Initiate MCP-compliant OAuth 2.1 authorization flow
   */
  async authorize(): Promise<void> {
    // If authorization is already in progress, wait for it
    if (this.authPromise) {
      logger.oauth('Authorization already in progress, waiting...');
      await this.authPromise;
      return;
    }

    // Check if we already have valid tokens
    const existingTokens = await this.tokens();
    if (existingTokens) {
      logger.oauth('Already have valid tokens, skipping authorization');
      return;
    }

    logger.oauth('Starting MCP-compliant OAuth 2.1 authorization flow');

    this.authPromise = this.performAuthorization();

    try {
      await this.authPromise;
      logger.oauth('OAuth 2.1 authorization completed successfully');
    } catch (error) {
      logger.error('OAuth 2.1 authorization failed', 'OAUTH', error);
      throw error;
    } finally {
      this.authPromise = null;
    }
  }

  /**
   * Perform the complete OAuth 2.1 authorization flow
   */
  private async performAuthorization(): Promise<WPTokens> {
    try {
      // Step 1: Discover OAuth endpoints
      await this.discoverOAuthEndpoints();

      // Step 2: Ensure we have a client ID (via registration if needed)
      await this.ensureClientRegistration();

      // Step 3: Generate PKCE parameters (required for OAuth 2.1)
      this.currentPKCE = generatePKCE();
      this.currentState = generateSecureState();

      // Store PKCE verifier for later use
      await writeTextFile(this.serverUrlHash, 'pkce_verifier.txt', this.currentPKCE.codeVerifier);
      await writeTextFile(this.serverUrlHash, 'oauth_state.txt', this.currentState);

      // Step 4: Set up callback server with smart port selection
      const callbackPort = this.config.callbackPort === 0 
        ? await getOAuthCallbackPort() 
        : this.config.callbackPort;
        
      const callbackServer = setupWPOAuthCallbackServer(
        {
          port: callbackPort,
          host: this.config.host,
          serverUrlHash: this.serverUrlHash,
          timeout: this.config.timeout,
        },
        this.events
      );

      await callbackServer.start();
      logger.oauth('OAuth callback server started');

      // Update redirect URI with the actual port used
      const actualRedirectUri = `http://${this.config.host}:${callbackPort}/oauth/callback`;

      // Step 5: Build authorization URL with all required parameters
      const authUrl = buildAuthorizationUrl(
        this.config.authorizationEndpoint!,
        this.config.clientId!,
        actualRedirectUri,
        this.config.scopes,
        this.currentState,
        this.currentPKCE.codeChallenge,
        CONFIG.OAUTH_RESOURCE_INDICATOR ? this.config.resource : undefined
      );

      logger.oauth('Built OAuth 2.1 authorization URL');
      logger.debug('Authorization URL', 'OAUTH', { url: authUrl });

      // Step 6: Open browser for user authorization
      try {
        await open(authUrl);
        logger.oauth('Browser opened successfully');
      } catch (browserError) {
        logger.error('Failed to open browser automatically', 'OAUTH', browserError);
        logger.info('\n=== MANUAL ACTION REQUIRED ===');
        logger.info('Please manually open the following URL in your browser:');
        logger.info(`${authUrl}`);
        logger.info('===============================\n');
      }

      // Step 7: Wait for authorization code
      const authCode = await this.waitForAuthorizationCode();

      // Step 8: Exchange authorization code for access token
      const tokens = await this.exchangeCodeForTokens(authCode);

      // Step 9: Store tokens
      await writeTokens(this.serverUrlHash, tokens);
      logger.oauth('OAuth 2.1 tokens stored successfully');

      await callbackServer.stop();
      return tokens;
    } catch (error) {
      logger.error('Error during OAuth 2.1 authorization flow', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Wait for authorization code from callback
   */
  private async waitForAuthorizationCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new OAuthError('Authorization timeout', 'TIMEOUT'));
      }, this.config.timeout);

      const cleanup = () => {
        this.events.removeAllListeners('oauth-code-received');
        this.events.removeAllListeners('oauth-error');
        clearTimeout(timeout);
      };

      this.events.once('oauth-code-received', async ({ code, state }) => {
        cleanup();

        // Validate state parameter
        if (state !== this.currentState) {
          reject(new OAuthError('State parameter mismatch', 'INVALID_STATE'));
          return;
        }

        logger.oauth('Valid authorization code received');
        resolve(code);
      });

      this.events.once('oauth-error', (error: Error) => {
        cleanup();
        reject(error);
      });
    });
  }

  /**
   * Exchange authorization code for access tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<WPTokens> {
    try {
      const codeVerifier = await readTextFile(
        this.serverUrlHash,
        'pkce_verifier.txt',
        'PKCE code verifier not found'
      );

      const tokenResponse = await exchangeAuthorizationCode(
        this.config.tokenEndpoint!,
        code,
        this.config.redirectUri,
        this.config.clientId!,
        codeVerifier,
        CONFIG.OAUTH_RESOURCE_INDICATOR ? this.config.resource : undefined
      );

      // Clean up temporary files
      await deleteConfigFile(this.serverUrlHash, 'pkce_verifier.txt');
      await deleteConfigFile(this.serverUrlHash, 'oauth_state.txt');

      return tokenResponse;
    } catch (error) {
      logger.error('Token exchange failed', 'OAUTH', error);
      throw error;
    }
  }

  /**
   * Clear stored credentials and state
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'state'): Promise<void> {
    logger.oauth(`Invalidating credentials: ${scope}`);

    switch (scope) {
      case 'all':
        await Promise.all([
          deleteConfigFile(this.serverUrlHash, 'client_info.json'),
          deleteConfigFile(this.serverUrlHash, 'tokens.json'),
          deleteConfigFile(this.serverUrlHash, 'pkce_verifier.txt'),
          deleteConfigFile(this.serverUrlHash, 'oauth_state.txt'),
        ]);
        break;

      case 'client':
        await deleteConfigFile(this.serverUrlHash, 'client_info.json');
        break;

      case 'tokens':
        await deleteConfigFile(this.serverUrlHash, 'tokens.json');
        break;

      case 'state':
        await Promise.all([
          deleteConfigFile(this.serverUrlHash, 'pkce_verifier.txt'),
          deleteConfigFile(this.serverUrlHash, 'oauth_state.txt'),
        ]);
        break;
    }

    logger.oauth(`Credentials invalidated: ${scope}`);
  }

  /**
   * Check if currently authorized
   */
  async isAuthorized(): Promise<boolean> {
    const tokens = await this.tokens();
    return tokens !== null;
  }

  /**
   * Get server URL hash
   */
  getServerUrlHash(): string {
    return this.serverUrlHash;
  }

  /**
   * Get OAuth configuration
   */
  getConfig(): MCPOAuthConfig {
    return { ...this.config };
  }
}
