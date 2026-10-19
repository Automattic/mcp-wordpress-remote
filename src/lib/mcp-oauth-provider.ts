/**
 * MCP-Compliant OAuth 2.1 Provider
 * Implementation of MCP Authorization specification 2026-07-28
 */

import open from 'open';
import lockfile from 'proper-lockfile';
import { setTimeout as delay } from 'node:timers/promises';
import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { EventEmitter } from 'node:events';
import {
  WPTokens,
  OAuthError,
  MCPOAuthConfig,
  AuthorizationServerMetadata,
  ProtectedResourceMetadata,
  ClientRegistrationRequest,
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
  ensureConfigDir,
  getConfigFilePath,
} from './persistent-auth-config.js';
import {
  generatePKCE,
  generateCanonicalResourceURI,
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  registerDynamicClient,
  exchangeAuthorizationCode,
  buildAuthorizationUrl,
  generateSecureState,
} from './mcp-oauth-utils.js';
import { setupWPOAuthCallbackServer } from './oauth-callback-server.js';
import { logger } from './utils.js';
import { CONFIG, getDefaultOAuthScopes } from './config.js';
import { selectCallbackPort } from './port-utils.js';
import { oauthFetch } from './oauth-http.js';

/**
 * MCP-compliant OAuth 2.1 Provider for WordPress
 * Implements OAuth 2.1 with PKCE, Resource Indicators, and Dynamic Client Registration
 */
export interface AuthorizationRequest {
  rejectedToken?: string;
  challenge?: WWWAuthenticateHeader;
  scopes?: string[];
}

export class MCPOAuthProvider {
  private config: MCPOAuthConfig;
  private serverUrlHash: string;
  private events: EventEmitter;
  private authPromise: Promise<WPTokens> | null = null;
  private configuredClientId?: string;
  private explicitScopes: string[];

  // OAuth 2.1 flow state
  private currentState: string | null = null;
  private currentPKCE: PKCEData | null = null;

  // Discovered metadata
  private authServerMetadata: AuthorizationServerMetadata | null = null;
  private resourceMetadata: ProtectedResourceMetadata | null = null;

  constructor(options: Partial<MCPOAuthConfig>) {
    const serverUrl = options.serverUrl || CONFIG.WP_API_URL;
    const defaultScopes = CONFIG.OAUTH_SCOPES ? getDefaultOAuthScopes() : [];
    this.explicitScopes = options.scopes ?? defaultScopes;
    this.configuredClientId = options.clientId || CONFIG.WP_OAUTH_CLIENT_ID || undefined;

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
  private async discoverOAuthEndpoints(challenge?: WWWAuthenticateHeader): Promise<void> {
    this.resourceMetadata = await discoverProtectedResourceMetadata(
      this.config.serverUrl,
      challenge?.resource_metadata
    );
    this.authServerMetadata = await discoverAuthorizationServerMetadata(
      this.resourceMetadata.authorization_servers[0]
    );
    this.config.resource = this.resourceMetadata.resource;
    this.config.authorizationEndpoint = this.authServerMetadata.authorization_endpoint;
    this.config.tokenEndpoint = this.authServerMetadata.token_endpoint;
    this.config.registrationEndpoint = this.authServerMetadata.registration_endpoint;
    this.config.clientId = this.configuredClientId;
    const challenged = challenge?.scope?.split(/\s+/).filter(Boolean);
    this.config.scopes = [
      ...new Set(
        challenged ??
          (this.explicitScopes.length
            ? this.explicitScopes
            : (this.resourceMetadata.scopes_supported ?? []))
      ),
    ];
  }

  private getAuthorizationServerUrl(): string | null {
    return (
      this.authServerMetadata?.issuer ??
      this.resourceMetadata?.authorization_servers[0] ??
      new URL(this.config.serverUrl).origin
    );
  }

  /**
   * Perform dynamic client registration if needed and supported
   */
  private async ensureClientRegistration(): Promise<void> {
    const issuer = this.getAuthorizationServerUrl()!;
    const stored = await readClientInfo(this.serverUrlHash);
    if (this.config.clientId) {
      if (stored?.issuer && stored.issuer !== issuer && stored.client_id === this.config.clientId) {
        throw new OAuthError(
          'Configured client belongs to another authorization server; update its registration',
          'CLIENT_ISSUER_MISMATCH'
        );
      }
      await writeClientInfo(this.serverUrlHash, { client_id: this.config.clientId, issuer });
      return;
    }
    if (
      stored?.issuer === issuer &&
      typeof stored.client_id === 'string' &&
      stored.client_id.length > 0
    ) {
      this.config.clientId = stored.client_id;
      return;
    }
    if (!CONFIG.OAUTH_DYNAMIC_REGISTRATION)
      throw new OAuthError(
        'No issuer-bound client registration; configure a client ID or enable registration',
        'NO_CLIENT_ID'
      );
    if (!this.authServerMetadata?.registration_endpoint)
      throw new OAuthError(
        'Authorization server does not support dynamic registration; configure its client ID',
        'NO_DYNAMIC_REGISTRATION'
      );
    const request: ClientRegistrationRequest = {
      redirect_uris: [this.config.redirectUri],
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'WordPress MCP Remote',
      ...(this.config.scopes.length ? { scope: this.config.scopes.join(' ') } : {}),
    };
    const registered = await registerDynamicClient(
      this.authServerMetadata.registration_endpoint,
      request
    );
    await writeClientInfo(this.serverUrlHash, {
      ...request,
      client_id: registered.client_id,
      issuer,
    });
    this.config.clientId = registered.client_id;
  }

  /**
   * Initiate MCP-compliant OAuth 2.1 authorization flow
   */
  private satisfies(tokens: WPTokens | null, request: AuthorizationRequest): tokens is WPTokens {
    return (
      !!tokens &&
      tokens.access_token !== request.rejectedToken &&
      (!request.scopes?.length ||
        request.scopes.every(scope => tokens.scope?.split(' ').includes(scope)))
    );
  }

  async authorize(request: AuthorizationRequest = {}): Promise<void> {
    if (this.authPromise) await this.authPromise;
    if (!this.authPromise) this.authPromise = this.authorizeWithLock(request);
    const pending = this.authPromise;
    try {
      await pending;
    } finally {
      if (this.authPromise === pending) this.authPromise = null;
    }
  }

  private async authorizeWithLock(request: AuthorizationRequest): Promise<WPTokens> {
    const valid = await this.tokens();
    if (this.satisfies(valid, request)) return valid;
    await ensureConfigDir();
    const file = getConfigFilePath(this.serverUrlHash, 'oauth');
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(file, { realpath: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') throw error;
      const deadline = Date.now() + this.config.timeout;
      while (Date.now() < deadline) {
        const tokens = await this.tokens();
        if (this.satisfies(tokens, request)) return tokens;
        if (!(await lockfile.check(file, { realpath: false }))) {
          const completed = await this.tokens();
          if (this.satisfies(completed, request)) return completed;
          throw new OAuthError('Authentication in another process did not complete', 'AUTH_FAILED');
        }
        await delay(Math.min(100, Math.max(0, deadline - Date.now())));
      }
      throw new OAuthError('Timeout waiting for authentication in another process', 'LOCK_TIMEOUT');
    }
    try {
      const completed = await this.tokens();
      if (this.satisfies(completed, request)) return completed;
      await this.discoverOAuthEndpoints(request.challenge);
      const issuer = this.getAuthorizationServerUrl()!;
      const stored = await readTokens(this.serverUrlHash);
      const client = await readClientInfo(this.serverUrlHash);
      if (
        this.configuredClientId &&
        client?.issuer &&
        client.issuer !== issuer &&
        client.client_id === this.configuredClientId
      ) {
        throw new OAuthError(
          'Configured client belongs to another authorization server',
          'CLIENT_ISSUER_MISMATCH'
        );
      }
      this.config.scopes = [
        ...new Set([
          ...(stored?.issuer === issuer ? (stored.scope?.split(' ').filter(Boolean) ?? []) : []),
          ...this.config.scopes,
          ...(request.scopes ?? []),
        ]),
      ];
      const needsScope = !!request.scopes?.some(
        scope => !stored?.scope?.split(' ').includes(scope)
      );
      const clientId = this.configuredClientId || client?.client_id;
      if (
        stored?.issuer === issuer &&
        client?.issuer === issuer &&
        stored.refresh_token &&
        clientId &&
        (!this.configuredClientId || this.configuredClientId === client.client_id) &&
        !needsScope
      ) {
        try {
          const renewed = await refreshAuthorization(issuer, {
            metadata: { ...this.authServerMetadata! },
            clientInformation: { client_id: clientId },
            refreshToken: stored.refresh_token,
            resource: this.resourceIndicator(),
            fetchFn: (url, init) => oauthFetch(String(url), init),
          });
          if (renewed.token_type.toLowerCase() !== 'bearer')
            throw new OAuthError('Unsupported token type', 'INVALID_TOKEN_RESPONSE');
          const tokens = {
            ...renewed,
            issuer,
            scope: renewed.scope ?? stored.scope,
            obtained_at: Date.now(),
          };
          await writeTokens(this.serverUrlHash, tokens);
          return tokens;
        } catch (error) {
          if (!(error instanceof InvalidGrantError)) throw error;
          await deleteConfigFile(this.serverUrlHash, 'tokens.json');
        }
      }
      return await this.performAuthorization();
    } finally {
      await release();
    }
  }

  private resourceIndicator(): string {
    if (!CONFIG.OAUTH_RESOURCE_INDICATOR)
      throw new OAuthError(
        'MCP OAuth requires resource indicators; remove OAUTH_RESOURCE_INDICATOR=false',
        'RESOURCE_REQUIRED'
      );
    return this.config.resource;
  }

  /**
   * Perform the complete OAuth 2.1 authorization flow
   */
  private async performAuthorization(): Promise<WPTokens> {
    try {
      // Step 1: Discover OAuth endpoints
      if (!this.authServerMetadata) await this.discoverOAuthEndpoints();
      if (!this.authServerMetadata?.code_challenge_methods_supported?.includes('S256'))
        throw new OAuthError(
          'Authorization server must advertise PKCE S256 support',
          'PKCE_REQUIRED'
        );
      this.resourceIndicator();
      if (!['127.0.0.1', 'localhost', '::1'].includes(this.config.host))
        throw new OAuthError(
          'Native OAuth callback must bind to loopback',
          'INVALID_CALLBACK_HOST'
        );
      this.currentPKCE = generatePKCE();
      this.currentState = generateSecureState();

      // Step 2: Set up callback server with smart port selection. This must
      // happen before client registration: DCR registers this.config.redirectUri
      // as the client's allowed redirect, so registration needs the real
      // selected port too, not the pre-selection port-0 placeholder.
      const callbackPort =
        this.config.callbackPort === 0
          ? await selectCallbackPort(this.config.serverUrl, undefined, false, this.config.host)
          : this.config.callbackPort;

      const callbackServer = setupWPOAuthCallbackServer(
        {
          port: callbackPort,
          host: this.config.host,
          serverUrlHash: this.serverUrlHash,
          timeout: this.config.timeout,
          state: this.currentState,
          issuer: this.authServerMetadata.issuer,
          requireIssuer: this.authServerMetadata.authorization_response_iss_parameter_supported,
        },
        this.events
      );

      await callbackServer.start();
      logger.oauth('OAuth callback server started');

      // Always release the callback port, so a failed attempt does not block the next one.
      try {
        // Update redirect URI with the actual port used
        const actualRedirectUri = `http://${this.config.host === '::1' ? '[::1]' : this.config.host}:${callbackPort}/oauth/callback`;
        this.config.redirectUri = actualRedirectUri;

        // Step 3: Ensure we have a client ID (via registration if needed)
        await this.ensureClientRegistration();

        // Step 4: Generate PKCE parameters (required for OAuth 2.1)

        // Store PKCE verifier for later use
        await writeTextFile(this.serverUrlHash, 'pkce_verifier.txt', this.currentPKCE.codeVerifier);
        await writeTextFile(this.serverUrlHash, 'oauth_state.txt', this.currentState);

        // Step 5: Build authorization URL with all required parameters
        const authUrl = buildAuthorizationUrl(
          this.config.authorizationEndpoint!,
          this.config.clientId!,
          actualRedirectUri,
          this.config.scopes,
          this.currentState,
          this.currentPKCE.codeChallenge,
          this.resourceIndicator()
        );

        logger.oauth('Built OAuth 2.1 authorization URL');
        logger.debug('Authorization URL', 'OAUTH', { url: authUrl });

        // Step 6: Open browser for user authorization
        const authorizationCode = this.waitForAuthorizationCode();
        void authorizationCode.catch(() => {});
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
        const authCode = await authorizationCode;

        // Step 8: Exchange authorization code for access token
        const response = await this.exchangeCodeForTokens(authCode, actualRedirectUri);
        const tokens = {
          ...response,
          issuer: this.getAuthorizationServerUrl()!,
          scope: response.scope ?? this.config.scopes.join(' '),
        };

        // Step 9: Store tokens
        await writeTokens(this.serverUrlHash, tokens);
        logger.oauth('OAuth 2.1 tokens stored successfully');

        return tokens;
      } finally {
        await callbackServer.stop();
        await deleteConfigFile(this.serverUrlHash, 'pkce_verifier.txt');
        await deleteConfigFile(this.serverUrlHash, 'oauth_state.txt');
      }
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

      this.events.once('oauth-code-received', async ({ code, state, iss }) => {
        cleanup();

        // Validate state parameter
        if (state !== this.currentState) {
          reject(new OAuthError('State parameter mismatch', 'INVALID_STATE'));
          return;
        }

        if (
          (iss !== undefined ||
            this.authServerMetadata?.authorization_response_iss_parameter_supported) &&
          iss !== this.authServerMetadata?.issuer
        ) {
          reject(new OAuthError('Authorization response issuer mismatch', 'INVALID_ISSUER'));
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
  private async exchangeCodeForTokens(
    code: string,
    redirectUri = this.config.redirectUri
  ): Promise<WPTokens> {
    try {
      const codeVerifier = await readTextFile(
        this.serverUrlHash,
        'pkce_verifier.txt',
        'PKCE code verifier not found'
      );

      const tokenResponse = await exchangeAuthorizationCode(
        this.config.tokenEndpoint!,
        code,
        redirectUri,
        this.config.clientId!,
        codeVerifier,
        this.resourceIndicator()
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
